/**
 * Workflow Discovery Routes
 *
 * Encapsulates the discovery preflight execution endpoint:
 * POST /api/workflows/:id/discover
 */

const fs = require('fs');
const path = require('path');
const { db } = require('../../database/db');
const workflowController = require('../../api/workflow-controller');
const LoopDetector = require('../../shared/loop-detector');
const LoopReplayRunner = require('../../replay/loop-replay-runner');
const ItemDiscovery = require('../../shared/item-discovery');
const { evaluateFilterPreview } = require('../../shared/item-filter');
const { ConditionEvaluator } = require('../../shared/condition-evaluator');
const { PageInspector } = require('../../shared/page-inspector');
const { connectToBrowser } = require('../../utils/cdp-connector');
const { extractWorkflowStartUrl } = require('../../utils/url-helper');
const logger = require('../../utils/logger');
const ReplayEngine = require('../../replay/replay-engine');
const { requireAuth } = require('../../auth/auth-middleware');

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

/**
 * Handle discovery preflight for a workflow.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} workflowId
 * @param {object} body
 */
async function handleDiscoverWorkflow(req, res, workflowId, body = {}) {
  if (!requireAuth(req, res)) return;

  if (body.loopStepIndex !== undefined && body.loopStepIndex !== null && !Number.isInteger(body.loopStepIndex)) {
    return sendJson(res, 400, { error: 'loopStepIndex must be an integer' });
  }

  try {
    if (workflowController.syncWorkflowsFromDisk) {
      workflowController.syncWorkflowsFromDisk(req.user ? req.user.id : null);
    }

    let workflow = db.findOne('workflows', wf =>
      wf.id === workflowId && (!req.user || wf.userId === req.user.id || !wf.userId || wf.userId === 'system' || wf.isGlobal)
    );
    if (!workflow) workflow = db.findOne('workflows', wf => wf.id === workflowId);
    if (!workflow) return sendJson(res, 404, { error: 'Workflow not found or unauthorized' });

    const steps = workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || [];
    if (!steps.length) return sendJson(res, 400, { error: 'Workflow contains no recorded actions' });

    let loopStepIndex = Number.isInteger(body.loopStepIndex) ? body.loopStepIndex : null;
    if (loopStepIndex === null) {
      const candidateIdx = LoopDetector.findLoopCandidateIndex(steps);
      const wfLoopIdx = Number.isInteger(workflow.loopStepIndex)
        ? workflow.loopStepIndex
        : (Number.isInteger(workflow.metadata?.loopStepIndex) ? workflow.metadata.loopStepIndex : null);

      if (Number.isInteger(wfLoopIdx) && wfLoopIdx >= 0 && wfLoopIdx < steps.length) {
        const currentStepAnalysis = LoopDetector.analyzeStep(steps[wfLoopIdx]);
        if (!currentStepAnalysis.isLoopCandidate && candidateIdx >= 0) {
          loopStepIndex = candidateIdx;
        } else if (candidateIdx >= 0 && candidateIdx > wfLoopIdx) {
          loopStepIndex = candidateIdx;
        } else {
          loopStepIndex = wfLoopIdx;
        }
      } else {
        loopStepIndex = candidateIdx >= 0 ? candidateIdx : 0;
      }
    }

    const partition = LoopDetector.partitionWorkflow(steps, loopStepIndex);
    const targetStep = partition.loopSteps[0];
    if (!targetStep) return sendJson(res, 400, { error: 'No loop target action could be identified' });

    const { browser, page } = await connectToBrowser();
    try {
      await page.bringToFront().catch(() => {});
      const currentUrl = page.url();
      const targetUrl = extractWorkflowStartUrl(workflow) || targetStep.url;
      let shouldNavigate = false;
      if (targetUrl) {
        try {
          const currentOrigin = new URL(currentUrl).origin;
          const targetOrigin = new URL(targetUrl).origin;
          if (currentUrl === 'about:blank' || currentOrigin !== targetOrigin) {
            shouldNavigate = true;
          }
        } catch {
          if (currentUrl === 'about:blank') shouldNavigate = true;
        }
      }

      if (shouldNavigate && targetUrl) {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 600));
      }

      const engine = new ReplayEngine({ cdpPort: 9222 });
      engine.page = page;
      await engine._ensureSelectorResolverInFrame(page.mainFrame());

      // 1. Check if the target collection is ALREADY open and visible in DOM before running setup steps
      let discovery = await ItemDiscovery.discover(page, targetStep.target || targetStep.fingerprint, {
        minItems: 2,
        minScore: 0.55
      }).catch(() => ({ success: false }));

      const alreadyOpen = Boolean(discovery && discovery.success && discovery.itemCount >= 2);
      if (alreadyOpen) {
        logger.info(`[Discovery] Target collection already open and visible in DOM (${discovery.itemCount} items). Skipping setup steps.`);
      } else if (partition.setupSteps.length > 0) {
        try {
          for (let i = 0; i < partition.setupSteps.length; i++) {
            const step = partition.setupSteps[i];
            const isLogin = (step.target?.candidates?.some(c => /login|signin/i.test(c.value || ''))) ||
              /login|signin/i.test(step.name || step.elementName || '');
            const isCurrentLogin = /\/login\b/i.test(page.url());
            if (isLogin && !isCurrentLogin) {
              continue;
            }

            await engine.executeAction(step, i);

            // If step triggers navigation or ASP.NET postback, await settling
            if (step.type === 'SELECT' || (step.type === 'CLICK' && step.target?.fingerprint?.attributes?.href)) {
              await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4000 }).catch(() => {});
            }
            await new Promise(resolve => setTimeout(resolve, 600));
          }
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (setupErr) {
          logger.warn(`[Discovery] Setup execution note: ${setupErr.message}`);
        }

        // Re-run discovery after setup steps
        discovery = await ItemDiscovery.discover(page, targetStep.target || targetStep.fingerprint, {
          minItems: 2,
          minScore: 0.55
        }).catch(() => ({ success: false }));
      }

      // 2. Autonomous Full-Page Inspection
      const pageInspection = await PageInspector.inspectPage(page).catch(() => ({ success: false }));
      const pageSummary = pageInspection.summary || null;

      // 3. Multi-table disambiguation: elevate real data tables with explicit headers & action controls
      const discoveryHasWeakHeaders = !discovery.collection?.headerColumns || discovery.collection.headerColumns.length === 0;
      const discoveryItemsLackFields = Array.isArray(discovery.items) && discovery.items.length > 0 &&
        discovery.items.every(it => !it.fields || Object.keys(it.fields).filter(k => !k.startsWith('_') && k !== 'Text' && k !== 'Date').length === 0);

      if ((!discovery.success || discovery.collection?.itemTag === 'li' || discoveryHasWeakHeaders || discoveryItemsLackFields) && pageSummary?.entities?.length > 0) {
        const targetText = String(targetStep.target?.fingerprint?.text || targetStep.target?.candidates?.[0]?.value || '').toLowerCase();
        let tableEntity = null;
        if (targetText) {
          tableEntity = pageSummary.entities.find(e =>
            e.type === 'table_grid' && e.itemCount >= 2 &&
            (e.columns?.some(c => targetText.includes(c.toLowerCase()) || c.toLowerCase().includes(targetText)) ||
             (e.rows || e.sampleRows || []).some(r => Object.values(r).some(v => String(v).toLowerCase().includes(targetText))))
          );
        }
        if (!tableEntity) {
          // Prioritize real data tables with download links and explicit headers over headerless layout/profile tables
          const tableGridCandidates = pageSummary.entities.filter(e => e.type === 'table_grid' && e.itemCount >= 2);
          tableEntity = tableGridCandidates.find(e => e.hasDownloadLinks || e.actionColumn) ||
                        tableGridCandidates.find(e => e.hasExplicitHeaders && e.columns?.length >= 2) ||
                        tableGridCandidates.find(e => !e.isKeyValueLayout) ||
                        tableGridCandidates[0];
        }
        if (tableEntity) {
          const targetCol = tableEntity.actionColumn || (tableEntity.columns || []).find(c => /download|file|link|export/i.test(c)) || null;
          const targetVal = tableEntity.actionText || 'Download';
          if (!discovery.success || discovery.collection?.itemTag === 'li') {
            discovery = {
              success: true,
              confidence: 0.95,
              itemCount: tableEntity.itemCount,
              targetColumn: targetCol,
              targetActionValue: targetVal,
              collection: {
                itemTag: 'tr',
                ancestorTag: 'tbody',
                ancestorSelector: 'table tbody',
                headerColumns: tableEntity.columns
              },
              items: (tableEntity.rows || tableEntity.sampleRows).map((row, idx) => ({
                index: idx,
                text: Object.values(row).filter(Boolean).join(' '),
                fields: row,
                tagName: 'tr'
              })),
              availableFields: tableEntity.columns
            };
          } else {
            // Enrich existing discovery collection and items with the complete headers & row fields
            discovery.collection = discovery.collection || {};
            discovery.collection.headerColumns = tableEntity.columns;
            discovery.availableFields = Array.from(new Set([...(discovery.availableFields || []), ...tableEntity.columns]));
            if (targetCol && !discovery.targetColumn) discovery.targetColumn = targetCol;
            if (targetVal && !discovery.targetActionValue) discovery.targetActionValue = targetVal;

            const tableRows = tableEntity.rows || tableEntity.sampleRows || [];
            if (Array.isArray(discovery.items) && tableRows.length > 0) {
              discovery.items.forEach((item, idx) => {
                const rowObj = tableRows[idx];
                if (rowObj) {
                  item.fields = Object.assign({}, rowObj, item.fields || {});
                }
              });
            }
          }
        }
      }

      let availableFields = [];
      let filterPreview = null;

      // Scan workflow downloads folder and database to identify which items are already downloaded (old) vs new
      const workflowSlug = (workflow.name || workflowId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
      const workflowDlDir = path.join(process.cwd(), 'downloads', workflowSlug);
      let existingFiles = [];
      if (fs.existsSync(workflowDlDir)) {
        try {
          existingFiles = fs.readdirSync(workflowDlDir, { recursive: true }).filter(f => typeof f === 'string');
        } catch {}
      }
      const dbRecords = db.find('downloads', d => d.workflowId === workflowId) || [];

      // Extract distinct values and enrich items with download / old data status
      const fieldValues = {};
      const items = Array.isArray(discovery.items) ? discovery.items : [];

      if (discovery.success) {
        let itemsWithFields = items;
        try {
          if (page && typeof LoopReplayRunner.extractDiscoveredItems === 'function') {
            const extracted = await LoopReplayRunner.extractDiscoveredItems(page, discovery);
            if (Array.isArray(extracted) && extracted.length > 0) {
              itemsWithFields = extracted;
              if (Array.isArray(discovery.items)) {
                discovery.items.forEach((item, idx) => {
                  if (itemsWithFields[idx]) {
                    item.fields = itemsWithFields[idx].fields || item.fields || {};
                  }
                });
              }
            }
          }
        } catch (err) {
          logger.warn(`[Preflight] Could not extract live fields: ${err.message}`);
        }

        for (const item of items) {
          const f = item.fields || {};
          const invNum = f['Invoice Number'] || f['Invoice No'] || f['Invoice #'] ||
            (item.text && item.text.match(/\b((?:SI|INV|DR|TX|CM)-\d+(?:[-_]\w+)*|\b\d{5,10}\b)/i)?.[1]) || null;

          let isDownloaded = false;
          let downloadedFile = null;
          if (invNum) {
            const fileMatch = existingFiles.find(ef => path.basename(ef).toLowerCase().includes(invNum.toLowerCase()));
            if (fileMatch) {
              isDownloaded = true;
              downloadedFile = path.basename(fileMatch);
            } else {
              const dbMatch = dbRecords.find(d =>
                (d.filename && d.filename.toLowerCase().includes(invNum.toLowerCase())) ||
                (d.itemKey && d.itemKey.toLowerCase().includes(invNum.toLowerCase())) ||
                (d.itemLabel && d.itemLabel.toLowerCase().includes(invNum.toLowerCase()))
              );
              if (dbMatch) {
                isDownloaded = true;
                downloadedFile = dbMatch.filename || 'database record';
              }
            }
          }

          let isOldData = isDownloaded;
          if (!isOldData) {
            if (f['Days Old'] && parseInt(f['Days Old'], 10) > 0) {
              isOldData = true;
            } else if (f['Due Date']) {
              const parsedDue = new Date(f['Due Date']);
              if (!isNaN(parsedDue.getTime()) && parsedDue.getTime() <= Date.now()) {
                isOldData = true;
              }
            }
          }

          item.isDownloaded = isDownloaded;
          item.downloadedFile = downloadedFile;
          item.isOldData = isOldData;

          if (item && item.fields && typeof item.fields === 'object') {
            for (const [k, v] of Object.entries(item.fields)) {
              if (v == null || v === '') continue;
              const key = String(k).trim();
              const val = String(v).trim();
              if (!fieldValues[key]) fieldValues[key] = new Set();
              fieldValues[key].add(val);
            }
          }
          if (item && item.text) {
            const textVal = String(item.text).trim();
            if (textVal) {
              if (!fieldValues['Text']) fieldValues['Text'] = new Set();
              fieldValues['Text'].add(textVal);
            }
          }
        }

        const defaultFilter = (discovery.targetColumn && discovery.targetActionValue)
          ? { field: discovery.targetColumn, operator: 'contains', value: discovery.targetActionValue }
          : null;

        const effectiveFilter = body.itemFilter !== undefined
          ? body.itemFilter
          : (body.rowFilter || (body.filterValue ? { column: body.filterColumn || discovery.targetColumn || 'Type', value: body.filterValue } : defaultFilter));

        try {
          const rawOp = String(effectiveFilter?.operator || effectiveFilter?.op || '').toLowerCase().trim();
          const isRelational = ['<=', '>=', '<', '>', 'before', 'after', 'starts_with', 'ends_with', 'in', 'not_in', '!=', 'not_equals', 'date_before', 'date_after', 'date_on_or_after', 'date_on_or_before', 'date_between'].includes(rawOp);

          if (isRelational) {
            let matchingCount = 0;
            let selectedCount = 0;
            let skippedFilterCount = 0;
            let skippedLimitCount = 0;
            const selectedPreview = [];
            const skippedFilterPreview = [];
            const limit = Number.isInteger(body.loopLimit) && body.loopLimit > 0 ? body.loopLimit : null;

            for (let i = 0; i < itemsWithFields.length; i++) {
              const item = itemsWithFields[i];
              const fieldsMap = item?.fields || item || {};
              const evalRes = ConditionEvaluator.evaluate(fieldsMap, effectiveFilter);
              if (evalRes.matches) {
                matchingCount++;
                if (limit === null || selectedCount < limit) {
                  selectedCount++;
                  if (selectedPreview.length < 10) selectedPreview.push(item);
                } else {
                  skippedLimitCount++;
                }
              } else {
                skippedFilterCount++;
                if (skippedFilterPreview.length < 10) skippedFilterPreview.push(item);
              }
            }
            filterPreview = {
              totalCount: itemsWithFields.length,
              matchingCount,
              selectedCount,
              skippedFilterCount,
              skippedLimitCount,
              skippedCount: skippedFilterCount,
              selectedPreview,
              skippedFilterPreview,
              skippedPreview: skippedFilterPreview,
              availableFields: discovery.availableFields || [],
              errors: []
            };
          } else {
            filterPreview = evaluateFilterPreview(effectiveFilter, itemsWithFields, {
              loopLimit: body.loopLimit !== undefined ? body.loopLimit : null,
              previewLimit: 10
            });
          }
        } catch (err) {
          logger.warn(`[Preflight] evaluateFilterPreview error: ${err.message}`);
        }
      } else {
        filterPreview = {
          totalCount: 0,
          matchingCount: 0,
          selectedCount: 0,
          skippedFilterCount: 0,
          skippedLimitCount: 0,
          skippedCount: 0,
          selectedPreview: [],
          skippedFilterPreview: [],
          skippedLimitPreview: [],
          skippedPreview: [],
          availableFields: [],
          errors: [discovery.reason || 'Item discovery failed']
        };
      }

      const fieldValuesJson = {};
      for (const [k, vSet] of Object.entries(fieldValues)) {
        fieldValuesJson[k] = Array.from(vSet).slice(0, 30);
      }

      const stepsSummary = steps.map((s, idx) => ({
        index: idx,
        type: s.type || s.action || 'CLICK',
        target: s.target?.fingerprint?.text || s.target?.fingerprint?.title || s.target?.fingerprint?.tagName || s.role || `Step #${idx + 1}`,
        selector: s.target?.candidates?.[0]?.value || '',
        isLoopCandidate: idx === loopStepIndex || s.isLoop || s.role === 'LOOP_TARGET'
      }));

      const availableFieldsSet = new Set(discovery.availableFields || []);
      for (const k of Object.keys(fieldValuesJson)) {
        if (k && !['fullText', 'label', 'isSelectAll', '_rawText'].includes(k)) availableFieldsSet.add(k);
      }
      if (!discovery.success && pageSummary?.entities?.length > 0) {
        for (const entity of pageSummary.entities) {
          if (Array.isArray(entity.columns)) {
            for (const c of entity.columns) {
              if (c && !c.startsWith('_')) availableFieldsSet.add(c);
            }
          }
        }
      }
      for (const item of items) {
        if (item && item.fields) {
          for (const k of Object.keys(item.fields)) {
            if (k && !['fullText', 'label', 'isSelectAll', '_rawText'].includes(k)) availableFieldsSet.add(k);
          }
        }
      }
      availableFields = Array.from(availableFieldsSet);
      if (discovery) discovery.availableFields = availableFields;

      return sendJson(res, discovery.success ? 200 : 422, {
        success: discovery.success,
        workflowId,
        workflowName: workflow.name,
        loopStepIndex,
        actionsPerItem: partition.loopSteps.length,
        setupActionCount: partition.setupSteps.length,
        targetAction: targetStep.type || targetStep.action || 'ACTION',
        targetUrl: page.url(),
        discovery,
        availableFields,
        filterPreview,
        fieldValues: fieldValuesJson,
        steps: stepsSummary,
        pageSummary
      });
    } finally {
      await browser.disconnect().catch(() => {});
    }
  } catch (err) {
    logger.error('[Discovery] Failed:', err);
    return sendJson(res, 500, { error: err.message });
  }
}

module.exports = {
  handleDiscoverWorkflow,
  sendJson
};
