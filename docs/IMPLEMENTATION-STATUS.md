# Workflow Capture — Implementation Status

> Updated: 2026-09-27
>
> Current integration branch: `multi-agent` at `113b920`. Tasks 0–5 are integrated. Task owners reported their assigned checks passed on their task branches before merge; the combined end-to-end journey has not yet been rerun after integration. See [WORKSTREAMS.md](WORKSTREAMS.md) for status and [LOOP-FILTER-REQUIREMENTS.md](LOOP-FILTER-REQUIREMENTS.md) for confirmed requirements that are not all implemented yet.
>
> The technical descriptions below originated as an earlier engine implementation snapshot. Treat them as implementation background; current task status and validation evidence are maintained in the linked workboard.

---

## 1. Current MVP Goal

The current MVP is focused on proving the core generic automation loop:

```
Record one item
      ↓
Discover repeated items
      ↓
Generalize the recorded actions
      ↓
Execute the same action sequence per item
      ↓
Track downloads
      ↓
Retry failed items
      ↓
Paginate when enabled
      ↓
Persist checkpoint state
      ↓
Resume after interruption
```

The current implementation is **not yet a complete production RPA platform**. It includes the recording, discovery, item-scoped replay, loop reliability, dashboard review, security, and reusable filter foundations described below, with API/runtime filter integration and the full product journey still in progress.

---

## 2. Implemented Components

### 2.1 Item Discovery

Implemented in:

`src/shared/item-discovery.js`

The discovery engine can:

- inspect the recorded target;
- resolve the recorded element through the shared selector resolver;
- identify repeated visible elements;
- detect table rows, list items, cards, and similar structures;
- compare structural signatures;
- use stable classes and text similarity;
- score candidate collections;
- return the discovered collection and item count;
- preserve the recorded item index;
- re-query the live DOM when an item handle is requested.

Main API:

```js
ItemDiscovery.discover(page, target, options)
ItemDiscovery.getItemHandle(page, discovery, index)
```

The important design decision is that the engine does **not cache a static array of DOM nodes**. Items are re-resolved from the current DOM before actions execute.

### Current limitation

The discovery logic is heuristic and intentionally MVP-level. It is not yet guaranteed to handle every portal layout, nested virtualized grid, shadow DOM, or unusual repeated structure.

---

## 3. Action Generalization

Implemented in:

`src/shared/action-generalizer.js`

The system converts a concrete recorded action, such as an action targeting the first invoice row, into an item-relative action.

Example concept:

```
Recorded:
table tbody tr:nth-child(1) a.download

Generalized:
relative target inside the discovered item
```

Implemented capabilities:

- single-action generalization;
- multi-action generalization;
- item-relative target metadata;
- relative CSS conversion;
- `:scope` handling for targets representing the item itself;
- preservation of unsupported targets so validation can reject them cleanly.

The loop runner validates that each action can be generalized before execution.

---

## 4. Multi-Action Item Workflows

The loop engine now treats the recorded sequence after the loop boundary as the per-item workflow.

Example:

```
For each invoice:
    Mark invoice
    Download invoice
```

Instead of executing only one recorded action, the complete generalized action sequence is executed for every discovered item.

This was verified through the invoice fixture workflow design with:

1. Mark action
2. Download action

---

## 5. Item-Scoped Replay

Implemented in:

`src/replay/replay-engine.js`

Added item-scoped action execution so an action can be resolved relative to the currently discovered item rather than against the entire page.

The executor:

- receives a live item element;
- searches for generalized selectors inside that item;
- falls back to item/fingerprint information where available;
- dispatches the normal replay action;
- returns scoped execution information.

This is the core mechanism that turns one recorded invoice action into a reusable action for every invoice.

---

## 6. Loop Detection and Partitioning

Implemented in:

`src/shared/loop-detector.js`

The detector can recognize repeated structures such as:

- table rows;
- list items;
- repeated cards.

The current MVP partitioning rule is intentionally simple:

```
setup steps
    ↓
first repeating action
    ↓
all remaining actions = per-item workflow
```

This works for the current demonstration workflow.

