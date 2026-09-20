/**
 * Workflow Capture — Intelligent Replay & Batch Execution Runner
 * 
 * Executes standard sequential workflows and generalized loops over table rows,
 * list items, or grids. Manages auto-navigation to target URLs, CDP file download
 * interception, per-item state restoration, and error isolation.
 */

const fs = require('fs');
const path = require('path');
const ReplayEngine = require('./replay-engine');
const LoopDetector = require('../shared/loop-detector');
const ItemDiscovery = require('../shared/item-discovery');
const ActionGeneralizer = require('../shared/action-generalizer');
const logger = require('../utils/logger');
const { db } = require('../database/db');
const { decryptSecret } = require('../auth/secret-util');
const { resolveTargetUrl } = require('../utils/url-helper');

class LoopReplayRunner {
  constructor(options = {}) {
    this.cdpPort = options.cdpPort || 9222;
    this.runId = options.runId || `run_${Date.now()}`;
    this.runsDir = path.resolve(process.cwd(), 'recordings', 'runs', this.runId);
    this.downloadsDir = path.join(this.runsDir, 'downloads');
    this.replayEngine = new ReplayEngine({ cdpPort: this.cdpPort });
    this.maxItemRetries = Number.isInteger(options.maxItemRetries) ? Math.max(0, options.maxItemRetries) : 1;
    this.isAborted = false;
  }

  /**
   * Abort/stop the current execution immediately
   */
  async stop() {
    this.isAborted = true;
    logger.warn(`[Runner] Stop signal triggered for run: ${this.runId}`);
    if (this.replayEngine && typeof this.replayEngine.abort === 'function') {
      await this.replayEngine.abort().catch(() => {});
    }
  }

