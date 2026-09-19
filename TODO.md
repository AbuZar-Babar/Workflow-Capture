# Workflow Capture — Roadmap & TODO

This roadmap reflects the current product direction: **record one document/record workflow, discover the complete collection, iterate over it, handle pagination/dynamic content, reliably download artifacts, and later feed those artifacts into Document AI.**

For the detailed architecture and product strategy, see [PROJECT-PLAN.md](docs/PROJECT-PLAN.md).

---

## Current Status

### Core foundation — implemented

- [x] CDP connection to an existing Chrome session.
- [x] Reuse of authenticated browser state.
- [x] In-page interaction recording.
- [x] CLICK / DOUBLE_CLICK / TYPE / SELECT / KEY_PRESS capture.
- [x] Password value redaction.
- [x] Iframe-aware recording infrastructure.
- [x] Multi-candidate selector generation.
- [x] Element fingerprinting and weighted resolution.
- [x] Dynamic ID / transient class filtering.
- [x] Condition-based element waiting.
- [x] Enterprise SPA / Angular Material resilience.
- [x] Workflow JSON persistence.
- [x] Workflow CRUD APIs.
- [x] Run creation, status tracking and cancellation.
- [x] Dashboard workflow inspection/editing.
- [x] Live execution logs.
- [x] Loop replay infrastructure.
- [x] Repeated table/list/card detection foundation.
- [x] Per-item failure isolation foundation.
- [x] CDP download interception.
- [x] Run download manifests.
- [x] Authentication/security layer.
- [x] Automated unit/integration/E2E tests.

> These capabilities exist in the current prototype. The roadmap below focuses on making them reliable and productized around the document-collection use case.

---

# Priority Roadmap

## Phase 1 — Prove the Single-Item Workflow

**Goal:** reliably record and replay one document-download procedure.

- [ ] Validate against a real management-company invoice portal.
- [ ] Record navigation → open invoice → download → return.
- [ ] Verify download completion rather than only detecting a click.
- [ ] Associate the downloaded artifact with the recorded/current item.
- [ ] Improve diagnostics when a recorded target cannot be resolved.

**Exit criterion:** one demonstrated invoice workflow can be replayed reliably.

---

## Phase 2 — Collection Discovery + Automatic Item Loop

**Priority: NEXT**

**Goal:** turn one recorded item workflow into a batch workflow.

### Discovery

- [ ] Detect repeated table rows.
- [ ] Detect repeated list items/cards.
- [ ] Identify the common parent/collection.
- [ ] Identify the current recorded item inside that collection.
- [ ] Score candidate collections using structural similarity.
- [ ] Expose discovered item count to the user.
- [ ] Require confirmation before the first bulk execution.

### Generalization

- [ ] Replace a concrete recorded item target with a current-item reference.
- [ ] Resolve the workflow relative to the current item.
- [ ] Preserve item metadata such as text, URL and stable IDs.
- [ ] Re-query the DOM for each iteration.

### Execution

- [ ] Process every discovered item.
- [ ] Reset page state between items.
- [ ] Continue after item-level failure.
- [ ] Record per-item status.

**Exit criterion:**

```
User processes Invoice #1
        ↓
System detects 10 invoices
        ↓
User confirms
        ↓
System downloads all 10
```

---

## Phase 3 — Pagination & Dynamic Collections

- [ ] Detect standard Next buttons.
- [ ] Detect numbered pagination.
- [ ] Detect Load More.
- [ ] Support infinite scroll.
- [ ] Wait for list state/content changes after navigation.
- [ ] Prevent duplicate processing across pages.
- [ ] Support virtualized tables through DOM re-querying.
- [ ] Detect end-of-collection reliably.
- [ ] Add portal-specific pagination adapters where required.

**Exit criterion:** a collection spanning multiple pages can be processed without manually specifying page count.

---

## Phase 4 — Download Reliability & Checkpointing

- [ ] Verify download completion.
- [ ] Associate artifact ↔ item ↔ workflow run.
- [ ] Detect duplicate downloads.
- [ ] Generate deterministic file names.
- [ ] Persist item identity where available.
- [ ] Add item states: DISCOVERED / IN_PROGRESS / DOWNLOADED / FAILED / RETRY_PENDING / SKIPPED.
- [ ] Retry failed items.
- [ ] Resume interrupted runs.
- [ ] Allow retry-only-failed-items.
- [ ] Generate complete execution manifest.
- [ ] Capture failure screenshots and diagnostics.

