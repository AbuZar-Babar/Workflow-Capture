# Workflow Capture — Multi-Agent Work Plan

**Status:** Ready for task assignment  
**Planning branch:** `multi-agent`  
**Baseline reviewed:** `9851a0c` (2026-09-26)  
**Plan owner:** Integrator / project owner

This plan turns the current branch review into bounded work packages. Each package has one owner, a declared file scope, dependencies, acceptance criteria, and a handoff format. Tasks may be assigned to ChatGPT, Gemini, Codex, or another coding agent.

The review was static. The loop E2E stall and several UI/runtime findings still need reproduction in a running app. No source behavior is considered validated by this plan alone.

## Working rules

1. Keep `multi-agent` as the integration target. Give every coding agent a separate worktree or branch created from the same starting commit.
2. Assign one owner per task. The owner edits only its listed paths. If more paths are required, the owner tells the integrator before editing them.
3. Do not have two agents edit the same file at once. In particular, reserve `server.js`, `loop-replay-runner.js`, `executionView.js`, `package.json`, and status documents for the task that owns them.
4. Each agent returns commits on its task branch, validation evidence, changed paths, and any unresolved risks. The integrator reviews and merges tasks into `multi-agent` in dependency order.
5. A task is done only when all of its acceptance criteria are met and its validation result is recorded. “Code written” is not a done state.
6. Keep behavior changes separate from broad refactors. Stabilize the current product flow before splitting large modules.

### Required task record

For each task, record:

- ID, title, owner, status, and task branch/worktree;
- goal and user-visible outcome;
- allowed files and excluded files;
- dependency task IDs;
- ordered subtasks;
- acceptance criteria;
- validation commands/scenarios and results;
- commit SHA(s), known limitations, and follow-up tasks.

Suggested statuses: `READY`, `IN PROGRESS`, `BLOCKED`, `REVIEW`, `INTEGRATION`, `DONE`.

## Shared filter contract

Freeze this contract before Tasks 5–7 begin so the dashboard and runtime can be developed independently:

```json
{
  "itemFilter": {
    "field": "Type",
    "operator": "contains",
    "value": "Invoice"
  }
}
```

- Version 1 supports one condition with `contains` or `equals`; comparisons trim whitespace and ignore letter case.
- Omitting `itemFilter` means process all discovered items.
- Legacy `rowFilter: { "column": "Type", "value": "Invoice" }` and the existing `filterColumn` / `filterValue` pair remain accepted and are normalized to the new shape.
- A configured field that cannot be read is a validation error. Never fall back to matching the entire row or accept an item when evaluation fails.
- The discovery preview request accepts `loopStepIndex` and optional `itemFilter`. Its response includes `availableFields` and `filterPreview` with `totalCount`, `selectedCount`, `skippedCount`, `selectedPreview`, `skippedPreview`, and `errors`.
- The execution request accepts the same `itemFilter`. Preview and execution use the same extraction and evaluation rules.
- A filtered item is represented as `SKIPPED_FILTER` with a human-readable reason. A preview error or zero selected items prevents the user from starting the filtered run.

## Task 0 — Establish the agent workboard

**Goal:** give every agent a shared place to claim a task and see file ownership.  
**Owner:** project coordinator / documentation agent.  
**Dependencies:** none.  
**Allowed paths:** new `AGENTS.md`, new `docs/WORKSTREAMS.md`, new `docs/task-template.md`.

### Subtasks

1. Add concise repository instructions for branch/worktree use, file ownership, validation evidence, and handoff.
2. Add a workboard with all task IDs in this plan, their dependencies, and initial `READY` or `BLOCKED` status.
3. Add a copyable task template containing the required task record fields above.
4. State that only the integrator changes task status to `INTEGRATION` or `DONE` after reviewing evidence.

### Acceptance criteria

- Every task in this plan appears once on the workboard.
- The workboard names one integration owner and records the integration branch.
- No implementation files are changed by this task.

