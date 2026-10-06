# SOLID & DRY Modular Refactoring Implementation Plan

> **Status:** Plan Approved — Ready for Execution  
> **Branch:** `refactor/modular-core`  
> **Working Directory:** `C:\Users\AbuZar\Desktop\Fyp\Workflow-Capture-agent-worktrees\multi-agent-integration`  
> **Safety Invariant:** Zero breaking changes. Public facade of `LoopReplayRunner` and HTTP endpoints are strictly preserved. All 18 test files in `npm run test:fast` must pass with 100% fidelity after every task.

---

## Task Checklist & Execution Board

### Phase 1: Dashboard & Route Decomposition
- [x] **Task 1.1: Extract SSE Event Manager**
  - Create `src/dashboard/sse/sse-event-manager.js` to manage SSE client responses, heartbeats, and live execution broadcasts.
  - Verify: `npm run test:fast`
  - Commit: `chore(dashboard): extract SSEEventManager module`

- [x] **Task 1.2: Extract Static Asset Routes**
  - Create `src/dashboard/routes/static-routes.js` to handle HTML, CSS, JS, vendor files, and canonical video streaming.
  - Verify: `npm run test:fast`
  - Commit: `chore(dashboard): extract static asset routes`

- [x] **Task 1.3: Extract Recorder API Routes**
  - Create `src/dashboard/routes/recorder-routes.js` for `/api/recorder/*` endpoints.
  - Verify: `npm run test:fast`
  - Commit: `chore(dashboard): extract recorder routes`

- [x] **Task 1.4: Modular Router & Slim Server Bootstrap**
  - Create `src/dashboard/routes/router.js` to dispatch by endpoint prefix.
  - Refactor `src/dashboard/server.js` into a lean HTTP bootstrap (<150 lines).
  - Verify: `npm run test:fast` & `npm run dashboard` health check.
  - Commit: `refactor(dashboard): modularize server routing and bootstrap`

---

### Phase 2: Core Loop Runner Deconstruction (The 3,100-line Monolith)
- [ ] **Task 2.1: Extract LoopStateCoordinator**
  - Create `src/replay/loop/loop-state-coordinator.js` (tracks indices, batch stats, loop limits, checkpoint persistence).
  - Verify: `npm run test:fast`
  - Commit: `refactor(replay): extract LoopStateCoordinator`

- [ ] **Task 2.2: Extract ArtifactDownloadManager**
  - Create `src/replay/loop/artifact-download-manager.js` (download interception, SHA-256 deduplication, structured paths, manifest sync).
  - Verify: `npm run test:fast`
  - Commit: `refactor(replay): extract ArtifactDownloadManager`

- [ ] **Task 2.3: Extract GridSelectionAdapter**
  - Create `src/replay/loop/grid-selection-adapter.js` (Strategy pattern for ExtJS, DevExpress, HTML tables, ARIA grids).
  - Verify: `npm run test:fast`
  - Commit: `refactor(replay): extract GridSelectionAdapter`

- [ ] **Task 2.4: Extract ItemExecutionHandler**
  - Create `src/replay/loop/item-execution-handler.js` (individual item attempt execution, retry backoff, error classification).
  - Verify: `npm run test:fast`
  - Commit: `refactor(replay): extract ItemExecutionHandler`

- [ ] **Task 2.5: Transform LoopReplayRunner into Slim Facade**
  - Refactor `src/replay/loop-replay-runner.js` into a clean ~250-line Facade coordinating the extracted modules.
  - Preserve all method signatures (`start()`, `executeLoop()`, `stop()`, `extractDiscoveredItems()`) and prototype hooks.
  - Verify: `npm run test:fast`
  - Commit: `refactor(replay): simplify LoopReplayRunner into modular facade`

---

### Phase 3: DRY Action Pipeline
- [ ] **Task 3.1: Create Unified ActionDispatcher**
  - Create `src/replay/action-dispatcher.js` to eliminate duplicated CDP dispatchers and element waits between `replay-engine.js` and `loop-replay-runner.js`.
  - Refactor `src/replay/replay-engine.js` to consume `ActionDispatcher`.
  - Verify: `npm run test:fast`
  - Commit: `refactor(replay): unify action execution in ActionDispatcher`

---

### Phase 4: Final Verification & Merge
- [ ] **Task 4.1: End-to-End Suite Verification**
  - Execute full `npm run test:fast`.
  - Verify all 18 test files pass with 0 errors.
- [ ] **Task 4.2: Merge to Main**
  - Switch to `main` and merge `refactor/modular-core`.
  - Verify clean git status.
