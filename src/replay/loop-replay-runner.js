/**
 * Workflow Capture — Intelligent Replay & Batch Execution Runner
 * Slim Facade coordinating specialized loop execution collaborators:
 * LoopStateCoordinator, ArtifactDownloadManager, GridSelectionAdapter, ItemExecutionHandler
 */

const path = require('path');
const fs = require('fs');
const ReplayEngine = require('./replay-engine');
const logger = require('../utils/logger');
const { db } = require('../database/db');
const { decryptSecret } = require('../auth/secret-util');
const { extractWorkflowStartUrl } = require('../utils/url-helper');
const PaginationManager = require('./pagination-manager');
const ResultValidator = require('./result-validator');
const { detectLoginSequence, isSessionAuthenticated } = require('../shared/auth-detector');

const LoopStateCoordinator = require('./loop/loop-state-coordinator');
const ArtifactDownloadManager = require('./loop/artifact-download-manager');
const GridSelectionAdapter = require('./loop/grid-selection-adapter');
const ItemExecutionHandler = require('./loop/item-execution-handler');

class LoopReplayRunner {
  constructor(options = {}) {
    this.cdpPort = options.cdpPort || 9222;
    this.runId = options.runId || `run_${Date.now()}`;
    this.workflowId = options.workflowId || null;
    this.workflowName = options.workflowName || 'workflow';
    this.forceRedownload = options.forceRedownload === true;
    this.itemMode = ['new', 'old', 'all'].includes(options.itemMode) ? options.itemMode : 'new';
    this.maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0 ? options.maxItems : null;
    this.maxItemRetries = Number.isInteger(options.maxItemRetries) ? Math.max(0, options.maxItemRetries) : 1;
    this.resumeFromCheckpoint = options.resumeFromCheckpoint === true;
    this.isAborted = false;
    this._limitReached = false;
    this._activeItemContext = null;

    this.stateCoordinator = new LoopStateCoordinator({
      runId: this.runId, workflowId: this.workflowId, workflowName: this.workflowName,
      itemMode: this.itemMode, maxItems: this.maxItems, maxItemRetries: this.maxItemRetries,
      resumeFromCheckpoint: this.resumeFromCheckpoint, itemFilter: options.itemFilter,
      rowFilter: options.rowFilter, filterValue: options.filterValue,
      filterColumn: options.filterColumn, loopLimit: options.loopLimit
    });

    this.downloadManager = new ArtifactDownloadManager({
      runId: this.runId, workflowId: this.workflowId, workflowName: this.workflowName,
      userId: options.userId, forceRedownload: this.forceRedownload,
      targetUrl: options.targetUrl || options.portalUrl, portalDomain: options.portalDomain,
      runTimestamp: options.runTimestamp, startedAt: options.startedAt
    });

    this.gridAdapter = new GridSelectionAdapter();
    this.replayEngine = new ReplayEngine({ cdpPort: this.cdpPort });

    this.itemHandler = new ItemExecutionHandler({
      maxItemRetries: this.maxItemRetries, gridAdapter: this.gridAdapter,
      downloadManager: this.downloadManager, stateCoordinator: this.stateCoordinator,
      replayEngine: this.replayEngine, getIsAborted: () => this.isAborted
    });

    this.paginationManager = new PaginationManager({ maxPages: options.maxPages || 25 });
    this.resultValidator = new ResultValidator({
      executionId: this.runId, workflowId: this.workflowId, workflowName: this.workflowName
    });
  }