## Task 1 — Secure dashboard local mode

**Priority:** P0.  
**Goal:** ensure the dashboard and browser automation endpoints are not exposed through implicit developer access or permissive cross-origin access.  
**Owner:** one backend/security agent.  
**Dependencies:** none; complete before Task 6 because both touch the dashboard server.  
**Allowed paths:** `src/dashboard/server.js`, `src/auth/auth-middleware.js`, `src/auth/auth-controller.js`, `test/auth.test.js`, and a new `test/dashboard-security.test.js`.

### Subtasks

1. Define and document local-development and network-access modes. Local mode should bind explicitly to loopback by default.
2. Gate the automatic developer identity behind an explicit development opt-in. Normal startup must require a valid token.
3. Gate the hard-coded developer/testing bypass tokens in auth middleware behind the same explicit development-only policy.
4. Restrict CORS to same-origin by default. If cross-origin development is needed, use an explicit allowlist and reject unlisted origins.
5. Add tests for tokenless requests, valid tokens, development opt-in, remote-origin requests, and allowed local origins.
6. Document the local login/development command and the effect of each security setting.

### Acceptance criteria

- Default startup does not grant a developer identity to tokenless API requests.
- Default local startup binds only to loopback.
- Wildcard CORS is absent from authenticated API and event-stream responses.
- Development bypass is explicit, documented, and cannot silently become the network-access mode.
- Existing login and authenticated dashboard flows remain usable.

## Task 2 — Stabilize repeated-item execution

**Priority:** P0.  
**Goal:** diagnose and fix the documented stall while processing the second loop item.  
**Owner:** one replay-engine agent.  
**Dependencies:** none; complete before Task 6 because both touch the loop runner.  
**Allowed paths:** `src/replay/loop-replay-runner.js`, `src/replay/replay-engine.js`, `test/loop-engine.test.js`, and a new focused `test/loop-reliability.test.js`.

### Subtasks

1. Reproduce the stall using the invoice fixture and record the last completed action, item index, item state, and checkpoint state.
2. Trace navigation, item re-resolution, download waiting, retry, abort, and checkpoint transitions around the item boundary.
3. Fix the responsible transition without changing the established workflow and manifest contracts unless the change is documented.
4. Add regression cases for sequential items, an item-level failure followed by the next item, and an interrupted/resumed item where practical.
5. Ensure every terminal path releases page/handle/listener resources and writes a consistent final manifest.

### Acceptance criteria

- The four-item invoice scenario completes without stalling.
- Each item executes both recorded actions and has the correct terminal status.
- A failure on one item does not leave the next item stuck or inherit stale handles/state.
- Checkpoint and manifest counters agree with item results.
- The agent records the exact validation command and output summary.

## Task 3 — Isolate browser-backed tests

**Priority:** P0.  
**Goal:** make E2E tests safe to run concurrently and clean up Chrome profiles reliably on Windows.  
**Owner:** one test-infrastructure agent.  
**Dependencies:** none; can run alongside Task 2 because it owns different test files.  
**Allowed paths:** `test/loop-e2e.test.js`, `test/e2e-smoke.js`, `test/invoices-portal.html`, and a new `test/helpers/chrome-fixture.js`.

### Subtasks

1. Use a unique temporary profile and debugging port for each browser test process.
2. Detect Chrome through configuration or a documented lookup instead of relying only on one hard-coded Windows path.
3. On success, assertion failure, startup failure, and timeout, terminate Chrome and await process exit before removing the profile.
4. Add startup and shutdown timeouts with diagnostics that identify the remaining process/profile when cleanup fails.
5. Keep test outputs and download artifacts unique per run.

### Acceptance criteria

- Two browser-backed suites can start at the same time without port or profile collisions.
- Chrome startup failures produce an actionable message and a nonzero exit.
- Chrome has exited before temporary profile cleanup begins.
- Repeated test runs do not leave stale Chrome processes or profile locks.

