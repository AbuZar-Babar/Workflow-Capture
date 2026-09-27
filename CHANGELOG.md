# Changelog — Workflow Capture

## [Unreleased] — 2026-09-27

### Integrated engineering work
- Added repository-level agent rules, a task workboard, and a reusable task assignment template.
- Hardened dashboard authentication, session checks, logout, and explicit development bypass controls.
- Improved loop-run reliability, failure isolation, checkpoint/manifest consistency, and input-guard cleanup.
- Added isolated Chrome test profiles/ports and process cleanup for concurrent browser test runs.
- Added a pure reusable v1 item-filter evaluator and a dashboard discovery/review flow with selected/skipped previews.

### Confirmed next behavior
- Recorded the agreed single loop-start marker semantics, multiple filter conditions with `all`/`any`, inclusive date ranges, and an optional item-attempt limit in `docs/LOOP-FILTER-REQUIREMENTS.md`.
- API/runtime integration and the v2 evaluator/UI work remain open tasks; the requirements document does not imply those behaviors are already complete.

### Validation
- Task owners reported their focused suites passing on their task branches before Tasks 0–5 were integrated.
- The combined end-to-end flow has not yet been rerun after integration.
- Real-portal compatibility remains to be validated.

## [2026-09-17]
- Added Drawflow workflow editor integration and canvas zoom controls.
- Added local development login helper.
- Added custom dashboard node theming.
- Fixed dashboard API/router/canvas issues.
- Preserved compatibility with legacy recording data.
