# Workflow Capture — Current Follow-up Work

Task ownership, dependencies, and implementation status are maintained in [WORKSTREAMS.md](WORKSTREAMS.md); do not use this page to claim task completion. The confirmed loop and filter behavior is in [LOOP-FILTER-REQUIREMENTS.md](LOOP-FILTER-REQUIREMENTS.md).

Tasks 0–5 are integrated on `multi-agent`. Their owners reported focused validation on their task branches. The integrated end-to-end journey still needs verification.

## Next implementation work

- [ ] Extend the evaluator to multiple text/date conditions with `all` and `any` semantics (Task 12).
- [ ] Add inclusive date ranges, all-matches mode, positive attempt limits, and distinct filter/limit skipped states to the review UI (Task 13).
- [ ] Wire the same filter/limit rules through discovery preview, execution API, loop runtime, counters, and manifests (Task 6).
- [ ] Re-run focused suites after integration and validate preview/runtime agreement.
- [ ] Validate recording → discovery → review → filter/limit → execution → monitor → artifacts on fixtures.
- [ ] Validate representative table/list/card layouts on authorized portals and document limitations.

## Later work

- [ ] Add pagination, Load More, infinite scroll, or virtualized-list support after current-page processing is stable.
- [ ] Improve duplicate prevention and recovery behavior based on end-to-end findings.
- [ ] Revisit scheduling, distributed execution, AI-assisted recovery, and Document AI only when explicitly prioritized.