## Task 4 — Implement a reusable filter evaluator

**Priority:** P0.  
**Goal:** define deterministic filter semantics independent of portal-specific labels.  
**Owner:** one shared-engine agent.  
**Dependencies:** none; freeze the shared contract above before work starts.  
**Allowed paths:** new `src/shared/item-filter.js` and new `test/item-filter.test.js` only.

### Subtasks

1. Implement normalization for the new `itemFilter` shape and legacy `rowFilter` shape.
2. Implement pure evaluation over a normalized map of field names to values.
3. Return structured results containing `matches`, resolved field/value, and a readable reason.
4. Reject invalid operators, empty field names, unsupported filter shapes, and unavailable configured fields.
5. Add unit cases for `contains`, `equals`, case/whitespace handling, missing fields, and no-filter behavior.

### Acceptance criteria

- The evaluator has no browser, database, or dashboard dependencies.
- Malformed or unevaluable filters return a validation error, never a match.
- Unit tests cover positive, negative, missing-field, and legacy-normalization paths.
- No existing runtime/API/UI files are edited by this task.

## Task 5 — Unify discovery, review, filtering, and execution UI

**Priority:** P1.  
**Goal:** make every dashboard entry point use the same preflight and make the actual target set clear before execution.  
**Owner:** one dashboard-flow agent.  
**Dependencies:** shared filter contract frozen; coordinate against Task 6 response contract. Can work in parallel with Task 6 after those contracts are agreed.  
**Allowed paths:** `src/dashboard/public/js/views/overviewView.js`, `src/dashboard/public/js/components/executionModal.js`, `src/dashboard/public/js/views/executionView.js`, and related styles in `src/dashboard/public/css/views.css`.

### Subtasks

1. Route overview and workflow-editor loop launches through one discovery/review flow.
2. Replace fixed `Type` / Invoice / Credit Memo choices with fields and operators from the preview contract.
3. Show discovered count, selected count, skipped count, confidence, and representative selected/skipped items.
4. Block filtered execution on preview errors or zero matching items; make “no filter / all items” explicit.
5. Pass the agreed `itemFilter` object unchanged to the API client.
6. Render `SKIPPED_FILTER` items and their reasons in the execution monitor and counters.

### Acceptance criteria

- Overview and editor entry points present the same filter and review behavior.
- The visible selected count matches the request sent to execution.
- A field-mapping error is visible before execution and cannot silently start an unfiltered batch.
- Filtered-out items show a skipped state, not a pending or completed state.
- Controls remain keyboard-operable and labels describe the action and target clearly.

## Task 6 — Integrate generic filters in API and runtime

**Priority:** P1.  
**Goal:** connect preview, execution, persisted run state, and the shared evaluator.  
**Owner:** one backend integration agent.  
**Dependencies:** Tasks 1, 2, and 4; Task 5 may proceed in parallel against the frozen contract.  
**Allowed paths:** `src/api/run-controller.js`, `src/dashboard/server.js`, `src/dashboard/public/js/api.js`, `src/replay/loop-replay-runner.js`, `test/backend-api.test.js`, `test/row-filter-discrimination.test.js`, and new focused filter API tests.

### Subtasks

1. Accept and validate `itemFilter` in discovery-preview and execution endpoints.
2. Extract item fields from supported table/grid headers and cells; expose only fields that were actually found.
3. Return the defined `filterPreview` counts, samples, and validation errors.
4. Apply the same normalized evaluator at execution time; remove full-row fallback for configured fields.
5. Record filtered items as `SKIPPED_FILTER` with a reason and update run counters consistently.
6. Preserve legacy `rowFilter`, `filterColumn`, and `filterValue` inputs through normalization.
7. Add API/runtime tests for matching, nonmatching, missing fields, malformed input, legacy clients, and preview/execution agreement.

