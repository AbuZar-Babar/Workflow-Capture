# Workflow Capture

> **Working name:** Workflow Capture  
> **Status:** Active development / feature implementation + stabilization  
> **Project type:** Professional/company project for Tekgee Technologies — not an academic/FYP project  
> **Branch:** `ui-improvements`

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
- repeated workflow execution
- item-level processing

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

Filtering is **currently under active development**.

A specific portal currently uses a hardcoded filtering value as an intermediate implementation. The target is a reusable filter system that can select or skip discovered items based on item/row attributes or content.

The generic filter schema is **not yet finalized**, so current portal-specific filtering should not be treated as the final design.

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

### Substantially implemented
- CDP/browser automation foundation
- workflow recording and replay
- selector resolution
- item discovery
- action generalization
- loop/batch execution
- download handling
- workflow/run/artifact tracking
- visual workflow editor
- dashboard execution UI

### Active work
- generic reusable item filters
- loop execution reliability
- real-portal validation
- complete dashboard journey validation
- stabilization and hardening

### Deferred
Authentication is **not currently a product priority**. It will be addressed later, after the core recording → discovery → filtering → execution → artifact pipeline is fully working.

Other speculative capabilities such as cloud-scale execution, distributed queues, scheduling, AI selector recovery, and Document AI are also deferred unless they become explicit requirements.

## Known Validation Issues

The latest engineering audit identified:

- full `npm test` can encounter a Windows/Puppeteer Chrome temporary-profile cleanup `EBUSY` error;
- a focused loop E2E run connected successfully, discovered four repeated items, and completed the first item/download, but stalled when beginning item two;
- real-portal compatibility still needs broader validation;
- generic filtering is not yet finalized.

These are current engineering findings, not formal coverage percentages.

## Project Priorities

1. Make recording/replay reliable.
2. Make item discovery reliable.
3. Generalize filtering beyond the current hardcoded portal value.
4. Make repeated-item execution reliable.
5. Maintain structured downloads and artifact traceability.
6. Validate the complete recording → discovery → filtering → execution → artifact flow.
7. Validate against real portals.
8. Defer authentication and speculative platform expansion until the core product is stable.

## Documentation

- [Product & Technical Plan](docs/PROJECT-PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [TODO / Current Work](docs/TODO.md)
- [Changelog](CHANGELOG.md)

## Project Classification

Workflow Capture is **professional/company engineering work for Tekgee Technologies**.

The local workspace path may contain a directory named `FYP`, but that is only filesystem organization. It does not mean Workflow Capture is an academic FYP.