  // --- Backwards-Compatible Property Accessors ---
  get runsDir() { return this.downloadManager.runsDir; }
  get downloadsDir() { return this.downloadManager.downloadsDir; }
  get workflowSlug() { return this.downloadManager.workflowSlug; }
  set workflowSlug(v) { this.downloadManager.workflowSlug = v; }
  get dateStr() { return this.downloadManager.dateStr; }
  get structuredDownloadsDir() { return this.downloadManager.structuredDownloadsDir; }
  set structuredDownloadsDir(v) { this.downloadManager.structuredDownloadsDir = v; }
  get workflowDownloadsBaseDir() { return this.downloadManager.workflowDownloadsBaseDir; }
  set workflowDownloadsBaseDir(v) { this.downloadManager.workflowDownloadsBaseDir = v; }
  get portalDomain() { return this.downloadManager.portalDomain; }
  set portalDomain(v) { this.downloadManager.portalDomain = v; }
  get runTimestamp() { return this.downloadManager.runTimestamp; }
  get runDomainDir() { return this.downloadManager.runDomainDir; }
  get executionDownloadsDir() { return this.downloadManager.executionDownloadsDir; }
  get itemFilter() { return this.stateCoordinator.itemFilter; }
  get rowFilter() { return this.stateCoordinator.rowFilter; }
  set rowFilter(v) { this.stateCoordinator.rowFilter = v; }
  get filterValidationError() { return this.stateCoordinator.filterValidationError; }
  get loopLimit() { return this.stateCoordinator.loopLimit; }
  get loopLimitError() { return this.stateCoordinator.loopLimitError; }
  get _lastCursor() { return this.stateCoordinator._lastCursor; }
  set _lastCursor(v) { this.stateCoordinator._lastCursor = v; }

  // --- Lifecycle Methods ---
  async stop() {
    this.isAborted = true;
    logger.warn(`[Runner] Stop signal triggered for run: ${this.runId}`);
    if (this.replayEngine && typeof this.replayEngine.abort === 'function') await this.replayEngine.abort().catch(() => {});
  }

  async start(workflow, options = {}) {
    if (!workflow) return { success: false, error: 'No workflow provided' };
    if (workflow.isLoop || options.isLoop || options.mode === 'loop') {
      return this.executeLoop(workflow, options.loopStepIndex ?? workflow.loopStepIndex, options.onProgress);
    }
    return this.executeStandard(workflow, options.onProgress);
  }

  // --- Prototype Delegation Hooks for Complete Test & API Compatibility ---
  initDirectories() { return this.downloadManager.initDirectories(); }
  processAndStoreDownload(src, key, lbl, flds) { return this.downloadManager.processAndStoreDownload(src, key, lbl, flds); }
  syncWorkflowDownloadsManifest(rec) { return this.downloadManager.syncWorkflowDownloadsManifest(rec); }
  checkIfAlreadyDownloaded(key, inv, flds, hash) { return this.downloadManager.checkIfAlreadyDownloaded(key, inv, flds, hash); }
  waitForDownload(snap, timeout) { return this.downloadManager.waitForDownload(snap, timeout); }
  snapshotDownloadedFiles() { return this.downloadManager.snapshotDownloadedFiles(); }
  configureDownloadInterception(page) { return this.downloadManager.configureDownloadInterception(page); }
  writeLoopCheckpoint(m, i, o, p, pi, a) { return this.stateCoordinator.writeLoopCheckpoint(m, i, o, p, pi, a); }
  loadLoopCheckpoint(wf) { return this.stateCoordinator.loadLoopCheckpoint(wf); }
  isCollectionPresent(page, disc) { return this.gridAdapter.isCollectionPresent(page, disc); }
  clearGridSelections(page, disc) { return this.gridAdapter.clearGridSelections(page, disc); }
  enforceGridRowSingleSelection(page, disc, idx) { return this.gridAdapter.enforceGridRowSingleSelection(page, disc, idx); }
  isDropdownOptionCollection(coll, items) { return this.gridAdapter.isDropdownOptionCollection(coll, items); }
  ensureDropdownOpen(page, trig) { return this.gridAdapter.ensureDropdownOpen(page, trig, this.replayEngine); }
  executeDropdownOptionSingleSelect(page, idx, txt) { return this.gridAdapter.executeDropdownOptionSingleSelect(page, idx, txt); }
  findNextPageTarget(page, wf) { return this.gridAdapter.findNextPageTarget(page, wf); }
  getCollectionFingerprint(page, coll) { return this.gridAdapter.getCollectionFingerprint(page, coll); }
  advanceToNextPage(page, wf) { return this.gridAdapter.advanceToNextPage(page, wf, this.replayEngine); }
  extractItemIdentifier(page, disc, idx, isDrop) { return this.itemHandler.extractItemIdentifier(page, disc, idx, isDrop); }
  evaluateItemFilter(page, disc, idx, filter) { return this.itemHandler.evaluateItemFilter(page, disc, idx, filter); }
  detectAndFilterItems(page, disc, isDrop, filter) { return this.itemHandler.detectAndFilterItems(page, disc, isDrop, filter); }
  static async extractDiscoveredItems(page, disc) { return ItemExecutionHandler.extractDiscoveredItems(page, disc); }

