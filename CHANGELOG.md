# Changelog — Workflow Capture

## [Unreleased] — 2026-09-28

### Integrated engineering work
- Added repository-level agent rules, task workboard, and task assignment template (Task 0).
- Hardened dashboard authentication, session checks, logout, and explicit development bypass controls (Task 1).
- Improved loop-run reliability, failure isolation, checkpoint/manifest consistency, and input-guard cleanup (Task 2).
- Added isolated Chrome test profiles/ports and process cleanup for concurrent browser test runs (Task 3).
- Added a reusable compound item-filter evaluator supporting `all`/`any`, `contains`, `equals`, deterministic inclusive date ranges, and legacy filter normalization (Tasks 4 & 12).
- Extended dashboard filter review UI with multiple conditions, date ranges, positive item limits, preview counts, and distinct `SKIPPED_FILTER` / `SKIPPED_LIMIT` states (Tasks 5 & 13).
- Connected filter and item-limit contract end-to-end through discovery preview, execution API (`itemFilter`, `loopLimit`), loop runner runtime, live counters, execution manifests, and SSE streaming with strict preview/runtime agreement (Task 6).
- Completed test suite taxonomy and automation: partitioned all 21 test files into fast unit/API (`npm test` / `npm run test:fast`), browser-isolated (`npm run test:browser`), and full suite (`npm run test:all`); documented taxonomy in `docs/TESTING.md`; and configured automated GitHub Actions CI workflow in `.github/workflows/ci.yml` (Task 7).

### Current integration state
- Tasks 0–7, 12, and 13 are integrated into `multi-agent` (`739ee486094e19b80cc6b4a9a78a90821a165d8b`).
- Task 8 (Documentation & Status Reconciliation) is currently active.
- Task 9 (Cross-portal and end-to-end validation release gate) is the next engineering milestone.
- Task 10 (Dashboard lifecycle correctness) follows Task 9.
- Task 11 (Modularization of large modules) remains deferred until behavior is stable.

### Validation
- Task 6 reported passing focused runtime tests (`test/loop-filter-runtime.test.js`, `test/item-filter.test.js`, `test/loop-flow.test.js`, `test/row-filter-discrimination.test.js`, `test/api.test.js`) and verified preview/runtime agreement, manifest persistence, and SSE event streaming.
- Task 7 reported `npm run test:fast` passing (18 fast/API suites, 87 assertions), `npm run test:browser` passing (3 browser-backed suites), and `npm run test:all` passing (21 suites, 90 assertions) under isolated browser environments.
- Automated CI pipeline established in `.github/workflows/ci.yml` running fast/API test suites on Node 18 and Node 20.
- Cross-portal compatibility and full recording-to-artifact journey validation remain targeted for the Task 9 release gate.

## [2026-09-17]
- Added Drawflow workflow editor integration and canvas zoom controls.
- Added local development login helper.
- Added custom dashboard node theming.
- Fixed dashboard API/router/canvas issues.
- Preserved compatibility with legacy recording data.
