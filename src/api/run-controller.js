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
const LoopDetector = require('../shared/loop-detector');
const logger = require('../utils/logger');

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

  const steps = workflow.steps || [];

  const { loopStepIndex: requestedLoopIdx, forceRedownload, mode, isLoop: requestedIsLoop } = body || {};

  // Determine execution mode:
  // Default is STANDARD (macro replay). Loop is only enabled if explicitly requested or configured.
  let isLoop = false;
  let loopStepIndex = null;

  if (mode === 'single' || mode === 'standard' || requestedIsLoop === false || requestedLoopIdx === -1) {
    // Explicitly requested single macro execution
    isLoop = false;
    loopStepIndex = null;
  } else if (mode === 'loop' || mode === 'batch' || requestedIsLoop === true || (Number.isInteger(requestedLoopIdx) && requestedLoopIdx >= 0)) {
    // Explicitly requested loop execution
    isLoop = true;
    if (Number.isInteger(requestedLoopIdx) && requestedLoopIdx >= 0) {
      loopStepIndex = requestedLoopIdx;
    } else if (Number.isInteger(workflow.loopStepIndex) && workflow.loopStepIndex >= 0) {
      loopStepIndex = workflow.loopStepIndex;
    } else {
      const candidateIdx = LoopDetector.findLoopCandidateIndex(steps);
      loopStepIndex = candidateIdx >= 0 ? candidateIdx : 0;
    }
  } else if (workflow.mode === 'LOOP' && Number.isInteger(workflow.loopStepIndex) && workflow.loopStepIndex >= 0) {
    // Workflow was explicitly saved in workflow editor in LOOP mode
    isLoop = true;
    loopStepIndex = workflow.loopStepIndex;
  } else {
    // Default for newly recorded workflows or unconfigured workflows:
    // Run as-is as a macro (STANDARD execution)
    isLoop = false;
    loopStepIndex = null;
  }

  const totalSteps = steps.length;
  const runId = `run_${Date.now()}`;
  const runRecord = db.insert('runs', {
    id: runId,
    workflowId: workflow.id,
    userId,
    status: 'RUNNING',
    itemsTotal: totalSteps,
    itemsSucceeded: 0,
    itemsFailed: 0,
    itemsSkipped: 0,
    forceRedownload: !!forceRedownload,
    mode: isLoop ? 'LOOP' : 'STANDARD',
    loopStepIndex: isLoop ? loopStepIndex : null,
    startedAt: new Date().toISOString()
  });

  const runner = new LoopReplayRunner({
    runId,
    workflowId: workflow.id,
    workflowName: workflow.name || workflow.id,
    userId,
    forceRedownload: !!forceRedownload
  });
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
      const onProgress = (progress) => {
        if (progress && progress.manifest) {
          db.update('runs', runId, {
            itemsTotal: progress.manifest.itemsTotal,
            itemsSucceeded: progress.manifest.itemsSucceeded,
            itemsFailed: progress.manifest.itemsFailed,
            itemsSkipped: progress.manifest.itemsSkipped || 0
          });
        }
      };

      let manifest;
      if (isLoop) {
        manifest = await runner.executeLoop(workflow, loopStepIndex !== null ? loopStepIndex : 0, onProgress);
      } else {
        manifest = await runner.executeStandard(workflow, onProgress);
      }

      db.update('runs', runId, {
        status: runner.isAborted ? 'STOPPED' : manifest.status,
        itemsTotal: manifest.itemsTotal,
        itemsSucceeded: manifest.itemsSucceeded,
        itemsFailed: manifest.itemsFailed,
        itemsSkipped: manifest.itemsSkipped || 0,
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
  const userId = req.user ? req.user.id : null;
  const isAdmin = req.user ? req.user.role === 'admin' : true;
  const active = activeRunners.get(runId);

  if (active) {
    if (userId && active.userId && active.userId !== userId && !isAdmin) {
      return sendJson(res, 403, { error: 'Unauthorized to stop this run' });
    }
    try {
      if (active.runner && typeof active.runner.stop === 'function') {
        await active.runner.stop();
      }
    } catch (e) {
      console.error(`Error stopping active runner ${runId}:`, e);
    }
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
  const run = db.findOne('runs', r => r.id === runId && (!userId || r.userId === userId || isAdmin));
  if (!run) {
    return sendJson(res, 404, { error: 'Run not found' });
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
 * Stop all active runs
 * POST /api/runs/stop
 */
async function stopAllRuns(req, res) {
  const userId = req.user ? req.user.id : null;
  const isAdmin = req.user ? req.user.role === 'admin' : true;
  let stoppedCount = 0;

  for (const [runId, item] of activeRunners.entries()) {
    if (!userId || !item.userId || item.userId === userId || isAdmin) {
      try {
        if (item.runner && typeof item.runner.stop === 'function') {
          await item.runner.stop();
        }
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
  const dbRuns = db.find('runs', r => (!userId || !r.userId || r.userId === userId || isAdmin) && (r.status === 'RUNNING' || r.status === 'QUEUED'));
  for (const r of dbRuns) {
    db.update('runs', r.id, {
      status: 'STOPPED',
      completedAt: new Date().toISOString()
    });
  }

  return sendJson(res, 200, {
    success: true,
    stoppedCount,
    message: stoppedCount > 0 ? `Stopped ${stoppedCount} active execution(s)` : 'Execution stopped'
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

  // Check active runner in-memory manifest first
  const active = activeRunners.get(runId);
  let manifest = (active && active.runner && active.runner.manifest) ? active.runner.manifest : null;

  // If manifest file exists on disk, attach latest live manifest
  if (!manifest) {
    const manifestPath = path.resolve(process.cwd(), 'recordings', 'runs', runId, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {}
    }
  }

  // Find workflow metadata and steps
  let workflow = db.findOne('workflows', w => w.id === run.workflowId && (w.userId === userId || w.isGlobal));
  if (!workflow) {
    const recPath = path.resolve(process.cwd(), 'recordings', `${run.workflowId}.json`);
    if (fs.existsSync(recPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(recPath, 'utf8'));
        workflow = {
          id: run.workflowId,
          name: (content.metadata && content.metadata.name) || run.workflowId,
          steps: Array.isArray(content.actions) ? content.actions : []
        };
      } catch {}
    }
  }

  const workflowSteps = workflow ? (workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || []) : [];
  const workflowName = workflow ? workflow.name : (run.workflowId || 'Workflow');

  return sendJson(res, 200, {
    success: true,
    run: {
      ...run,
      workflowName,
      workflowSteps,
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

/**
 * List all downloaded files for the user
 * GET /api/downloads
 */
function listDownloads(req, res) {
  const userId = req.user ? req.user.id : null;
  const rawDownloads = db.find('downloads', d => !userId || d.userId === userId || !d.userId);

  // Cross-reference workflow names
  const workflows = db.find('workflows', () => true);
  const wfMap = new Map(workflows.map(w => [w.id, w.name]));

  const downloads = rawDownloads.map(d => {
    const rel = d.relativeFilePath || d.filePath || '';
    const fullPath = path.resolve(process.cwd(), rel);
    const exists = fs.existsSync(fullPath);
    let size = d.fileSizeBytes || 0;
    if (exists && !size) {
      try { size = fs.statSync(fullPath).size; } catch {}
    }
    return {
      ...d,
      relativeFilePath: rel,
      filePath: rel,
      workflowName: d.workflowName || wfMap.get(d.workflowId) || d.workflowId || 'Workflow',
      fileExists: exists,
      fileSizeBytes: size
    };
  });

  // Sort latest first
  downloads.sort((a, b) => new Date(b.downloadedAt || 0) - new Date(a.downloadedAt || 0));

  return sendJson(res, 200, {
    success: true,
    count: downloads.length,
    downloads
  });
}

/**
 * List downloaded files for a specific workflow
 * GET /api/workflows/:id/downloads
 */
function getWorkflowDownloads(req, res, workflowId) {
  const userId = req.user ? req.user.id : null;
  const rawDownloads = db.find('downloads', d => 
    d.workflowId === workflowId && (!userId || d.userId === userId || !d.userId)
  );

  const workflow = db.findOne('workflows', w => w.id === workflowId);
  const wfName = workflow ? workflow.name : workflowId;

  const downloads = rawDownloads.map(d => {
    const fullPath = path.resolve(process.cwd(), d.relativeFilePath || '');
    const exists = fs.existsSync(fullPath);
    return {
      ...d,
      workflowName: wfName,
      fileExists: exists
    };
  });

  downloads.sort((a, b) => new Date(b.downloadedAt || 0) - new Date(a.downloadedAt || 0));

  return sendJson(res, 200, {
    success: true,
    workflowId,
    count: downloads.length,
    downloads
  });
}

/**
 * Delete a downloaded artifact
 * DELETE /api/downloads/:id
 */
function deleteDownload(req, res, downloadId) {
  const userId = req.user ? req.user.id : null;
  const isAdmin = req.user ? req.user.role === 'admin' : true;
  const record = db.findOne('downloads', d => d.id === downloadId && (!userId || d.userId === userId || isAdmin || !d.userId));
  
  if (!record) {
    return sendJson(res, 404, { error: 'Download artifact not found' });
  }

  // Delete physical file if exists
  const fileRelPath = record.relativeFilePath || record.filePath;
  if (fileRelPath) {
    const fullPath = path.resolve(process.cwd(), fileRelPath);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch (err) {
        console.error(`[Artifacts] Failed to remove physical file ${fullPath}:`, err.message);
      }
    }
  }

  // Remove from database
  db.delete('downloads', downloadId);

  return sendJson(res, 200, {
    success: true,
    message: 'Artifact deleted successfully',
    id: downloadId
  });
}

/**
 * Export all downloads as a consolidated ZIP archive
 * GET /api/downloads/export
 */
function exportAllDownloadsZip(req, res) {
  const downloadsDir = path.resolve(process.cwd(), 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    return sendJson(res, 404, { error: 'No downloads directory found' });
  }

  const recordingsDir = path.resolve(process.cwd(), 'recordings');
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  const tempZipPath = path.resolve(recordingsDir, `export_artifacts_${Date.now()}.zip`);
  const { execFile } = require('child_process');

  execFile('tar', ['-a', '-cf', tempZipPath, '-C', downloadsDir, '.'], (err) => {
    if (err || !fs.existsSync(tempZipPath)) {
      return sendJson(res, 500, { error: 'Failed to archive downloads: ' + (err ? err.message : 'File not created') });
    }

    try {
      const stat = fs.statSync(tempZipPath);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="workflow-artifacts.zip"',
        'Content-Length': stat.size
      });

      const stream = fs.createReadStream(tempZipPath);
      stream.pipe(res);
      const cleanUp = () => {
        try { if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath); } catch {}
      };
      stream.on('close', cleanUp);
      stream.on('error', cleanUp);
    } catch (streamErr) {
      try { if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath); } catch {}
      return sendJson(res, 500, { error: streamErr.message });
    }
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
  listRuns,
  listDownloads,
  getWorkflowDownloads,
  deleteDownload,
  exportAllDownloadsZip
};
