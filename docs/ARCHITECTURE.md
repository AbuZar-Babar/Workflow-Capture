# Workflow Capture — Architecture

## 1. Architectural Goal

Workflow Capture is a **generic browser automation engine with portal-specific workflow/configuration**.

The engine owns reusable mechanisms for recording, selector resolution, replay, item discovery, filtering, repeated execution, downloads, and run/artifact tracking. Portal-specific behavior should primarily be represented through workflow/configuration data or focused adapters.

## 2. High-Level Flow

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
  ├── Filter Evaluation
  ├── Loop / Batch Runner
  └── Download / Artifact Manager
          ↓
        Portal
          ↓
   Files / Artifacts
```

## 3. Recording Pipeline

```
Browser
  ↓
CDP events
  ↓
Event normalization / debouncing
  ↓
Selector fingerprint generation
  ↓
Recorded workflow steps
  ↓
Workflow persistence
  ↓
Visual editor
```

Recording should capture enough semantic context for resilient replay while avoiding storage of sensitive password values.

## 4. Replay Pipeline

```
Saved Workflow
  ↓
Normalize workflow schema
  ↓
Resolve target
  ↓
Wait for required condition/state
  ↓
Execute action
  ↓
Continue
```

The selector resolver uses multiple candidate strategies rather than depending on a single brittle CSS/XPath selector.

## 5. Item Discovery

Item discovery is a first-class execution capability.

```
Portal DOM
   ↓
Candidate collections
   ↓
Repeated-structure analysis
   ↓
Collection/container detection
   ↓
Repeated items
   ↓
Confidence / validation
   ↓
Action generalization
   ↓
Item-scoped workflow
```

Relevant structures include tables, lists, cards and other repeated portal records.

A representative recorded action can be generalized into an item-relative action so it can operate on multiple discovered items.

## 6. Filtering

Filtering is currently being generalized.

```
Discovered Items
      ↓
Filter configuration
      ↓
Evaluate item attributes/content
      ↓
Selected items ──→ execution
Skipped items ───→ run results
```

The current implementation contains a portal-specific/hardcoded filter value. That is an intermediate implementation, not the final generic filter architecture.

The eventual filter contract should be configurable and independent of one portal's field names or values.

## 7. Repeated Execution

The loop runner processes selected items and should re-query dynamic DOM state between iterations.

Conceptual item states:

- pending
- running
- succeeded
- failed
- skipped

Failure isolation should allow a failed item to be reported without unnecessarily aborting the complete batch.

## 8. Downloads and Artifacts

The traceability model is:

```
Workflow
  ↓
Run / Timestamp
  ↓
Item
  ↓
Actions
  ↓
Artifact
```

Downloads should remain associated with the workflow run and the item that produced them. This supports structured storage, duplicate prevention, artifact inspection, and post-run auditing.

## 9. Portal Boundary

### Generic engine

- CDP/browser interaction
- recording
- selector resolution
- workflow execution
- item discovery
- filtering
- loops/retries
- downloads
- run/artifact tracking

### Portal-specific configuration/adapters

- target routes/pages
- portal-specific selectors or semantic hints
- collection configuration where necessary
- fields used by filters
- workflow-specific values/actions
- unusual portal interaction mechanisms

The goal is to avoid turning the core engine into a collection of portal-specific one-off implementations.

## 10. Dashboard

The dashboard provides:

- workflow management
- recording controls
- visual workflow editing
- discovery/review
- filtering
- execution monitoring
- results
- artifacts

The frontend uses Vanilla JavaScript ES modules. Drawflow provides the visual workflow graph.

## 11. Authentication

Authentication is deliberately **not on the current critical path**.

Existing authentication/security infrastructure may remain in the codebase, but product authentication workflows are deferred until the core recording → discovery → filtering → execution → artifact pipeline is stable.

## 12. Deferred Architecture

Cloud execution, distributed queues, scheduling, AI selector recovery, multi-user production infrastructure, and Document AI are not current commitments. They should only be promoted into the architecture when explicit product requirements justify them.
