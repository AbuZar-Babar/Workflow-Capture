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
const LoopReplayRunner = require('../replay/loop-replay-runner');

/**
 * Execute a workflow
 * POST /api/workflows/:id/execute
 * Body: { loopStepIndex, headless, params }
 */
async function executeWorkflow(req, res, workflowId, body = {}) {
  const userId = req.user.id;
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
      const runner = new LoopReplayRunner({ runId });
      const manifest = await runner.executeLoop(workflow, body.loopStepIndex || 0);

      db.update('runs', runId, {
        status: manifest.status,
        itemsTotal: manifest.itemsTotal,
        itemsSucceeded: manifest.itemsSucceeded,
        itemsFailed: manifest.itemsFailed,
        downloadedFiles: manifest.downloadedFiles,
        completedAt: manifest.endTime
      });
    } catch (err) {
      db.update('runs', runId, {
        status: 'FAILED',
        error: err.message,
        completedAt: new Date().toISOString()
      });
    }
  })();
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
    runs
  });
}

module.exports = {
  executeWorkflow,
  getRunStatus,
  listRuns
};