### Current agreed behavior and remaining work

The approved initial behavior is one loop-start marker: preceding steps run once, and the marker through the workflow end repeats for each selected item. There is no separate loop-end marker or post-loop action region in this version. The product contract is recorded in [LOOP-FILTER-REQUIREMENTS.md](LOOP-FILTER-REQUIREMENTS.md); editor persistence and complete end-to-end validation remain part of follow-up work.

---

## 7. Download Tracking

Implemented in:

`src/replay/loop-replay-runner.js`

The runner configures Chrome's CDP download behavior and stores files under:

```
recordings/runs/<runId>/downloads/
```

For each item, the runner:

1. snapshots existing downloads;
2. performs the action;
3. waits for a newly completed download;
4. associates the detected file with the current item;
5. records filename, path, and size.

The final run manifest also contains the downloaded files.

---

## 8. Item-Level Retry and Checkpoints

The runner now supports configurable item retries.

Constructor option:

```js
new LoopReplayRunner({
  maxItemRetries: 1
})
```

A failed item does not automatically terminate the entire batch.

The runner stores an action offset so a retry can continue from the action that failed rather than blindly repeating all previous actions.

Example:

```
Item 7
  Action 1 ✓
  Action 2 ✓
  Action 3 ✗

Retry
  Action 3
  Action 4
  ...
```

This is an MVP checkpoint mechanism at the action level.

---

## 9. Pagination

Pagination is implemented as an **opt-in** feature.

Workflow configuration:

```json
{
  "pagination": {
    "enabled": true,
    "maxPages": 100
  }
}
```

An explicit selector can also be supplied:

```json
{
  "pagination": {
    "enabled": true,
    "nextSelector": ".next-page"
  }
}
```

The generic detector looks for visible controls using signals such as:

- `Next`;
- `Next Page`;
- `aria-label`;
- `title`;
- `›`;
- `»`;
- `>`.

The runner then:

1. processes the current page;
2. detects the next control;
3. clicks it;
4. waits for the page/list to settle;
5. rediscovers the collection;
6. checks that the collection changed;
7. processes the new items;
8. repeats until pagination ends or `maxPages` is reached.

### Why pagination is opt-in

Automatically clicking a generic "Next" control on an arbitrary website is potentially unsafe. The current implementation therefore requires:

```
pagination.enabled === true
```

before automatic pagination begins.

---

## 10. Pagination Re-Discovery

The engine does not assume that DOM nodes from page 1 remain valid after pagination.

After advancing to a new page it runs item discovery again.

This supports the project's broader rule:

> Re-query the live DOM instead of relying on stale element references.

The current implementation also prevents immediate page reprocessing by comparing a collection fingerprint before and after the pagination action.

---

## 11. Checkpoint-Based Resume

Implemented in:

`src/replay/loop-replay-runner.js`

The runner can now resume a loop from a previously written checkpoint when constructed with:

```js
new LoopReplayRunner({
  resumeFromCheckpoint: true,
  runId: "existing-run-id"
})
```

Checkpoint data is stored at:

```
recordings/runs/<runId>/checkpoint.json
```

The checkpoint contains:

- run ID;
- workflow ID;
- execution mode;
- current page;
- current page item index;
- current global item index;
- current action offset;
- completed item indexes;
- success/failure counters;
- total item count;
- pages processed;
- completed results;
- downloaded-file state;
- active in-progress item.

This allows recovery at a much finer level than simply restarting the whole run.

### Resume scenarios supported by the current design

#### Process stopped before an item

Previously completed items can be skipped.

#### Process stopped during an item

The active item and action offset are restored.

Example:

```
Page 3
Item 7
  Action 1 ✓
  Action 2 ✓
  Action 3 ← checkpoint
```

Resume starts from the recorded action offset instead of replaying actions 1 and 2.

#### Process stopped on a later page

The runner advances from the starting list page until it reaches the checkpoint page, rediscovering the collection along the way.

---

## 12. Per-Page State Restoration

A previous implementation used one list-page URL for recovery.

That is insufficient once pagination exists because retrying an item on page 3 could accidentally navigate back to page 1.