  syncWorkflowMetadata(workflow) {
    if (!workflow) return;
    if (!this.workflowId) this.workflowId = workflow.id || workflow.metadata?.recordingId;
    if (!this.workflowName || this.workflowName === 'workflow') this.workflowName = workflow.name || workflow.metadata?.name || workflow.id || 'workflow';
    const targetUrl = workflow.targetUrl || workflow.startUrl || workflow.steps?.[0]?.url || '';
    if (targetUrl && (!this.portalDomain || this.portalDomain === 'customerportal.usoil.com')) {
      try { this.downloadManager.setPortalDomain(new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`).hostname); } catch {}
    }
  }

  async navigateToWorkflowTarget(page, workflow) {
    const resolved = extractWorkflowStartUrl(workflow);
    if (!resolved) return;
    try { await page.bringToFront().catch(() => {}); } catch {}
    const currentUrl = page.url();
    let shouldNavigate = currentUrl === 'about:blank' || currentUrl.startsWith('chrome://');
    if (!shouldNavigate) {
      try {
        if (new URL(currentUrl).origin !== new URL(resolved).origin) {
          shouldNavigate = true;
        } else {
          const isTargetLogin = /\/login\b|\/signin\b|\/auth\b/i.test(resolved) || /#(.*)\/(login|signin)/i.test(resolved);
          const isCurrentLogin = /\/login\b|\/signin\b|\/auth\b/i.test(currentUrl) || /#(.*)\/(login|signin)/i.test(currentUrl);
          if (!isTargetLogin || isCurrentLogin) shouldNavigate = currentUrl !== resolved && isCurrentLogin;
        }
      } catch { shouldNavigate = currentUrl !== resolved; }
    }
    if (shouldNavigate) {
      try {
        await page.goto(resolved, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (this.replayEngine?._applyStealthEvasion) await this.replayEngine._applyStealthEvasion();
        await new Promise(r => setTimeout(r, 600));
      } catch (e) { logger.warn(`[Runner] Auto-navigation note: ${e.message}`); }
    }
  }

  async setupPageAndEngine(workflow) {
    if (this.replayEngine) { this.replayEngine.isPaused = false; this.replayEngine.isAborted = false; }
    const browser = await this.replayEngine.connect();
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    this.replayEngine.page = page;
    this.replayEngine.secretResolver = async (secretId) => {
      const secret = db.findOne('secrets', s => s.id === secretId && s.userId === workflow.userId);
      if (secret?.encryptedData) {
        try { return decryptSecret(secret.encryptedData); } catch (e) { logger.warn(`Decrypt failed: ${e.message}`); }
      }
      return `{{secret:${secretId}}}`;
    };
    await this.configureDownloadInterception(page);
    const steps = workflow.steps || workflow.recordingData?.actions || workflow.actions || [];
    this.replayEngine.recording = workflow.recordingData || { actions: steps };
    await this.navigateToWorkflowTarget(page, workflow);
    await this.replayEngine._ensureSelectorResolverInFrame(page.mainFrame()).catch(() => {});
    return page;
  }

  finalizeRun(manifest, onProgress) {
    manifest.endTime = manifest.endTime || new Date().toISOString();
    if (this.isAborted) manifest.status = 'STOPPED';
    try {
      if (this.isAborted && this._lastCursor) {
        this.writeLoopCheckpoint(manifest, this._lastCursor.currentItemIndex, this._lastCursor.currentActionOffset, this._lastCursor.currentPage || 1, this._lastCursor.currentPageItemIndex, this._lastCursor.activeItem);
      } else if (manifest.status === 'COMPLETED' || manifest.status === 'COMPLETED_WITH_ERRORS') {
        this.writeLoopCheckpoint(manifest, null, null, manifest.pagesProcessed || 1, null, null);
      }
      fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {}
    this.downloadManager.teardownDownloadInterception(this.replayEngine?.browser);
    if (this.replayEngine) this.replayEngine.disconnect().catch(() => {});
    if (typeof onProgress === 'function') onProgress({ status: manifest.status, manifest });
  }

  async executeStandard(workflow, onProgress = () => {}) {
    this.syncWorkflowMetadata(workflow);
    this.initDirectories();
    const steps = workflow.steps || workflow.recordingData?.actions || workflow.actions || [];
    const manifest = this.stateCoordinator.createStandardManifest(workflow, steps.length);
    this.manifest = manifest;
    logger.info(`[Runner] Starting standard execution run ${this.runId} for "${workflow.name}" (${steps.length} steps)`);
    onProgress({ status: 'STARTING', manifest });

    try {
      const page = await this.setupPageAndEngine(workflow);
      await this.itemHandler.executeStandardSteps({ page, steps, manifest, onProgress, runner: this });
      this.downloadManager.organizePendingDownloads(manifest);
      manifest.status = this.isAborted ? 'STOPPED' : 'COMPLETED';
    } catch (err) {
      manifest.status = this.isAborted ? 'STOPPED' : 'FAILED'; manifest.error = err.message;
    } finally {
      this.finalizeRun(manifest, onProgress);
    }
    return manifest;
  }

  async executeLoop(workflow, loopStepIndex = null, onProgress = () => {}) {
    this._limitReached = false;
    this.syncWorkflowMetadata(workflow);
    this.initDirectories();
    const manifest = this.stateCoordinator.createLoopManifest(workflow);
    const checkpoint = this.loadLoopCheckpoint(workflow);
    this.stateCoordinator.applyCheckpoint(manifest, checkpoint);
    this.manifest = manifest;
    this._lastCursor = this.stateCoordinator.extractCursor(checkpoint);

    logger.info(`[Loop Runner] Starting execution run ${this.runId} for workflow "${workflow.name}"`);
    onProgress({ status: checkpoint ? 'RESUMING' : 'STARTING', manifest, checkpoint });

    try {
      const page = await this.setupPageAndEngine(workflow);
      const prep = await this.itemHandler.prepareCollection({
        page, workflow, loopStepIndex, manifest, checkpoint, onProgress, runner: this
      });
      if (prep.fallbackToStandard) return await this.executeStandard(workflow, onProgress);

      const preview = this.itemHandler.evaluateCollectionPreview({
        items: prep.itemsWithFields,
        filter: this.itemFilter || this.rowFilter,
        limit: this.loopLimit,
        validationError: this.filterValidationError || this.loopLimitError
      });

      if (prep.itemsWithFields.length > 0 && preview.selectedCount === 0) {
        return await this.itemHandler.handleZeroMatches({
          page, discovery: prep.discovery, isDropdown: prep.isDropdown, itemsWithFields: prep.itemsWithFields,
          preview, manifest, isRelational: preview.isRelational, effectiveFilter: preview.effectiveFilter,
          onProgress, runner: this
        });
      }

      await this.itemHandler.runPaginationLoop({
        page, workflow, manifest, checkpoint, prep, runner: this, onProgress
      });

      this.downloadManager.organizePendingDownloads(manifest, this._activeItemContext);
      manifest.status = this.isAborted ? 'STOPPED' : (manifest.itemsFailed > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED');
      logger.success(`\n[Loop Runner] Run ${this.runId} ${manifest.status}! Succeeded: ${manifest.itemsSucceeded}, Failed: ${manifest.itemsFailed}`);
    } catch (err) {
      manifest.status = this.isAborted ? 'STOPPED' : 'FAILED'; manifest.error = err.message;
      logger.error(`[Loop Runner] Fatal run failure: ${err.message}`);
    } finally {
      this.finalizeRun(manifest, onProgress);
    }
    return manifest;
  }
}

module.exports = LoopReplayRunner;
