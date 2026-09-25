# Workflow Capture — Current TODO

## P0 — Core Reliability

- [ ] Investigate and fix the loop E2E stall when processing item 2.
- [ ] Make repeated-item execution reliable across all discovered items.
- [ ] Resolve the Windows/Puppeteer Chrome temporary-profile `EBUSY` cleanup issue.
- [ ] Run the complete recording → discovery → filtering → execution → download journey end-to-end.

## P1 — Filtering

- [ ] Replace the current portal-specific/hardcoded filter value with a generic filter configuration model.
- [ ] Define the filter condition schema.
- [ ] Support filtering based on discovered item/row attributes and content.
- [ ] Clearly expose selected vs skipped items in the discovery/review UI.
- [ ] Validate filtering against more than one portal structure.

## P1 — Real-Portal Validation

- [ ] Validate recording and replay on a real portal.
- [ ] Validate item discovery on representative tables/lists/cards.
- [ ] Validate generalized item actions.
- [ ] Validate structured downloads and artifact traceability.
- [ ] Document portal compatibility limitations.

## P1 — Product Flow / UX

- [ ] Validate recording → stop → save → discovery → review → filter → run → monitor → results → artifacts.
- [ ] Keep recording state unambiguous.
- [ ] Make discovery confidence, item count, selected/skipped items, and intended actions visible before execution.
- [ ] Provide clear per-item execution outcomes and failure reasons.

## P2 — Deferred

- [ ] Implement product authentication after the core pipeline is stable.
- [ ] Revisit scheduling/queues only if they become explicit requirements.
- [ ] Revisit cloud/distributed execution only when scale requirements are known.
- [ ] Revisit AI-assisted selector recovery only after deterministic behavior is sufficiently validated.
- [ ] Finalize product naming/branding.

## Release Discipline

Until the core pipeline is reliable, prioritize bug fixes, validation, usability, and filter generalization over unrelated feature expansion.
