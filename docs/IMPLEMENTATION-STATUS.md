# Workflow Capture — Implementation Status

> Updated: 2026-09-28
>
> Current integration branch: `multi-agent` at `739ee486094e19b80cc6b4a9a78a90821a165d8b`. Tasks 0–7, 12, and 13 are integrated. Task 6 wired the filter and attempt-limit contract through API and runtime; Task 7 established complete, discoverable test suites, browser test isolation, and GitHub Actions CI automation. Task 8 is the active documentation reconciliation task; Task 9 is the next release-gate validation milestone. See [WORKSTREAMS.md](WORKSTREAMS.md) for task status and [LOOP-FILTER-REQUIREMENTS.md](LOOP-FILTER-REQUIREMENTS.md) for the frozen contract.
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

The current implementation is **not yet a complete production RPA platform**. It includes recording, discovery, item-scoped replay, loop reliability, dashboard review, security, compound/date filter evaluation, API/runtime filter integration, and test isolation/CI foundations. The combined release-gate journey across diverse real portals (Task 9) is the next milestone.

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

The testing architecture was formalized in Task 7 and is documented in [TESTING.md](TESTING.md). The repository contains 21 test files categorized into explicit suites:

- **Unit Tests (`npm run test:unit`)**:
  - `test/action-generalizer.test.js`: CSS selector scoping (`:scope`, relative paths), nth-row conversion, multi-action generalization.
  - `test/bot-config.test.js`: Bot presets, human mouse Bezier trajectories, typing cadence dynamics.
  - `test/checkbox-idempotency.test.js`: Checkbox state detection and idempotent click skipping.
  - `test/devexpress-iframe-capture.test.js`: DevExpress toolbar candidates against mock DOM nodes.
  - `test/download-deduplication.test.js`: JsonDB schema, slugified run paths, file hash deduplication.
  - `test/dropdown-loop.test.js`: Mat-option and dropdown pattern recognition, action generalization.
  - `test/item-discovery.test.js`: Candidate collection scoring, confidence heuristics, navigation toolbar exclusion.
  - `test/item-filter.test.js` (Task 12): Pure reusable filter evaluator, compound AND/OR logic, `dateBetween` inclusive boundaries, loop limits.
  - `test/loop-engine.test.js`: Table row/list item sibling detection, setup vs loop step sequence partitioning.
  - `test/secret-vault.test.js`: AES-256 secret encryption/decryption, master key derivation, database secret storage.
  - `test/selector-resolver.test.js`: ID stability heuristics, transient class stripping, element fingerprint scoring.
- **API & Integration Tests (`npm run test:api`)**:
  - `test/auth.test.js`: Authentication controller, password hashing, JWT signing, Auth middleware, token verification.
  - `test/backend-api.test.js`: REST API endpoints for user auth, workflow CRUD, runs lifecycle, stop run.
  - `test/dashboard-security.test.js` (Task 1): In-process HTTP server startup, loopback binding, token enforcement, developer bypass guards, CORS policies.
  - `test/execution-mode.test.js`: Run controller execution mode branching (STANDARD macro vs LOOP).
  - `test/filter-api-runtime.test.js` (Task 6): Filter/limit API endpoints, preview vs runtime agreement, date range filtering, limit semantics, error handling.
  - `test/row-filter-discrimination.test.js`: Row filter parameter handling in run controller, simulated ERP row item matching/skipping.
- **Browser & End-to-End Tests (`npm run test:browser`)**:
  - `test/loop-e2e.test.js`: 4-item invoice table loop replay and batch download verification via `ChromeFixture`.
  - `test/e2e-smoke.js`: Full recorder attach, live action capture, redaction, persistence, and replay on `mock-portal.html`.
  - `test/loop-reliability.test.js` (Task 2): Multi-item loop reliability, abort/resume, human disturbance guard, and 4-item invoice scenario with real Chrome.
- **Manual / Optional Verification Test**:
  - `test/iframe-click-capture-robustness.test.js` (`test:iframe-robustness`): Standalone verification test for nested iframe injection, mousedown suppression, canvas relative coordinate clicks, and DevExpress toolbar icons.

Test suites are formally partitioned in `package.json` into fast browserless suites (`npm test` / `npm run test:fast`) and browser-backed suites (`npm run test:browser`). Automated GitHub Actions CI is configured in `.github/workflows/ci.yml`, running the fast test suite across a matrix of Node.js 18.x, 20.x, and 22.x on `ubuntu-latest`, followed by the browser-backed E2E test suite on Node.js 20.x with Google Chrome on `windows-latest`. See [TESTING.md](TESTING.md) for the complete test taxonomy and execution directory.

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

The following represents the remaining roadmap:

### High priority

- End-to-end dashboard journey and real-portal validation release gate across representative portal and DOM structures (Task 9);
- Dashboard lifecycle correctness, navigation transitions, and modal state resilience under active execution (Task 10);
- Stronger item identity / duplicate prevention and checkpoint recovery across long multi-page runs;
- Multi-portal compatibility testing and documented portal variance.

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

The next major milestone is to execute Task 9: cross-portal and end-to-end validation of the complete user journey against fixtures and authorized real portals, followed by Task 10 dashboard lifecycle hardening.