### Acceptance criteria

- Preview and execution select the same items for the same workflow and filter.
- A requested but unavailable field returns a clear error and runs no filtered actions.
- No-filter behavior still processes all eligible discovered items.
- Old filter payloads continue to work with documented semantics.
- Run records, manifests, SSE progress, and final counters agree on selected, skipped, succeeded, and failed items.

## Task 7 — Make test suites complete and discoverable

**Priority:** P1.  
**Goal:** make it obvious which suites run locally and in CI, and ensure the intended tests are not omitted.  
**Owner:** one test-governance agent.  
**Dependencies:** Tasks 3, 4, and 6.  
**Allowed paths:** `package.json`, new `docs/TESTING.md`, and new/updated `.github/workflows/*` only.

### Subtasks

1. Define separate commands for unit, API/integration, and browser-backed E2E tests.
2. Include `secret-vault.test.js` and each new regression suite in the appropriate command.
3. Keep browser-dependent tests out of the default fast command unless their environment is guaranteed.
4. Add CI jobs for the supported fast suite and an explicitly provisioned browser suite where practical.
5. Document prerequisites, environment variables, output artifacts, and the canonical full validation command.

### Acceptance criteria

- Every `*.test.js` file is assigned to a documented suite or explicitly marked manual/optional.
- A fresh developer can tell what `npm test` does without reading its chained shell command.
- CI and local commands use the same suite definitions.
- No dependency is added without a stated reason.

## Task 8 — Reconcile project status and technical docs

