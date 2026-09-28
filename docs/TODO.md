# Workflow Capture — Current Follow-up Work

Task ownership, dependencies, and implementation status are maintained in [WORKSTREAMS.md](WORKSTREAMS.md); do not use this page to claim task completion. The confirmed loop and filter behavior is in [LOOP-FILTER-REQUIREMENTS.md](LOOP-FILTER-REQUIREMENTS.md).

Tasks 0–7, 12, and 13 are integrated on `multi-agent` at `739ee486094e19b80cc6b4a9a78a90821a165d8b`. Test suites have been classified in [TESTING.md](TESTING.md) and automated in CI (`.github/workflows/ci.yml`).

## Integrated foundation work

- [x] Task 12: Extend the evaluator to multiple text/date conditions with `all` and `any` semantics.
- [x] Task 13: Add inclusive date ranges, positive attempt limits, and distinct filter/limit skipped states to the review UI.
- [x] Task 6: Wire the filter/limit contract through discovery preview, execution API, loop runtime, counters, manifests, and SSE state.
- [x] Task 7: Partition test suites into fast unit/API and browser-isolated suites, establish testing guide, and configure CI automation.

## Current work

- [ ] Task 8: Complete documentation and status reconciliation across all project records.

## Next work

- [ ] Task 9: Cross-portal / E2E release gate validation:
  - [ ] Validate recording → discovery → review → filter/limit → execution → monitor → artifacts on fixtures.
  - [ ] Validate preview/runtime agreement across representative portal DOM structures (tables, divs, lists).
  - [ ] Validate failures, retries, compound filters, date boundaries, and item limits together in end-to-end runs.
  - [ ] Document portal compatibility matrix and operational limitations.
- [ ] Task 10: Dashboard lifecycle correctness (follows Task 9 release gate validation).

## Blocked work

- None currently blocked by external blockers. Task 10 is sequenced after Task 9 validation findings.

## Deferred work

- [ ] Task 11: Modularization of large modules (deferred until behavior is stable across release gates).
- [ ] Add pagination, Load More, infinite scroll, or virtualized-list support after current-page processing is certified.
- [ ] UI modernization initiative (separate future workstream following functional baseline stabilization; do not modify UI source code during stabilization tasks).
- [ ] Cloud-scale execution, distributed queues, scheduling, AI selector recovery, and Document AI.
