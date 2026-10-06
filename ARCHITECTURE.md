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

Filtering is evaluated against structured fields extracted from each discovered item prior to repeated execution. The live contract supports compound boolean evaluation with preview and execution parity.

```
Discovered Items
      ↓
Filter Evaluation (all / any conditions)
      ↓
Selected items ──→ Execution (up to loopLimit)
      ↓
Skipped items:
  ├─ SKIPPED_FILTER (failed condition matching)
  └─ SKIPPED_LIMIT  (matched filter, but beyond loopLimit)
```

### Filter Contract

- **Match Mode**: Configurable as `all` (AND, default) or `any` (OR).
- **Operators**:
  - `contains`: Case-insensitive substring match after trimming string values.
  - `equals`: Case-insensitive exact match after trimming string values.
  - `dateBetween`: Strict `YYYY-MM-DD` date-only inclusive calendar comparison where `from <= to`. Unparseable or ambiguous dates fail the condition with explicit skip rationale.
- **Missing Field Validation**: A configured filter field absent from the item discovery schema is treated as a configuration error and immediately blocks execution; the engine never silently falls back to searching the entire row.
- **Positive Limit (`loopLimit`)**: Applied after filtering in discovery order. The first N matching items are selected. Each selected item consumes one attempt slot when execution begins regardless of subsequent success or failure. Retries do not consume additional slots.
- **Lifecycle Item States**:
  - `pending` / `running`
  - `succeeded` / `failed`
  - `SKIPPED_FILTER`: Items that did not satisfy filter conditions.
  - `SKIPPED_LIMIT`: Items that satisfied filter conditions but exceeded `loopLimit`.
- **Preview & Runtime Parity**: Discovery preview and runtime execution share the exact same evaluation logic, field normalization, and limit slicing to guarantee identical item counts and ordering.

## 7. Repeated Execution

The loop runner processes selected items and should re-query dynamic DOM state between iterations.

Conceptual item states:

- pending
- running
- succeeded
- failed
- skipped by filter (`SKIPPED_FILTER`)
- skipped by attempt limit (`SKIPPED_LIMIT`)

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

Dashboard local-mode authentication and access-control hardening are integrated. Portal authentication is separate: the automation uses the user's authenticated browser/session and does not currently provide a general portal-login service.

## 12. Architectural Decision Records (ADRs)

The key architectural decisions guiding Workflow Capture include:

- **ADR 001 — Generic Engine + Portal Configuration**: Keep browser automation mechanisms generic and represent portal-specific behavior through workflows/configuration or focused adapters.
- **ADR 002 — Item Discovery Is Core**: Repeated-item discovery is a first-class product capability. The product generalizes a demonstrated item workflow to a discovered collection.
- **ADR 003 — Generic Compound Filtering**: Use a reusable filter model over discovered item fields supporting multiple conditions, `all`/`any` matching, text `contains`/`equals`, inclusive date ranges (`dateBetween`), and an optional attempt limit (`loopLimit`).
- **ADR 004 — Structured Artifact Traceability**: Maintain strict relationship hierarchy: **Workflow → Run/Timestamp → Item → Artifact** for downloaded outputs.
- **ADR 005 — Separate Dashboard Security from Portal Login**: Dashboard local-mode authentication and access control are part of the platform baseline. Portal login remains the user's browser/session responsibility.
- **ADR 006 — Stabilization Before Speculative Expansion**: Prioritize real-portal validation and reliability before cloud-scale infrastructure, scheduling, AI recovery, or other speculative capabilities.
- **ADR 007 — Drawflow for Visual Graph**: Use Drawflow for the visual workflow graph because the dashboard uses Vanilla JavaScript ES modules and does not require a heavy React/Vue graph architecture.
- **ADR 008 — Backward-Compatible Workflow Schema**: Normalize legacy recorded action data into the current workflow-step representation at the API boundary.
- **ADR 009 — One Loop-Start Marker for the Initial Batch Model**: A workflow without a loop marker runs once. With one loop-start marker, preceding steps run once and the marked step through the final step repeats for each selected item.
- **ADR 010 — Filter First, Then Apply an Attempt Limit**: Filter discovered items first, preserve discovery order, and select the first N matches when a positive limit is configured. Each item consumes one slot when its workflow begins regardless of outcome; retries do not consume another slot. Date ranges use inclusive date-only endpoints.

## 13. Deferred Architecture

Cloud execution, distributed queues, scheduling, AI selector recovery, multi-user production infrastructure, and Document AI are not current commitments. They should only be promoted into the architecture when explicit product requirements justify them.
