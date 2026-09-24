const fs = require('fs');
const path = require('path');
const { db } = require('../database/db');
const { sendJson } = require('../auth/auth-controller');

const RECORDINGS_DIR = path.resolve(process.cwd(), 'recordings');

// In-memory cache of file mtimes and sync throttling for maximum speed
const diskSyncCache = new Map(); // filename -> { mtimeMs: number, size: number }
let lastDiskSyncTime = 0;
const DISK_SYNC_THROTTLE_MS = 6000; // Only rescan disk at most once every 6 seconds unless forced

/**
 * Auto-sync recording files on disk to the in-memory/JSON DB
 */
function syncWorkflowsFromDisk(currentUserId, force = false) {
  if (!fs.existsSync(RECORDINGS_DIR)) return;

  const now = Date.now();
  if (!force && (now - lastDiskSyncTime < DISK_SYNC_THROTTLE_MS)) {
    return; // Sub-millisecond return when called frequently
  }
  lastDiskSyncTime = now;

  try {
    const files = fs.readdirSync(RECORDINGS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(RECORDINGS_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        const cached = diskSyncCache.get(file);
        if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
          // File has not changed on disk — skip reading and parsing completely!
          continue;
        }

        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        diskSyncCache.set(file, { mtimeMs: stats.mtimeMs, size: stats.size });

        const wfId = file.replace('.json', '');
        const wfName = (content.metadata && content.metadata.name) || wfId;
        const actions = Array.isArray(content.actions) ? content.actions : [];
        const startUrl = (content.metadata && content.metadata.startUrl) || (actions[0] && actions[0].url) || '';

        const existing = db.findOne('workflows', wf => wf.id === wfId || wf.name === wfName);

        if (!existing) {
          db.insert('workflows', {
            id: wfId,
            userId: currentUserId || 'system',
            isGlobal: true,
            name: wfName,
            description: (content.metadata && content.metadata.description) || 'Captured browser recording',
            targetUrl: startUrl,
            steps: actions,
            recordingData: content,
            stepCount: actions.length,
            loopStepIndex: content.metadata?.loopStepIndex ?? null,
            isLoop: content.metadata?.isLoop ?? (content.metadata?.loopStepIndex >= 0),
            mode: content.metadata?.mode ?? (content.metadata?.loopStepIndex >= 0 ? 'LOOP' : 'STANDARD'),
            createdAt: (content.metadata && content.metadata.startedAt) || stats.birthtime.toISOString(),
            updatedAt: (content.metadata && content.metadata.completedAt) || stats.mtime.toISOString()
          });
        } else {
          const dbTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
          const fileTime = stats.mtime.getTime();

          // Only overwrite from disk if the file on disk is genuinely newer than the database record
          if (fileTime > dbTime + 2000) {
            const updates = {
              steps: actions,
              recordingData: content,
              stepCount: actions.length,
              updatedAt: new Date(fileTime).toISOString()
            };
            if (!existing.targetUrl && startUrl) {
              updates.targetUrl = startUrl;
            }
            if (!existing.name && wfName) {
              updates.name = wfName;
            }
            if (content.metadata?.loopStepIndex !== undefined) {
              updates.loopStepIndex = content.metadata.loopStepIndex;
            }
            db.update('workflows', existing.id, updates);
          }
        }
      } catch (e) {
        // Skip corrupted JSON files
      }
    }
  } catch (err) {
    console.error('[WorkflowController] Error syncing workflows from disk:', err);
  }
}

/**
 * List workflows for the authenticated user
 * GET /api/workflows
 */
function listWorkflows(req, res) {
  const userId = req.user ? req.user.id : null;
  syncWorkflowsFromDisk(userId);

  const rawList = db.find('workflows', wf => wf.userId === userId || !wf.userId || wf.userId === 'system' || wf.isGlobal);
  
  // Deduplicate by clean ID / name
  const seenIds = new Set();
  const workflows = [];

  for (const w of rawList) {
    const cleanId = w.id.replace(/_use_[a-f0-9-]+$/, '');
    if (!seenIds.has(cleanId) && !seenIds.has(w.id)) {
      seenIds.add(cleanId);
      seenIds.add(w.id);
      workflows.push({
        id: cleanId,
        name: w.name,
        description: w.description || '',
        targetUrl: w.targetUrl || '',
        stepCount: Array.isArray(w.steps) ? w.steps.length : (w.recordingData && Array.isArray(w.recordingData.actions) ? w.recordingData.actions.length : 0),
        createdAt: w.createdAt,
        updatedAt: w.updatedAt
      });
    }
  }

  // Sort newest first
  workflows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return sendJson(res, 200, {
    success: true,
    count: workflows.length,
    workflows
  });
}

/**
 * Get workflow by ID
 * GET /api/workflows/:id
 */