**Exit criterion:** a 100-item run can fail partway through and resume without unnecessarily repeating successful work.

---

## Phase 5 — Multi-Portal Generalization

Validate the engine against genuinely different management-company portals.

Target differences:

- Angular Material;
- ExtJS;
- React/Vue;
- server-rendered tables;
- virtualized grids;
- modal-based downloads;
- direct download links;
- generated download buttons;
- multiple pagination styles.

Tasks:

- [ ] Build a portal test matrix.
- [ ] Identify generic behavior vs portal-specific behavior.
- [ ] Move portal-specific heuristics into adapters where appropriate.
- [ ] Avoid adding one-off hacks to the generic resolver.
- [ ] Establish regression fixtures for each portal type.

**Exit criterion:** the same core workflow model can handle multiple portal architectures without rewriting the engine.

---

## Phase 6 — Production Execution

- [ ] Standalone headless execution.
- [ ] Browser session isolation.
- [ ] Docker execution environment.
- [ ] Job queue.
- [ ] Scheduled workflows.
- [ ] Persistent artifact storage.
- [ ] Cloud execution.
- [ ] Execution monitoring.
- [ ] Failure notifications.
- [ ] Resource/time limits.
- [ ] Workflow versioning.

---

## Phase 7 — AI-Assisted Discovery & Recovery

AI should be an assistance layer over deterministic automation.

- [ ] Detect when deterministic selector resolution fails.
- [ ] Ask AI to identify candidate equivalent elements.
- [ ] AI-assisted collection identification.
- [ ] AI-assisted pagination detection.
- [ ] Workflow repair suggestions.
- [ ] Human approval for uncertain repairs.
- [ ] Evaluate Browser Use / similar agent frameworks as an optional provider.
- [ ] Keep deterministic execution as the normal path.

### Desired recovery flow

```
Known workflow
      ↓
Deterministic execution
      ↓
Success? ── YES → Continue
   │
   NO
   ↓
AI recovery/discovery
   ↓
Confidence acceptable?
   │
  YES → Continue + optionally save repair
   │
   NO
   ↓
Human intervention
```

---

## Phase 8 — Document AI Pipeline

This is downstream from browser automation.

- [ ] PDF/document ingestion.
- [ ] Document classification.
- [ ] OCR/text extraction where needed.
- [ ] Invoice field extraction.
- [ ] Entity normalization.
- [ ] Validation rules.
- [ ] Structured database storage.
- [ ] Document-to-record linking.
- [ ] Human review for low-confidence extraction.
- [ ] Reporting/export.
- [ ] Business-specific AI actions.

Target pipeline:

```
Portal
  ↓
Workflow Capture
  ↓
Document Collection
  ↓
File Storage
  ↓
Document AI
  ↓
Structured Data
  ↓
Management Workflow
```

---

# Important Architectural Rules

1. **Record procedures, not individual records.**
2. **Re-query dynamic DOM content between loop iterations.**
3. **Use resilient target resolution instead of brittle selectors.**
4. **Treat discovery as a first-class workflow operation.**
5. **Treat loops and pagination as first-class execution operations.**
6. **Keep item failures isolated where safe.**
7. **Make runs resumable and idempotent.**
8. **Keep portal-specific behavior behind adapters where practical.**
9. **Use deterministic automation first; AI is the recovery/discovery layer.**
10. **Never bypass CAPTCHA; pause for human verification.**
11. **Keep browser automation and Document AI as separable layers.**

---

# Immediate Next Task

The next implementation target is intentionally narrow:

> **Record one invoice → detect the invoice collection → show the number of matching invoices → execute the recorded download workflow for every invoice on the current page → produce an item-level download manifest.**

Only after this works should pagination be added.

### First validation scenario

```
Portal
  ↓
Invoice list
  ↓
Manually process Invoice #1
  ↓
Stop recording
  ↓
Discovery finds Invoice #1 ... #N
  ↓
User confirms
  ↓
Loop executes
  ↓
PDF #1 ... PDF #N
  ↓
Manifest
```

This is the core proof-of-concept for the product.