The runner now tracks:

```
currentPageUrl
```

and updates it after pagination.

Retries and post-item restoration therefore return to the current page rather than always returning to the original list page.

---

## 13. Run State

The loop runner currently tracks:

```
itemsTotal
itemsSucceeded
itemsFailed
pagesProcessed
results[]
downloadedFiles[]
```

Each item can contain:

```
index
status
timestamp
error
actions[]
downloadedFiles[]
attempts
retryCount
```

The run writes:

```
recordings/runs/<runId>/manifest.json
recordings/runs/<runId>/checkpoint.json
recordings/runs/<runId>/downloads/*
```

---

## 14. Current End-to-End Fixture

The repository contains an invoice-style test portal:

`test/invoices-portal.html`

The fixture currently represents four invoices:

```
INV-2026-001  Acme Corp
INV-2026-002  Globex Inc
INV-2026-003  Soylent Corp
INV-2026-004  Initech Systems
```

Each invoice row contains:

- a Mark action;
- a Download action.

The loop E2E workflow records the first invoice's two actions and applies the generalized workflow to the discovered invoice collection.

The E2E assertions cover:

- four discovered items;
- four successful items;
- zero failed items;
- two actions per item;
- four downloaded files;
- downloaded file existence and non-zero size.

---

## 15. Test Coverage Added

Relevant tests currently present include:

- item discovery unit tests;
- action generalization tests;
- multi-action generalization tests;
- loop partition tests;
- multi-action loop execution coverage;
- download tracking E2E coverage;
- pagination-related implementation coverage.

The package test scripts have also been updated to include the new unit suites.

Task owners reported passing their focused suites on their task branches before integration. The combined test suite and end-to-end recording → discovery → filtering → execution flow have not yet been rerun on the integrated `multi-agent` branch. Use [WORKSTREAMS.md](WORKSTREAMS.md) for the task-level evidence and remaining validation work.

---

## 16. Earlier Item-Discovery Git Milestone (Historical)

The recent feature branch work includes:

```
feature/item-discovery

Item discovery
Action generalization
Item-scoped replay
Multi-action loop execution
Download tracking
Per-action retry checkpoints
Pagination
Pagination fingerprint protection
Checkpoint-based resume
```

Recent checkpoint/resume commits:

```
21cd0416  Add checkpoint-based loop resume
291864d0  Harden loop checkpoint resume state
cca56295  Resume after completed loop items
```

---

## 17. What Is Still Missing From the MVP

The following should still be considered unfinished:

### High priority

- API/runtime integration of preview and execution with the shared filter evaluator;
- multiple filter conditions with `all`/`any` and inclusive date ranges;
- all-matching-items versus a positive attempt limit, including distinct filter/limit skip states;
- integrated verification that preview and runtime select the same items and that failures still consume a limit slot;
- end-to-end dashboard journey and real-portal validation;
- stronger item identity / duplicate prevention and robust checkpoint recovery coverage.

### Medium priority

- Load More support;
- infinite-scroll support;
- numbered pagination;
- stronger collection fingerprints;
- configurable discovery thresholds;
- richer item status model;
- persisted run recovery after process restart;
- retry policies beyond simple action-offset retry.

### Later

- multi-portal validation;
- portal adapters;
- cloud/24×7 execution;
- job queue and scheduling;
- monitoring/alerting;
- AI-assisted selector recovery;
- Document AI pipeline.

---

## 18. Current Architectural Position

The project has now moved beyond a basic record-and-replay macro.

The implemented architecture is:

```
Recorded Workflow
      ↓
Selector / Fingerprint Resolution
      ↓
Item Discovery
      ↓
Action Generalization
      ↓
Item-Scoped Replay
      ↓
Per-Item Retry
      ↓
Download Tracking
      ↓
Pagination
      ↓
Checkpoint / Resume
      ↓
Run Manifest
```

The core principle remains:

> **Record the procedure, not the individual records.**

The next major milestone is to complete the agreed loop/filter behavior through the dashboard, API, runtime, and persisted run state, then validate the complete workflow against fixtures and authorized real portals.