function getWorkflowById(req, res, workflowId) {
  const userId = req.user ? req.user.id : null;
  syncWorkflowsFromDisk(userId);

  let workflow = db.findOne('workflows', wf => wf.id === workflowId && (wf.userId === userId || !wf.userId || wf.userId === 'system' || wf.isGlobal));

  if (!workflow) {
    // Fallback: search without user restriction
    workflow = db.findOne('workflows', wf => wf.id === workflowId);
  }

  if (!workflow) {
    const filePath = path.join(RECORDINGS_DIR, `${workflowId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const actions = Array.isArray(content.actions) ? content.actions : [];
        workflow = db.insert('workflows', {
          id: workflowId,
          userId: userId || 'system',
          isGlobal: true,
          name: (content.metadata && content.metadata.name) || workflowId,
          description: (content.metadata && content.metadata.description) || 'Captured workflow recording',
          targetUrl: (content.metadata && content.metadata.startUrl) || (actions[0] && actions[0].url) || '',
          steps: actions,
          recordingData: content,
          stepCount: actions.length
        });
      } catch (err) {
        return sendJson(res, 500, { error: 'Failed to parse recording from disk' });
      }
    }
  }

  if (!workflow) {
    return sendJson(res, 404, { error: 'Workflow not found or unauthorized' });
  }

  const steps = workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || [];
  return sendJson(res, 200, {
    success: true,
    workflow: {
      ...workflow,
      steps
    }
  });
}

/**
 * Create a new workflow recording
 * POST /api/workflows
 * Body: { name, description, targetUrl, steps, meta }
 */
function createWorkflow(req, res, body) {
  const userId = req.user.id;
  const { name, description, targetUrl, steps, meta } = body || {};

  if (!name || typeof name !== 'string') {
    return sendJson(res, 400, { error: 'Workflow name is required' });
  }

  if (!Array.isArray(steps)) {
    return sendJson(res, 400, { error: 'Workflow steps must be an array' });
  }

  const newWorkflow = db.insert('workflows', {
    userId,
    isGlobal: true,
    name: name.trim(),
    description: (description || '').trim(),
    targetUrl: targetUrl || (steps[0] && steps[0].url) || '',
    steps,
    meta: meta || {}
  });

  return sendJson(res, 201, {
    success: true,
    message: 'Workflow saved successfully',
    workflow: newWorkflow
  });
}

/**
 * Update an existing workflow
 * PUT /api/workflows/:id
 * Body: { name, description, steps, meta }
 */
function updateWorkflow(req, res, workflowId, body) {
  const userId = req.user.id;
  const existing = db.findOne('workflows', wf => wf.id === workflowId && (wf.userId === userId || !wf.userId || wf.isGlobal || wf.userId === 'system'));

  if (!existing) {
    return sendJson(res, 404, { error: 'Workflow not found or unauthorized' });
  }

  const updates = {};
  if (body.name) updates.name = body.name.trim();
  if (body.description !== undefined) updates.description = body.description;
  if (body.targetUrl) updates.targetUrl = body.targetUrl;
  if (body.loopStepIndex !== undefined) updates.loopStepIndex = body.loopStepIndex;
  if (body.isLoop !== undefined) updates.isLoop = Boolean(body.isLoop);
  if (body.mode !== undefined) updates.mode = body.mode;
  if (body.settings) updates.settings = { ...existing.settings, ...body.settings };
  if (Array.isArray(body.steps)) {
    updates.steps = body.steps;
    updates.stepCount = body.steps.length;
    if (existing.recordingData) {
      updates.recordingData = {
        ...existing.recordingData,
        actions: body.steps
      };
    }
  }
  if (body.meta) updates.meta = { ...existing.meta, ...body.meta };
  updates.updatedAt = new Date().toISOString();

  const updated = db.update('workflows', existing.id, updates);

  // CRITICAL: Persist updates back to disk in recordings/ so syncWorkflowsFromDisk won't revert them
  try {
    const filePath = path.join(RECORDINGS_DIR, `${existing.id}.json`);
    let fileContent = {};
    if (fs.existsSync(filePath)) {
      try {
        fileContent = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {}
    }
    if (!fileContent.metadata) fileContent.metadata = {};
    if (updates.name) fileContent.metadata.name = updates.name;
    if (updates.description) fileContent.metadata.description = updates.description;
    if (updates.targetUrl) fileContent.metadata.startUrl = updates.targetUrl;
    if (updates.loopStepIndex !== undefined) fileContent.metadata.loopStepIndex = updates.loopStepIndex;
    if (updates.isLoop !== undefined) fileContent.metadata.isLoop = updates.isLoop;
    if (updates.mode !== undefined) fileContent.metadata.mode = updates.mode;
    fileContent.metadata.updatedAt = updates.updatedAt;
    if (Array.isArray(updates.steps)) {
      fileContent.actions = updates.steps;
    }
    fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 2), 'utf8');
    diskSyncCache.delete(`${existing.id}.json`);
  } catch (err) {
    console.error('[WorkflowController] Failed to persist workflow update to disk:', err.message);
  }

  return sendJson(res, 200, {
    success: true,
    message: 'Workflow updated successfully',
    workflow: updated
  });
}

/**
 * Delete a workflow
 * DELETE /api/workflows/:id
 */
function deleteWorkflow(req, res, workflowId) {
  const userId = req.user.id;
  const existing = db.findOne('workflows', wf => wf.id === workflowId && (wf.userId === userId || !wf.userId || wf.isGlobal || wf.userId === 'system'));

  if (!existing) {
    return sendJson(res, 404, { error: 'Workflow not found or unauthorized' });
  }

  db.delete('workflows', existing.id);

  // Also remove disk file if present
  const filePath = path.join(RECORDINGS_DIR, `${workflowId}.json`);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
  diskSyncCache.delete(`${workflowId}.json`);

  return sendJson(res, 200, {
    success: true,
    message: 'Workflow deleted successfully'
  });
}

module.exports = {
  syncWorkflowsFromDisk,
  listWorkflows,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow
};
