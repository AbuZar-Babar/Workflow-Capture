/**
 * Workflow Capture — Run Execution API Controller
 * 
 * Manages dispatching workflow replay runs, fetching run manifests,
 * and downloading per-run artifacts/files.
 */

const fs = require('fs');
const path = require('path');
const { db } = require('../database/db');
const { sendJson } = require('../auth/auth-controller');
const { syncWorkflowsFromDisk } = require('./workflow-controller');
const LoopReplayRunner = require('../replay/loop-replay-runner');

// In-memory active runners map: runId -> { runner, userId, workflowId, startedAt }
const activeRunners = new Map();

/**
 * Check if there are active runs currently executing
 */
function hasActiveRuns() {
  return activeRunners.size > 0;
}

/**
 * Get count of currently executing runs
 */
function getActiveRunCount() {
  return activeRunners.size;
}

/**
 * Execute a workflow
 * POST /api/workflows/:id/execute
 * Body: { loopStepIndex, headless, params }
 */
async function executeWorkflow(req, res, workflowId, body = {}) {
  const userId = req.user.id;
  syncWorkflowsFromDisk(userId);

  let workflow = db.findOne('workflows', wf => wf.id === workflowId && (wf.userId === userId || !wf.userId || wf.userId === 'system' || wf.isGlobal));

  if (!workflow) {
    workflow = db.findOne('workflows', wf => wf.id === workflowId);
  }

  if (!workflow) {
    const filePath = path.resolve(process.cwd(), 'recordings', `${workflowId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const actions = Array.isArray(content.actions) ? content.actions : [];
        workflow = db.insert('workflows', {
          id: workflowId,
          userId,
          isGlobal: true,
          name: (content.metadata && content.metadata.name) || workflowId,
          targetUrl: (content.metadata && content.metadata.startUrl) || (actions[0] && actions[0].url) || '',
          steps: actions,
          recordingData: content
        });
      } catch {}
    }
  }

  if (!workflow) {
    return sendJson(res, 404, { error: 'Workflow not found or unauthorized' });
  }

  // Normalize steps for runner
  if (!workflow.steps && workflow.recordingData && workflow.recordingData.actions) {
    workflow.steps = workflow.recordingData.actions;
  }

  const runId = `run_${Date.now()}`;
  const runRecord = db.insert('runs', {
    id: runId,
    workflowId: workflow.id,
    userId,
    status: 'QUEUED',
    mode: body.isLoop ? 'LOOP' : 'STANDARD',
    startedAt: new Date().toISOString()
  });

  const runner = new LoopReplayRunner({ runId });
  activeRunners.set(runId, {
    runner,
    userId,
    workflowId: workflow.id,
    startedAt: Date.now()
  });

  // Respond immediately with Accepted (202) and run details
  sendJson(res, 202, {
    success: true,
    message: 'Workflow execution dispatched',
    runId,
    status: 'QUEUED',
    streamUrl: `/api/runs/${runId}/logs`
  });

  // Asynchronously execute workflow in background
  (async () => {
    try {
      db.update('runs', runId, { status: 'RUNNING' });
      const isLoop = Boolean(body.isLoop || (body.loopStepIndex !== null && body.loopStepIndex !== undefined && body.loopStepIndex !== -1));
      let manifest;
      if (isLoop) {
        manifest = await runner.executeLoop(workflow, body.loopStepIndex || 0);
      } else {
        manifest = await runner.executeStandard(workflow);
      }

      db.update('runs', runId, {
        status: runner.isAborted ? 'STOPPED' : manifest.status,
        itemsTotal: manifest.itemsTotal,
        itemsSucceeded: manifest.itemsSucceeded,
        itemsFailed: manifest.itemsFailed,
        downloadedFiles: manifest.downloadedFiles,
        completedAt: manifest.endTime || new Date().toISOString()
      });
    } catch (err) {
      db.update('runs', runId, {
        status: runner.isAborted ? 'STOPPED' : 'FAILED',
        error: err.message,
        completedAt: new Date().toISOString()
      });
    } finally {
      activeRunners.delete(runId);
    }
  })();
}

/**
 * Stop a specific workflow run
 * POST /api/runs/:runId/stop
 */
async function stopRun(req, res, runId) {
  const userId = req.user.id;
  const active = activeRunners.get(runId);

  if (active) {
    if (active.userId !== userId && req.user.role !== 'admin') {
      return sendJson(res, 403, { error: 'Unauthorized to stop this run' });
    }
    await active.runner.stop();
    activeRunners.delete(runId);
    db.update('runs', runId, {
      status: 'STOPPED',
      completedAt: new Date().toISOString()
    });
    return sendJson(res, 200, {
      success: true,
      message: `Execution run ${runId} stopped successfully`,
      runId,
      status: 'STOPPED'
    });
  }

  // Check database record if already stopped or finished
  const run = db.findOne('runs', r => r.id === runId && (r.userId === userId || req.user.role === 'admin'));
  if (!run) {
    return sendJson(res, 404, { error: 'Run not found or unauthorized' });
  }

  if (run.status === 'RUNNING' || run.status === 'QUEUED') {
    db.update('runs', runId, {
      status: 'STOPPED',
      completedAt: new Date().toISOString()
    });
  }

  return sendJson(res, 200, {
    success: true,
    message: `Run ${runId} is marked as STOPPED`,
    runId,
    status: 'STOPPED'
  });
}

/**
 * Stop all active runs for the current user
 * POST /api/runs/stop
 */
async function stopAllRuns(req, res) {
  const userId = req.user.id;
  let stoppedCount = 0;

  for (const [runId, item] of activeRunners.entries()) {
    if (item.userId === userId || req.user.role === 'admin') {
      try {
        await item.runner.stop();
        activeRunners.delete(runId);
        db.update('runs', runId, {
          status: 'STOPPED',
          completedAt: new Date().toISOString()
        });
        stoppedCount++;
      } catch (err) {
        console.error(`Error stopping run ${runId}:`, err);
      }
    }
  }

  // Mark any lingering active status in DB as STOPPED
  const dbRuns = db.find('runs', r => (r.userId === userId || req.user.role === 'admin') && (r.status === 'RUNNING' || r.status === 'QUEUED'));
  for (const r of dbRuns) {
    db.update('runs', r.id, {
      status: 'STOPPED',
      completedAt: new Date().toISOString()
    });
  }

  return sendJson(res, 200, {
    success: true,
    stoppedCount,
    message: stoppedCount > 0 ? `Stopped ${stoppedCount} active execution(s)` : 'No active executions were running'
  });
}

/**
 * Get all active runs
 * GET /api/runs/active
 */
function getActiveRuns(req, res) {
  const userId = req.user.id;
  const running = [];
  for (const [runId, item] of activeRunners.entries()) {
    if (item.userId === userId || req.user.role === 'admin') {
      running.push({
        runId,
        workflowId: item.workflowId,
        startedAt: item.startedAt
      });
    }
  }
  return sendJson(res, 200, {
    success: true,
    hasActive: running.length > 0,
    activeRuns: running
  });
}

/**
 * Get run execution status & manifest
 * GET /api/runs/:runId
 */
function getRunStatus(req, res, runId) {
  const userId = req.user.id;
  const run = db.findOne('runs', r => r.id === runId && r.userId === userId);

  if (!run) {
    return sendJson(res, 404, { error: 'Run not found or unauthorized' });
  }

  // If manifest file exists on disk, attach latest live manifest
  const manifestPath = path.resolve(process.cwd(), 'recordings', 'runs', runId, 'manifest.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {}
  }

  return sendJson(res, 200, {
    success: true,
    run: {
      ...run,
      manifest: manifest || null
    }
  });
}

/**
 * List all runs for the user
 * GET /api/runs
 */
function listRuns(req, res) {
  const userId = req.user.id;
  const runs = db.find('runs', r => r.userId === userId);

  return sendJson(res, 200, {
    success: true,
    count: runs.length,
    hasActive: activeRunners.size > 0,
    runs
  });
}

module.exports = {
  executeWorkflow,
  stopRun,
  stopAllRuns,
  getActiveRuns,
  hasActiveRuns,
  getActiveRunCount,
  getRunStatus,
  listRuns
};
