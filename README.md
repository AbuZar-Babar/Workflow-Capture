# Workflow Capture

> **Working name:** Workflow Capture  
> **Status:** Active development / feature implementation + stabilization  
> **Project type:** Professional/company project for Tekgee Technologies — not an academic/FYP project  
> **Current integration branch:** `multi-agent`
> **Status snapshot:** 2026-09-28 — Tasks 0–7, 12, and 13 integrated; Task 8 (Documentation & Status Reconciliation) active; Task 9 (Cross-portal and end-to-end validation) is the next milestone; see [agent workstreams](docs/WORKSTREAMS.md).

Workflow Capture is a generic browser automation platform with two core capabilities:

1. **Record and replay browser workflows.**
2. **Discover repeated items on a portal, filter them, execute item-scoped workflows, and download/track their artifacts.**

The final product name has not yet been decided.

## Product Goal

The product is not intended to be only a macro recorder. The intended flow is:

```
Open portal
   ↓
Start Recording
   ↓
User demonstrates the workflow
   ↓
Stop Recording / Save
   ↓
Discover repeated items
   ↓
Review / Filter selected items
   ↓
Execute workflow for each selected item
   ↓
Monitor run
   ↓
Download and organize artifacts
```

The core abstraction is:

> **Record the procedure, not every individual record.**

For example, a user can demonstrate how to download one invoice. Workflow Capture should discover the repeated invoice collection, generalize the relevant actions, apply optional filters, process the selected invoices, and associate the resulting files with the execution.

## Architecture Principle

The system is designed as a **generic automation engine + portal-specific workflow/configuration**.

Generic engine responsibilities include:

- browser/CDP interaction
- workflow recording
- selector resolution
- workflow replay
- item discovery
- filter evaluation
- repeated-item execution
- retries/failure isolation
- downloads
- run/artifact tracking

Portal-specific details should primarily live in workflow/configuration data or adapters where genuinely necessary.

## Current Core Capabilities

### Workflow recording
- CDP-based browser interaction capture
- action normalization
- event debouncing
- password-input redaction
- iframe/nested-frame handling
- resilient selector fingerprints
- visible recording-state feedback
- visible Stop Recording control

### Replay
- resilient selector resolution
- semantic/text/attribute/CSS/XPath fallback strategies
- condition-based waiting
- repeated-item loop runner with item-level processing, retry/checkpoint support, and run manifests
- isolated browser-test infrastructure for concurrent test runs

### Item discovery

**Item discovery is a core product capability.**

The engine can identify repeated structures such as:

- table rows
- lists
- cards
- dropdown options
- repeated portal records

The intended model is:

```
Recorded representative item
        ↓
Discover repeated collection
        ↓
Generalize action
        ↓
Execute against selected items
```

### Filtering

The filtering milestone provides end-to-end filter evaluation and item-limit controls. It includes a reusable evaluator supporting compound conditions (`all`/`any`), string operators (`contains`, `equals`), and deterministic inclusive `dateBetween` date ranges. The contract is wired end-to-end through discovery preview, dashboard review UI, execution API (`itemFilter`, `loopLimit`), loop runtime, live counters, execution manifests, and SSE event streaming with distinct `SKIPPED_FILTER` and `SKIPPED_LIMIT` item outcomes. See [Loop and Filter Requirements](docs/LOOP-FILTER-REQUIREMENTS.md).

### Downloads and artifacts

Downloads are organized around execution context rather than a flat directory.

The intended traceability model is:

```
Workflow
  ↓
Run / Timestamp
  ↓
Item
  ↓
Artifact
```

This supports structured storage, artifact traceability, duplicate/unwanted-download handling, and post-run inspection.

## Current Architecture

```
User
  ↓
Dashboard
  ├── Recorder
  ├── Workflow Editor
  └── Execution Monitor
          ↓
Workflow JSON
          ↓
Replay / Automation Engine
  ├── Selector Resolver
  ├── Item Discovery
  ├── Filter
  ├── Loop / Batch Runner
  └── Download / Artifact Manager
          ↓
       Portal
          ↓
   Files / Artifacts
```

### Technology

- Node.js
- Express.js
- Chrome DevTools Protocol (CDP)
- Puppeteer / Puppeteer-core
- Vanilla JavaScript ES modules
- Drawflow visual workflow editor
- REST APIs + Server-Sent Events (SSE)
- Local JSON/document-style persistence

## Dashboard

The dashboard provides surfaces for:

- workflow management
- recording
- workflow editing
- item discovery/review
- filtering
- execution monitoring
- results
- artifacts/downloads

The frontend is **Vanilla JS**, not React/Vue.

## Current Development Status

### Integrated foundations
- CDP/browser automation foundation
- workflow recording and replay
- selector resolution
- item discovery
- action generalization
- repeated-item execution, retry/checkpoint foundations, and process cleanup
- download handling
- workflow/run/artifact tracking
- visual workflow editor
- dashboard discovery/review/execution UI foundation
- local dashboard authentication and access-control hardening
- reusable item-filter evaluator with compound/date semantics and legacy compatibility
- filter review UI with multiple conditions, preview counts, item limits, and distinct filter/limit skip states
- end-to-end filter and item-limit API/runtime execution wiring (Task 6)
- complete test suite taxonomy (fast unit/API, browser-isolated, complete suite) with CI automation (Task 7)

### Active work
- Task 8: Documentation & status reconciliation across all project records.

### Next milestones
- Task 9: Cross-portal / E2E release gate validation across representative portal fixtures.
- Task 10: Dashboard lifecycle correctness (after release gate validation).
- Task 11: Modularization of large modules (deferred until behavior is stable).

### Deferred
Pagination beyond the current discovered result set, cloud-scale execution, distributed queues, scheduling, AI selector recovery, and Document AI remain future work unless separately prioritized. Dashboard security has been addressed; logging into a target portal remains part of the user's browser/session workflow.

## Known Validation Issues

Tasks 0–7, 12, and 13 have passed focused validation and are integrated into `multi-agent` at `739ee486094e19b80cc6b4a9a78a90821a165d8b`. Test infrastructure has been formalized into fast, API, and browser-isolated suites documented in [Testing Guide](docs/TESTING.md) and automated via `.github/workflows/ci.yml`. However, comprehensive cross-portal validation across varied DOM patterns (tables, divs, nested lists) and full end-to-end recording-to-artifact journeys remain to be validated in Task 9. See [the workboard](docs/WORKSTREAMS.md) for current task state and [implementation status](docs/IMPLEMENTATION-STATUS.md) for evidence limits.

## Project Priorities

1. Complete Task 8 documentation and status reconciliation.
2. Execute Task 9 cross-portal and end-to-end release gate validation.
3. Validate failures, retries, compound filters, date boundaries, and item limits together in end-to-end scenarios.
4. Verify recording → discovery → review → execution → artifact journey across representative portal fixtures.
5. Address dashboard lifecycle and navigation correctness (Task 10).
6. Defer pagination, modularization, and speculative platform expansion until baseline behavior is certified.

## Documentation

- [Product & Technical Plan](docs/PROJECT-PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [Testing Guide](docs/TESTING.md)
- [TODO / Current Work](docs/TODO.md)
- [Loop and Filter Requirements](docs/LOOP-FILTER-REQUIREMENTS.md)
- [Agent Workstreams](docs/WORKSTREAMS.md)
- [Changelog](CHANGELOG.md)

## Project Classification

Workflow Capture is **professional/company engineering work for Tekgee Technologies**.

The local workspace path may contain a directory named `FYP`, but that is only filesystem organization. It does not mean Workflow Capture is an academic FYP.
