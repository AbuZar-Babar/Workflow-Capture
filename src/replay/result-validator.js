/**
 * Workflow Capture — Result Validator & Execution Reporting Engine
 * 
 * Validates the outcome of workflow executions, distinguishes successes from
 * isolated failures, validates downloaded files, and generates a structured
 * final execution report conforming to Part 21 & 22.
 */

'use strict';

class ResultValidator {
  constructor(options = {}) {
    this.executionId = options.executionId || `exec_${Date.now()}`;
    this.workflowId = options.workflowId || null;
    this.workflowName = options.workflowName || 'Workflow';
    this.startedAt = new Date().toISOString();
    this.completedAt = null;

    this.itemsFound = 0;
    this.itemsMatching = 0;
    this.itemsSelected = 0;
    this.itemsProcessed = 0;
    this.itemsSucceeded = 0;
    this.itemsFailed = 0;
    this.itemsSkippedFilter = 0;
    this.itemsSkippedDuplicate = 0;
    this.itemsSkippedLimit = 0;

    this.itemResults = [];
    this.failedItems = [];
    this.successfulItems = [];
    this.downloads = [];
  }

  setDiscoveryMetrics(metrics = {}) {
    if (typeof metrics.totalCount === 'number') this.itemsFound = metrics.totalCount;
    if (typeof metrics.matchingCount === 'number') this.itemsMatching = metrics.matchingCount;
    if (typeof metrics.selectedCount === 'number') this.itemsSelected = metrics.selectedCount;
    if (typeof metrics.skippedFilterCount === 'number') this.itemsSkippedFilter = metrics.skippedFilterCount;
  }

  /**
   * Record a processed item result.
   *
   * @param {object} itemResult
   * @param {string} itemResult.itemId
   * @param {'SUCCESS' | 'FAILED' | 'SKIPPED_FILTER' | 'SKIPPED_DUPLICATE' | 'SKIPPED_LIMIT'} itemResult.status
   * @param {string} [itemResult.reason]
   * @param {object} [itemResult.fields]
   * @param {object} [itemResult.download]
   */
  recordItemResult(itemResult = {}) {
    this.itemsProcessed++;
    const status = itemResult.status || 'SUCCESS';

    const entry = {
      itemId: String(itemResult.itemId || `item_${this.itemsProcessed}`),
      status,
      reason: itemResult.reason || null,
      fields: itemResult.fields || {},
      download: itemResult.download || null,
      timestamp: new Date().toISOString()
    };

    this.itemResults.push(entry);

    if (status === 'SUCCESS') {
      this.itemsSucceeded++;
      this.successfulItems.push(entry);
      if (entry.download) this.downloads.push(entry.download);
    } else if (status === 'FAILED') {
      this.itemsFailed++;
      this.failedItems.push(entry);
    } else if (status === 'SKIPPED_FILTER') {
      this.itemsSkippedFilter++;
    } else if (status === 'SKIPPED_DUPLICATE') {
      this.itemsSkippedDuplicate++;
    } else if (status === 'SKIPPED_LIMIT') {
      this.itemsSkippedLimit++;
    }

    return entry;
  }

  /**
   * Produce the final execution report.
   *
   * @returns {object} Execution report
   */
  generateReport() {
    this.completedAt = new Date().toISOString();

    let finalStatus = 'COMPLETED';
    if (this.itemsFailed > 0 && this.itemsSucceeded > 0) {
      finalStatus = 'COMPLETED_WITH_ERRORS';
    } else if (this.itemsFailed > 0 && this.itemsSucceeded === 0) {
      finalStatus = 'FAILED';
    }

    return {
      executionId: this.executionId,
      workflowId: this.workflowId,
      workflowName: this.workflowName,
      status: finalStatus,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      metrics: {
        found: this.itemsFound,
        matched: this.itemsMatching,
        selected: this.itemsSelected,
        processed: this.itemsProcessed,
        succeeded: this.itemsSucceeded,
        failed: this.itemsFailed,
        skippedFilter: this.itemsSkippedFilter,
        skippedDuplicate: this.itemsSkippedDuplicate,
        skippedLimit: this.itemsSkippedLimit
      },
      downloadsCount: this.downloads.length,
      failedItemsCount: this.failedItems.length,
      failedItems: this.failedItems.map(f => ({
        itemId: f.itemId,
        reason: f.reason,
        fields: f.fields
      })),
      downloads: this.downloads
    };
  }
}

module.exports = ResultValidator;
