# Workflow Capture

> **Working name:** Workflow Capture  
> **Status:** Active development / feature implementation + stabilization  
> **Project type:** Professional/company project for Tekgee Technologies — not an academic/FYP project  
> **Current integration branch:** `multi-agent`
> **Status snapshot:** 2026-09-27 — Tasks 0–5 integrated; see [agent workstreams](docs/WORKSTREAMS.md).

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

The integrated v1 milestone includes a pure reusable evaluator for one text condition (`contains` or `equals`) and a dashboard discovery/review flow with dynamic fields, preview counts, and visible filtered-item states. The API/runtime path that makes this filter contract consistent from preview through execution is still pending Task 6.

The confirmed next contract supports multiple conditions combined with `all` (AND) or `any` (OR), inclusive date ranges, and an optional limit on attempted items. Those v2 behaviors are requirements, not completed features. See [Loop and Filter Requirements](docs/LOOP-FILTER-REQUIREMENTS.md).

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
- v1 reusable item-filter evaluator

### Active work
- connect filter preview and execution through the API/runtime (Task 6)
- extend filters to multiple text/date conditions and `all`/`any` (Task 12)
- add user-visible attempt limits and separate filter/limit skip states (Task 13)
- run integrated cross-portal and full journey validation

### Deferred
Pagination beyond the current discovered result set, cloud-scale execution, distributed queues, scheduling, AI selector recovery, and Document AI remain future work unless separately prioritized. Dashboard security has been addressed; logging into a target portal remains part of the user's browser/session workflow.

## Known Validation Issues

Task owners reported that their assigned test suites passed on their task branches before Tasks 0–5 were integrated. The full integrated journey has not yet been rerun on `multi-agent`, and real-portal compatibility still needs broader validation. See [the workboard](docs/WORKSTREAMS.md) for current task state and [implementation status](docs/IMPLEMENTATION-STATUS.md) for evidence limits.

## Project Priorities

1. Integrate the filter and attempt-limit contract through preview, API, runtime, and persisted run state.
2. Verify normal replay and loop-marker behavior on the invoice fixture.
3. Validate failures, retries, filters, date boundaries, and item limits together.
4. Complete the full recording → discovery → review → execution → artifact journey.
5. Validate against more than one portal structure and record compatibility limits.
6. Defer pagination and speculative platform expansion until the current-page batch flow is stable.

## Documentation

- [Product & Technical Plan](docs/PROJECT-PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [TODO / Current Work](docs/TODO.md)
- [Loop and Filter Requirements](docs/LOOP-FILTER-REQUIREMENTS.md)
- [Agent Workstreams](docs/WORKSTREAMS.md)
- [Changelog](CHANGELOG.md)

## Project Classification

Workflow Capture is **professional/company engineering work for Tekgee Technologies**.

The local workspace path may contain a directory named `FYP`, but that is only filesystem organization. It does not mean Workflow Capture is an academic FYP.
