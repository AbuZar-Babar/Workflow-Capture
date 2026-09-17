/**
 * Workflow Capture — Workflow Management API Controller
 * 
 * Provides CRUD operations for captured workflows, scoped per authenticated user.
 */

const { db } = require('../database/db');
const { sendJson } = require('../auth/auth-controller');

/**
 * List workflows for the authenticated user
 * GET /api/workflows
 */
function listWorkflows(req, res) {
  const userId = req.user.id;
  const workflows = db.find('workflows', wf => wf.userId === userId);
  
  return sendJson(res, 200, {
    success: true,
    count: workflows.length,
    workflows: workflows.map(w => ({
      id: w.id,
      name: w.name,
      description: w.description || '',
      targetUrl: w.targetUrl,
      stepCount: Array.isArray(w.steps) ? w.steps.length : 0,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt
    }))
  });
}

/**
 * Get workflow by ID
 * GET /api/workflows/:id
 */
function getWorkflowById(req, res, workflowId) {
  const userId = req.user.id;
  const workflow = db.findOne('workflows', wf => wf.id === workflowId && wf.userId === userId);

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
  const existing = db.findOne('workflows', wf => wf.id === workflowId && wf.userId === userId);

  if (!existing) {
    return sendJson(res, 404, { error: 'Workflow not found or unauthorized' });
  }

  const updates = {};
  if (body.name) updates.name = body.name.trim();
  if (body.description !== undefined) updates.description = body.description;
  if (body.targetUrl) updates.targetUrl = body.targetUrl;
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

  const updated = db.update('workflows', workflowId, updates);

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
  const existing = db.findOne('workflows', wf => wf.id === workflowId && wf.userId === userId);

  if (!existing) {
    return sendJson(res, 404, { error: 'Workflow not found or unauthorized' });
  }

  db.delete('workflows', workflowId);

  return sendJson(res, 200, {
    success: true,
    message: 'Workflow deleted successfully'
  });
}

module.exports = {
  listWorkflows,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow
};