  initDirectories() {
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }
  }

  /**
   * Wait for a new completed download in this run's download directory.
   */
  async waitForDownload(previousFiles = [], timeoutMs = 10000) {
    const startedAt = Date.now();
    const previous = new Set(previousFiles);
    while (Date.now() - startedAt < timeoutMs) {
      const files = fs.existsSync(this.downloadsDir)
        ? fs.readdirSync(this.downloadsDir)
        : [];
      const candidates = files.filter(file => !previous.has(file) && !file.endsWith('.crdownload'));
      if (candidates.length) {
        return candidates.map(filename => ({
          filename,
          path: path.join(this.downloadsDir, filename),
          sizeBytes: fs.statSync(path.join(this.downloadsDir, filename)).size
        }));
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return [];
  }

  snapshotDownloadedFiles() {
    return fs.existsSync(this.downloadsDir) ? fs.readdirSync(this.downloadsDir) : [];
  }

  writeLoopCheckpoint(manifest, currentItemIndex = null, currentActionOffset = null) {
    const checkpoint = {
      runId: manifest.runId,
      workflowId: manifest.workflowId,
      mode: manifest.mode,
      status: manifest.status,
      currentItemIndex,
      currentActionOffset,
      completedItemIndexes: manifest.results
        .filter(result => result.status === 'SUCCESS')
        .map(result => result.index),
      itemsSucceeded: manifest.itemsSucceeded,
      itemsFailed: manifest.itemsFailed,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(this.runsDir, 'checkpoint.json'),
      JSON.stringify(checkpoint, null, 2)
    );
  }

  async configureDownloadInterception(page) {
    this.initDirectories();
    try {
      const client = await page.target().createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: this.downloadsDir
      });
      logger.info(`[Runner] Configured CDP download path: ${this.downloadsDir}`);
      return client;
    } catch (err) {
      logger.warn(`[Runner] Warning configuring CDP download behavior: ${err.message}`);
      return null;
    }
  }

  /**
   * Navigate browser to the workflow's designated target/start URL
   */
  async navigateToWorkflowTarget(page, workflow) {
    let targetUrl = workflow.targetUrl ||
      (workflow.recordingData && workflow.recordingData.metadata && workflow.recordingData.metadata.startUrl) ||
      (workflow.metadata && workflow.metadata.startUrl) ||
      (workflow.steps && workflow.steps[0] && workflow.steps[0].url) ||
      null;

    const resolved = resolveTargetUrl(targetUrl);
    if (!resolved) {
      logger.info('[Runner] No target URL specified for workflow. Executing on active tab.');
      return;
    }

    try {
      await page.bringToFront().catch(() => {});
    } catch {}

    const currentUrl = page.url();
    if (currentUrl === 'about:blank' || currentUrl.startsWith('chrome://') || currentUrl !== resolved) {
      logger.info(`[Runner] Navigating tab from "${currentUrl}" to workflow target URL: ${resolved}`);
      try {
        await page.goto(resolved, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (this.replayEngine && typeof this.replayEngine._applyStealthEvasion === 'function') {
          await this.replayEngine._applyStealthEvasion();
        }
        await new Promise(r => setTimeout(r, 600));
      } catch (navErr) {
        logger.warn(`[Runner] Auto-navigation note: ${navErr.message}`);
      }
    } else {
      logger.info(`[Runner] Tab already at target URL: ${resolved}`);
    }
  }

  /**
   * Find a likely pagination "next" control on the current page.
   * The resolver is intentionally conservative: it requires semantic next-page
   * signals and rejects disabled/hidden controls. A workflow may provide an
   * explicit selector through workflow.pagination.nextSelector.
   */
  async findNextPageTarget(page, workflow = {}) {
    const explicitSelector = workflow.pagination && workflow.pagination.nextSelector;
    return page.evaluateHandle((selector) => {
      const visible = el => {
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const disabled = el => el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');

      if (selector) {
        const el = document.querySelector(selector);
        return el && visible(el) && !disabled(el) ? el : null;
      }

      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [aria-label]'))
        .filter(el => visible(el) && !disabled(el));

      const scored = candidates.map(el => {
        const text = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        const title = (el.getAttribute('title') || '').trim().toLowerCase();
        const combined = [text, aria, title].join(' ');
        let score = 0;
        if (/^next(?: page)?$/.test(text)) score += 8;
        if (/next(?: page)?/.test(aria)) score += 7;
        if (/next(?: page)?/.test(title)) score += 5;
        if (/^›$|^»$|^>$/.test(text)) score += 4;
        if (/pagination|pager/.test(combined)) score += 2;
        if (/previous|back|first|last/.test(combined) && !/next/.test(combined)) score -= 5;
        return { el, score };
      }).filter(x => x.score >= 5).sort((a, b) => b.score - a.score);

      return scored.length ? scored[0].el : null;
    }, explicitSelector);
  }

  async advanceToNextPage(page, workflow = {}) {
    const beforeUrl = page.url();
    const handle = await this.findNextPageTarget(page, workflow);
    const element = handle && handle.asElement();
    if (!element) {
      if (handle) await handle.dispose().catch(() => {});
      return false;
    }

    try {
      await element.scrollIntoViewIfNeeded().catch(() => {});
      await element.click();
    } finally {
      await element.dispose().catch(() => {});
    }

    const timeout = Number.isInteger(workflow.pagination?.waitTimeoutMs)
      ? Math.max(1000, workflow.pagination.waitTimeoutMs)
      : 10000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      await new Promise(r => setTimeout(r, 250));
      if (page.url() !== beforeUrl) return true;
      const state = await page.evaluate(() => document.readyState).catch(() => 'loading');
      if (state === 'complete' || state === 'interactive') {
        // Give AJAX/virtualized grids a little time to replace their rows.
        await new Promise(r => setTimeout(r, 750));
        return true;
      }
    }
    return true;
  }

  /**
   * Execute a standard sequential workflow (all steps in order)
   * @param {object} workflow - Stored workflow object with steps array
   * @param {function} onProgress - Progress callback for live updates
   */
  async executeStandard(workflow, onProgress = () => {}) {
    this.initDirectories();
    const steps = workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || [];
    const manifest = {
      runId: this.runId,
      workflowId: workflow.id,
      mode: 'STANDARD',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      itemsTotal: steps.length,
      itemsSucceeded: 0,
      itemsFailed: 0,
      results: [],
      downloadedFiles: []
    };

    logger.info(`[Runner] Starting standard execution run ${this.runId} for workflow "${workflow.name}" (${steps.length} steps)`);
    onProgress({ status: 'STARTING', manifest });

    try {
      const browser = await this.replayEngine.connect();
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();
      this.replayEngine.page = page;

      // Set up the secret resolver using the workflow's userId
      this.replayEngine.secretResolver = async (secretId) => {
        const secret = db.findOne('secrets', s => s.id === secretId && s.userId === workflow.userId);
        if (secret && secret.encryptedData) {
          try {
            return decryptSecret(secret.encryptedData);
          } catch (e) {
            logger.warn(`Failed to decrypt secret [${secretId}]: ${e.message}`);
          }
        }
        logger.warn(`Secret [${secretId}] not found or could not be decrypted.`);
        return `{{secret:${secretId}}}`;
      };

      // Setup CDP download interception
      await this.configureDownloadInterception(page);

      // Set active recording on replayEngine for context-aware execution
      this.replayEngine.recording = workflow.recordingData || { actions: steps };

      // Auto-navigate to target URL before steps execution
      await this.navigateToWorkflowTarget(page, workflow);

      // Execute each step in order
      for (let i = 0; i < steps.length; i++) {
        if (this.isAborted) {
          logger.warn(`[Runner] Abort signal active before step #${i + 1}. Stopping execution.`);
          manifest.status = 'STOPPED';
          break;
        }

        const step = steps[i];
        const stepType = step.type || step.action || 'CLICK';

        // Natural pacing delay: wait if the user waited during recording (e.g. for grid data to load)
        if (i > 0 && step.timeDeltaMs && step.timeDeltaMs > 0) {
          const paceDelay = Math.min(step.timeDeltaMs, 15000);
          if (paceDelay > 600) {
            logger.info(`[Runner] Pacing step #${i + 1}: waiting ${paceDelay}ms for page/grid to settle...`);
            const end = Date.now() + paceDelay;
            while (Date.now() < end) {
              if (this.isAborted) break;
              await new Promise(r => setTimeout(r, 100));
            }
          }
        }

        if (this.isAborted) {
          logger.warn(`[Runner] Abort signal active after pacing for step #${i + 1}. Stopping execution.`);
          manifest.status = 'STOPPED';
          break;
        }

        logger.info(`[Runner] Executing step ${i + 1}/${steps.length} [${stepType}]...`);

        const stepResult = {
          index: i + 1,
          type: stepType,
          status: 'PENDING',
          timestamp: new Date().toISOString(),
          error: null
        };

        try {
          await this.replayEngine.executeAction(step, i);
          stepResult.status = 'SUCCESS';
          manifest.itemsSucceeded++;
        } catch (stepErr) {
          if (this.isAborted) {
            stepResult.status = 'STOPPED';
            stepResult.error = 'Execution stopped by user';
            manifest.status = 'STOPPED';
            manifest.results.push(stepResult);
            break;
          }
          logger.error(`[Runner] Failed step #${i + 1} [${stepType}]: ${stepErr.message}`);
          stepResult.status = 'FAILED';
          stepResult.error = stepErr.message;
          manifest.itemsFailed++;
          manifest.results.push(stepResult);
          throw stepErr;
        }

        manifest.results.push(stepResult);
        onProgress({ status: 'STEP_COMPLETE', stepResult, manifest });
      }

      // Gather downloaded files into manifest
      if (fs.existsSync(this.downloadsDir)) {
        manifest.downloadedFiles = fs.readdirSync(this.downloadsDir).map(file => ({
          filename: file,
          path: path.join(this.downloadsDir, file),
          sizeBytes: fs.statSync(path.join(this.downloadsDir, file)).size
        }));
      }

      manifest.status = this.isAborted ? 'STOPPED' : 'COMPLETED';
      manifest.endTime = new Date().toISOString();
      logger.success(`\n[Runner] Standard execution run ${this.runId} ${manifest.status}! Succeeded: ${manifest.itemsSucceeded}/${steps.length}`);

    } catch (err) {
      manifest.status = this.isAborted ? 'STOPPED' : 'FAILED';
      manifest.error = err.message;
      manifest.endTime = new Date().toISOString();
      if (this.isAborted) {
        logger.warn(`[Runner] Execution run ${this.runId} stopped by user.`);
      } else {
        logger.error(`[Runner] Fatal execution failure: ${err.message}`);
      }
    }

    fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    onProgress({ status: manifest.status, manifest });

    return manifest;
  }

  /**
   * Execute a parameterized loop workflow
   * @param {object} workflow - Stored workflow object with steps array
   * @param {number} loopStepIndex - Index of the action to iterate over
   * @param {function} onProgress - Progress callback for live updates
   */
  async executeLoop(workflow, loopStepIndex = 0, onProgress = () => {}) {
    this.initDirectories();
    const manifest = {
      runId: this.runId,
      workflowId: workflow.id,
      mode: 'LOOP',
      startTime: new Date().toISOString(),
      status: 'RUNNING',
      itemsTotal: 0,
      itemsSucceeded: 0,
      itemsFailed: 0,
      results: [],
      downloadedFiles: []
    };

    logger.info(`[Loop Runner] Starting execution run ${this.runId} for workflow "${workflow.name}"`);
    onProgress({ status: 'STARTING', manifest });

    try {
      const browser = await this.replayEngine.connect();
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();
      this.replayEngine.page = page;

      // Set up the secret resolver using the workflow's userId
      this.replayEngine.secretResolver = async (secretId) => {
        const secret = db.findOne('secrets', s => s.id === secretId && s.userId === workflow.userId);
        if (secret && secret.encryptedData) {
          try {
            return decryptSecret(secret.encryptedData);
          } catch (e) {
            logger.warn(`Failed to decrypt secret [${secretId}]: ${e.message}`);
          }
        }
        logger.warn(`Secret [${secretId}] not found or could not be decrypted. Falling back to placeholder.`);
        return `{{secret:${secretId}}}`;
      };

      // Setup CDP download interception
      await this.configureDownloadInterception(page);

      // Set active recording on replayEngine for context-aware execution
      this.replayEngine.recording = workflow.recordingData || { actions: workflow.steps || [] };

      // Auto-navigate to workflow target URL before executing setup / loop steps
      await this.navigateToWorkflowTarget(page, workflow);

      // Ensure the same selector resolver used by normal replay is available to
      // ItemDiscovery before it tries to resolve the recorded target.
      await this.replayEngine._ensureSelectorResolverInFrame(page.mainFrame());

      // 1. Partition steps into Setup vs Loop Steps
      const steps = workflow.steps || (workflow.recordingData && workflow.recordingData.actions) || [];
      const partition = LoopDetector.partitionWorkflow(steps, loopStepIndex);
      const targetStep = partition.loopSteps[0];
      const analysis = LoopDetector.analyzeStep(targetStep);

      logger.info(`[Loop Runner] Detected pattern: ${analysis.patternType} (Container: ${analysis.containerSelector})`);

      // 2. Execute Setup Steps Once (e.g. Login & Navigate)
      if (partition.setupSteps.length > 0) {
        logger.info(`[Loop Runner] Executing ${partition.setupSteps.length} setup step(s)...`);
        for (let i = 0; i < partition.setupSteps.length; i++) {
          await this.replayEngine.executeAction(partition.setupSteps[i], i);
        }
      }

      // Record baseline list page URL for state restoration
      const listPageUrl = page.url();

      // 3. Discover the collection from the element the user actually recorded.
      // ItemDiscovery replaces the old nth-child/container-only heuristic for the
      // first generalized execution path.
      let discovery = await ItemDiscovery.discover(page, targetStep.target || targetStep.fingerprint, {
        minItems: 2,
        minScore: 0.55
      });

      if (!discovery.success) {
        throw new Error(`Item discovery failed: ${discovery.reason || 'unknown reason'}`);
      }

      manifest.itemsTotal = discovery.itemCount;
      manifest.pagesProcessed = 1;

      // Convert the concrete recorded target (for example, the first invoice row)
      // into an item-relative target before replaying it across the collection.
      const generalizedActions = partition.loopSteps.map(action => {
        if (!ActionGeneralizer.isItemRelative(action, discovery.collection)) {
          throw new Error(`Loop action cannot be generalized to the discovered collection: ${action.type || action.action || 'UNKNOWN'}`);
        }
        return ActionGeneralizer.generalizeAction(action, discovery.collection);
      });

      logger.info(`[Loop Runner] Discovered ${discovery.itemCount} repeated item(s) with confidence ${Math.round(discovery.confidence * 100)}%`);
      logger.info(`[Loop Runner] Generalized ${generalizedActions.length} loop action(s) to item-relative scope.`);
      onProgress({ status: 'PROCESSING_ITEMS', manifest, discovery, generalizedActions });

      // 4. Process the current page, then optionally advance through pagination.
      // Pagination is opt-in through workflow.pagination.enabled to avoid clicking
      // unrelated "Next" controls on portals that do not use paging.
      const paginationEnabled = workflow.pagination?.enabled === true;
      const maxPages = Number.isInteger(workflow.pagination?.maxPages)
        ? Math.max(1, workflow.pagination.maxPages)
        : 100;
      let currentPage = 1;

      while (true) {
        for (let i = 0; i < discovery.itemCount; i++) {
        if (this.isAborted) {
          logger.warn(`[Loop Runner] Abort signal active before item #${i + 1}. Stopping loop.`);
          manifest.status = 'STOPPED';
          break;
        }

        logger.info(`\n[Loop Runner] --- Processing item [${i + 1}/${discovery.itemCount}] ---`);
        const itemResult = {
          index: manifest.itemsSucceeded + manifest.itemsFailed + 1,
          status: 'PENDING',
          timestamp: new Date().toISOString(),
          error: null
        };
        this.writeLoopCheckpoint(manifest, itemResult.index);

        try {
          itemResult.actions = [];
          itemResult.downloadedFiles = [];
          itemResult.attempts = 0;
          itemResult.retryCount = 0;

          let completed = false;
          let lastError = null;
          let nextActionOffset = 0;

          for (let attempt = 0; attempt <= this.maxItemRetries && !completed; attempt++) {
            if (this.isAborted) throw new Error('Execution stopped by user');

            itemResult.attempts = attempt + 1;
            if (attempt > 0) {
              itemResult.retryCount = attempt;
              logger.warn('[Loop Runner] Retrying item #' + (i + 1) + ' (attempt ' + (attempt + 1) + '/' + (this.maxItemRetries + 1) + ')');
              await new Promise(r => setTimeout(r, 500));

              // Reacquire the live DOM item and resume at the failed action checkpoint.
              if (page.url() !== listPageUrl) {
                try {
                  await page.goto(listPageUrl, { waitUntil: 'domcontentloaded' });
                  await new Promise(r => setTimeout(r, 1000));
                } catch (restoreErr) {
                  logger.warn('[Loop Runner] Could not restore list state before retry: ' + restoreErr.message);
                }
              }
            }

            try {
              for (let actionOffset = nextActionOffset; actionOffset < generalizedActions.length; actionOffset++) {
                if (this.isAborted) throw new Error('Execution stopped by user');

                const beforeActionFiles = this.snapshotDownloadedFiles();
                const itemHandle = await ItemDiscovery.getItemHandle(page, discovery, i);
                const itemElement = itemHandle.asElement();
                if (!itemElement) {
                  await itemHandle.dispose().catch(() => {});
                  throw new Error(`Item at index ${i} could not be resolved`);
                }

                try {
                  await this.replayEngine.executeActionWithinItem(
                    itemElement,
                    generalizedActions[actionOffset],
                    loopStepIndex + actionOffset
                  );
                } finally {
                  await itemElement.dispose().catch(() => {});
                }

                const action = generalizedActions[actionOffset];
                const actionType = action.type || action.action || 'CLICK';
                const actionResult = {
                  index: loopStepIndex + actionOffset + 1,
                  type: actionType,
                  status: 'SUCCESS'
                };

                if (actionType === 'CLICK' && this.downloadsDir) {
                  const downloaded = await this.waitForDownload(beforeActionFiles, 1200);
                  if (downloaded.length) {
                    itemResult.downloadedFiles.push(...downloaded);
                    actionResult.downloadedFiles = downloaded.map(file => file.filename);
                  }
                }

                itemResult.actions.push(actionResult);
                nextActionOffset = actionOffset + 1;
                this.writeLoopCheckpoint(manifest, itemResult.index, nextActionOffset);
                await new Promise(r => setTimeout(r, 300));
              }

              // Allow the complete per-item procedure to settle before restoring state.
              await new Promise(r => setTimeout(r, 1000));

              if (page.url() !== listPageUrl) {
                logger.info('[Loop Runner] Restoring state -> Navigating back to: ' + listPageUrl);
                await page.goto(listPageUrl, { waitUntil: 'domcontentloaded' });
                await new Promise(r => setTimeout(r, 1000));
              }

              completed = true;
            } catch (attemptErr) {
              lastError = attemptErr;
              logger.warn('[Loop Runner] Item #' + (i + 1) + ' attempt ' + (attempt + 1) + ' failed at action #' + (nextActionOffset + 1) + ': ' + attemptErr.message);

              if (attempt < this.maxItemRetries) {
                // Keep the checkpoint at the first action that did not complete.
                continue;
              }
            }
          }

          if (!completed) {
            throw lastError || new Error('Item #' + (i + 1) + ' failed after ' + itemResult.attempts + ' attempt(s)');
          }

          itemResult.status = 'SUCCESS';
          manifest.itemsSucceeded++;
          if (itemResult.downloadedFiles.length) {
            manifest.downloadedFiles.push(...itemResult.downloadedFiles);
          }
        } catch (itemErr) {
          if (this.isAborted) {
            itemResult.status = 'STOPPED';
            itemResult.error = 'Execution stopped by user';
            manifest.status = 'STOPPED';
            manifest.results.push(itemResult);
            break;
          }
          logger.error(`[Loop Runner] Error on item #${i + 1}: ${itemErr.message}`);
          itemResult.status = 'FAILED';
          itemResult.error = itemErr.message;
          manifest.itemsFailed++;

          // Attempt recovery
          try {
            if (page.url() !== listPageUrl) {
              await page.goto(listPageUrl, { waitUntil: 'domcontentloaded' });
            }
          } catch {
            // Ignore recovery error
          }
        }

        manifest.results.push(itemResult);
        this.writeLoopCheckpoint(manifest, itemResult.status === 'SUCCESS' ? null : itemResult.index, null);
        onProgress({ status: 'ITEM_COMPLETE', itemResult, manifest });
      }

        if (!paginationEnabled || currentPage >= maxPages) {
          break;
        }

        const advanced = await this.advanceToNextPage(page, workflow);
        if (!advanced) {
          logger.info('[Loop Runner] No next page control found. Pagination complete.');
          break;
        }

        const previousItemCount = discovery.itemCount;
        const nextDiscovery = await ItemDiscovery.discover(
          page,
          targetStep.target || targetStep.fingerprint,
          { minItems: 1, minScore: 0.55 }
        );

        if (!nextDiscovery.success || nextDiscovery.itemCount < 1) {
          logger.info('[Loop Runner] Next page did not expose a discoverable item collection. Pagination complete.');
          break;
        }

        discovery = nextDiscovery;
        manifest.itemsTotal += discovery.itemCount;
        manifest.pagesProcessed = currentPage + 1;
        currentPage++;
        logger.info('[Loop Runner] Advanced to page #' + currentPage + ' with ' + discovery.itemCount + ' item(s).');
        onProgress({ status: 'PAGE_COMPLETE', page: currentPage, manifest, discovery });

        if (discovery.itemCount === previousItemCount && currentPage >= maxPages) {
          break;
        }
      }

      // 5. Gather all downloaded files into manifest
      if (fs.existsSync(this.downloadsDir)) {
        manifest.downloadedFiles = fs.readdirSync(this.downloadsDir).map(file => ({
          filename: file,
          path: path.join(this.downloadsDir, file),
          sizeBytes: fs.statSync(path.join(this.downloadsDir, file)).size
        }));
      }

      manifest.status = this.isAborted ? 'STOPPED' : (manifest.itemsFailed > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED');
      manifest.endTime = new Date().toISOString();
      logger.success(`\n[Loop Runner] Run ${this.runId} ${manifest.status}! Succeeded: ${manifest.itemsSucceeded}, Failed: ${manifest.itemsFailed}`);

    } catch (err) {
      manifest.status = this.isAborted ? 'STOPPED' : 'FAILED';
      manifest.error = err.message;
      manifest.endTime = new Date().toISOString();
      if (this.isAborted) {
        logger.warn(`[Loop Runner] Loop run ${this.runId} stopped by user.`);
      } else {
        logger.error(`[Loop Runner] Fatal run failure: ${err.message}`);
      }
    }

    // Save manifest file
    fs.writeFileSync(path.join(this.runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    onProgress({ status: manifest.status, manifest });

    return manifest;
  }
}

module.exports = LoopReplayRunner;