**Priority:** P1.  
**Goal:** remove branch/status contradictions and establish one canonical roadmap.  
**Owner:** one documentation agent.  
**Dependencies:** Tasks 1–7 should be integrated before final status claims are updated.  
**Allowed paths:** `README.md`, root `TODO.md`, `CHANGELOG.md`, `docs/TODO.md`, `docs/IMPLEMENTATION-STATUS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.

### Subtasks

1. Make one task/status document canonical and turn duplicate roadmaps into short links or clearly historical documents.
2. Replace stale `feature/item-discovery` branch language with current branch/feature status.
3. Distinguish implemented, source-reviewed, test-verified, browser-verified, and real-portal-verified capabilities.
4. Record validated limitations and deferred work; do not mark a task complete without the owner’s evidence.
5. Update the changelog with the integrated user-visible changes only.

### Acceptance criteria

- No active document points agents at a stale branch as the current work branch.
- Each priority and completion claim has one source of truth.
- Documentation matches merged behavior and validation evidence.

## Task 9 — Cross-portal and end-to-end validation

**Priority:** P1 release gate.  
**Goal:** validate the actual user journey and document compatibility limits.  
**Owner:** one validation lead; use separate portal testers only when they have separate environments.  
**Dependencies:** Tasks 1–8.  
**Allowed paths:** new dedicated fixtures under `test/fixtures/`, a validation matrix under `docs/validation/`, and test-owned artifacts. Do not edit engine code from this task; file defects as follow-up tasks.

### Subtasks

1. Run record → stop/save → discovery → review/filter → execute → monitor → results → artifacts against the standard fixture.
2. Validate filtering on at least two repeated-item structures, such as table/grid and list/card fixtures.
3. Validate the same flow on an authorized real portal when an accessible test session is provided.
4. Check item identity, duplicate prevention, downloads, retry behavior, and checkpoint recovery.
5. Record browser/OS, workflow shape, filter target, expected/actual counts, artifacts, and known limitations.

### Acceptance criteria

- Fixture results are repeatable and trace to a specific workflow/run.
- Each validation case has expected and observed counts plus pass/fail evidence.
- Any real-portal coverage is clearly distinguished from fixture coverage.
- Defects become new owned tasks; this task does not expand its own code scope.

## Task 10 — Dashboard lifecycle correctness

**Priority:** P2.  
**Goal:** remove stale asynchronous updates and ensure dashboard status reflects actual state.  
**Owner:** one frontend reliability agent.  
**Dependencies:** Task 5; avoid editing its files until it is merged.  
**Allowed paths:** `src/dashboard/public/js/views/workflowEditorView.js`, `src/dashboard/public/js/components/header.js`, and `src/dashboard/public/index.html`.

### Subtasks

1. Prevent an old `getWorkflowById` response from updating a newer editor navigation; use cancellation or a render-generation check.
2. Ensure saves/actions always use the workflow whose view is currently mounted.
3. Replace hard-coded engine status copy with state-driven status or remove claims that are not supported by live state.
4. Verify route teardown removes listeners and late async responses cannot mutate a destroyed view.

### Acceptance criteria

- Rapidly opening workflow A then B cannot render A’s data in B’s editor or save to the wrong workflow.
- Status text is derived from real dashboard state or is clearly static product copy.
- Repeated navigation does not accumulate listeners or stale view updates.

## Task 11 — Modularize large modules (deferred)

**Priority:** P2 after the release gate.  
**Goal:** reduce change collisions and make future agent tasks smaller.  
**Owner:** assign one module area per agent; do not run overlapping refactors.  
**Dependencies:** Tasks 1–10 and a stable behavior baseline.  
**Candidate work items:**

- Extract focused checkpoint, pagination, download, and item-execution modules from `loop-replay-runner.js` while preserving its external interface.
- Split `server.js` route groups from static serving/authentication/SSE setup with one clear owner for each route family.
- Split workflow-editor rendering and event handling into modules while preserving current workflow JSON compatibility.
- Audit repeated landing-demo media after confirming every referenced path; remove copies only when usage is proven absent.

### Acceptance criteria

- Refactor commits preserve public APIs and existing workflow/run formats.
- Each extraction has behavior-level regression coverage before the old implementation is removed.
- File ownership remains exclusive during the refactor wave.

## Parallel schedule

| Wave | Tasks | Notes |
|---|---|---|
| 0 — Set up | Task 0 | Establish owners and task branches/worktrees first. |
| 1 — Independent foundations | Tasks 1, 2, 3, 4 | Disjoint files. Security and loop reliability are highest priority. |
| 2 — Product flow | Tasks 5 and 6 | May run concurrently once the filter and API contracts above are frozen. Task 6 waits for Tasks 1, 2, and 4 to merge. |
| 3 — Integration discipline | Tasks 7 and 8 | Start after feature/test owners have listed final suites and outcomes. These tasks own different files. |
| 4 — Release validation | Task 9 | Run after all behavior changes are integrated. File defects as new tasks. |
| 5 — Follow-up | Tasks 10 and 11 | Lower priority; keep them out of the reliability/filter release wave. |

## Agent handoff prompt

Copy this for each assignment and fill the bracketed fields:

> Complete **Task [ID: title]** from `docs/MULTI-AGENT-WORK-PLAN.md`. Work in your assigned branch/worktree **[branch/path]**. Own only these paths: **[list]**. Do not edit another task’s paths; tell the integrator if a dependency requires it. Follow the task’s subtasks and acceptance criteria. Run only the listed validation that your environment supports, report exact commands and outcomes, and distinguish unrun checks from passing checks. Return commit SHA(s), changed files, evidence, and unresolved risks. Do not merge into `multi-agent`; the integrator handles integration.

## Integration checklist

For every task, the integrator:

1. Confirms its dependency tasks are merged and the branch started from the agreed baseline.
2. Reviews the diff against the task’s owned-file list and rejects unrelated edits into a separate task.
3. Checks compatibility across the shared filter/API contract and old workflow/run data.
4. Runs the task’s acceptance checks after merge and records evidence on the workboard.
5. Resolves conflicts in shared files before assigning the next task that owns those files.
6. Updates the canonical status document only after validation is complete.
