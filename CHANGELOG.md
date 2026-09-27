# Changelog — Workflow Capture

## [Unreleased] — 2026-09-28

### Integrated engineering work
- Added repository-level agent rules, a task workboard, and a reusable task assignment template.
- Hardened dashboard authentication, session checks, logout, and explicit development bypass controls.
- Improved loop-run reliability, failure isolation, checkpoint/manifest consistency, and input-guard cleanup.
- Added isolated Chrome test profiles/ports and process cleanup for concurrent browser test runs.
- Added a reusable compound item-filter evaluator supporting `all`/`any`, `contains`, `equals`, deterministic inclusive date ranges, and legacy filter normalization.
- Extended the dashboard filter review UI with multiple conditions, date ranges, positive item limits, preview counts, and distinct `SKIPPED_FILTER` / `SKIPPED_LIMIT` states.

### Current integration state
- Tasks 12 and 13 are integrated into `multi-agent` (`62b8ef0`).
- Task 6 remains the next implementation task: connect the filter/limit contract through discovery preview, execution API, loop runtime, counters, manifests, and SSE state.

### Validation
- Task 12 reported `node test/item-filter.test.js`, `node test/row-filter-discrimination.test.js`, and `git diff --check` passing.
- Task 13 reported UI validation, backend API, row-filter discrimination, and `git diff --check` passing.
- The combined end-to-end flow has not yet been rerun on the merged `multi-agent` head.
- GitHub reports no configured status checks/workflow runs for the integration commit.
- Real-portal compatibility remains to be validated.

## [2026-09-17]
- Added Drawflow workflow editor integration and canvas zoom controls.
- Added local development login helper.
- Added custom dashboard node theming.
- Fixed dashboard API/router/canvas issues.
- Preserved compatibility with legacy recording data.
