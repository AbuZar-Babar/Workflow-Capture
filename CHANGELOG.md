# Changelog — Workflow Capture

## [Unreleased] — 2026-09-26

### Scope
- Aligned the repository documentation with the current product direction.
- Defined Workflow Capture as a working product name; final product name remains undecided.
- Clarified the two core capabilities: workflow recording/replay and repeated-item portal automation.
- Established item discovery as a core capability.
- Documented generic filtering as active development rather than a completed feature.
- Deferred authentication as a current product priority.
- Documented structured Workflow → Run/Timestamp → Item → Artifact traceability.
- Clarified the generic-engine + portal-configuration boundary.

### UI / Automation
- Documented visible recording-state feedback and Stop Recording control.
- Continued workflow editor, execution monitoring, discovery and artifact UX work.
- Continued selector resilience, item discovery, generalized loops and download handling.

### Validation
- Latest loop E2E validation discovered four items and completed the first item/download before stalling at item two.
- Full test execution has encountered a Windows/Puppeteer temporary Chrome-profile cleanup `EBUSY` issue.
- Real-portal validation remains an active requirement.

## [2026-09-17]
- Added Drawflow workflow editor integration and canvas zoom controls.
- Added local development login helper.
- Added custom dashboard node theming.
- Fixed dashboard API/router/canvas issues.
- Preserved compatibility with legacy recording data.
