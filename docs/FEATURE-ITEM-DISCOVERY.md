# Feature Branch: Item Discovery

**Branch:** `feature/item-discovery`  
**Base:** `main`  
**Status:** In development  
**Primary objective:** Convert a recorded single-item workflow into a reusable batch workflow by discovering the collection of similar records on the current page.

---

## 1. Purpose

The current Workflow Capture foundation can record browser interactions, resolve targets using resilient selectors/fingerprints, replay workflows, and execute loop infrastructure.

This branch focuses on the next product capability:

> **A user demonstrates how to process one record, and the system identifies the other records that can be processed using the same procedure.**

The initial business scenario is document/invoice collection from management-company portals.

### Example

A portal contains 10 invoices.

The user manually processes Invoice #1:

```
Open invoice #1
    ↓
Click/download PDF
    ↓
Return to invoice list
```

Workflow Capture should then:

```
Recorded procedure
      ↓
Identify the invoice collection
      ↓
Identify invoice #1 as the demonstrated item
      ↓
Find the remaining matching items
      ↓
Report: "Found 10 invoices"
      ↓
User confirms
      ↓
Execute the procedure for each invoice
```

This branch deliberately focuses on **collection discovery and current-page item iteration**. Pagination is a subsequent milestone.

---

## 2. Product Principle

### Record the procedure, not the records

The recorder must not generate a workflow containing one hard-coded action sequence per invoice.

Instead, the recorded interaction should become an item-relative procedure:

```
recorded action
     ↓
understand item context
     ↓
generalize target
     ↓
discover collection
     ↓
iterate over current items
```

This distinction is the foundation of the product.

---

## 3. Scope of This Branch

### In scope

1. Identify repeated records on the current page.
2. Identify the collection/container containing those records.
3. Identify the recorded item within that collection.
4. Determine which elements represent equivalent items.
5. Create an item collection that can be iterated.
6. Resolve recorded actions relative to the current item.
7. Re-query the DOM between iterations.
8. Report the discovered item count.
9. Require explicit user confirmation before batch execution.
10. Execute the recorded item procedure against each discovered item.
11. Track basic per-item execution state.
12. Produce a useful execution result for the batch.

### Out of scope for this branch

- Pagination and multi-page traversal.
- Infinite scroll.
- Load More handling.
- Cross-portal adapter framework.
- AI-based discovery.
- Autonomous selector repair.
- Document AI / OCR.
- Production job queues and cloud execution.
- CAPTCHA bypass.

Those capabilities remain in later roadmap phases.

---

## 4. Functional Requirements

### FR-01 — Collection discovery

The engine must inspect the DOM surrounding the recorded item and identify candidate repeated collections.

Candidate structures include:

- table rows;
- list items;
- cards;
- repeated containers;
- repeated links/buttons.

### FR-02 — Candidate scoring

Candidate collections should be ranked using observable structural and semantic signals, such as:

- shared parent;
- similar DOM hierarchy;
- matching tag structure;
- shared stable attributes;
- similar child elements;
- similar text structure;
- repeated actionable controls;
- similarity to the recorded item's fingerprint.

The implementation should produce enough diagnostic information to understand why a collection was selected.

### FR-03 — Item identification

The engine must identify the demonstrated item inside the selected collection.

An item should retain useful metadata where available:

- stable ID;
- visible text;
- URL/href;
- DOM fingerprint;
- position/index;
- identifying attributes.

### FR-04 — Item-relative execution

A recorded target that belongs to the demonstrated item should be resolved relative to the current item during iteration.

Conceptually:

```
Recorded target
     ↓
Item context
     ↓
Equivalent target in current item
```

The system must avoid replaying the exact original DOM position when a stable item-relative target is available.

### FR-05 — Dynamic DOM re-query

The engine must not depend on a stale array of DOM nodes.

Each iteration should re-query the current page state because portals may:

- rerender rows;
- replace nodes;
- virtualize lists;
- update classes/attributes;
- open/close modals.

### FR-06 — Confirmation

Before executing a discovered batch, the system should expose:

- collection type;
- discovered item count;
- representative item information;
- relevant diagnostics.

The user must explicitly confirm the batch in the MVP.

### FR-07 — Per-item execution state

At minimum, an item should be representable as:

```
DISCOVERED
IN_PROGRESS
SUCCEEDED
FAILED
SKIPPED
```

The state must be associated with the item identity when possible.

### FR-08 — Failure isolation

A failed item should not automatically terminate the entire batch when continuing is safe.

Example:

```
Invoice 001  SUCCEEDED
Invoice 002  SUCCEEDED
Invoice 003  FAILED
Invoice 004  SUCCEEDED
```

The final result must preserve the failure information.

---

## 5. Proposed Technical Model

The existing workflow model is action-oriented. This branch introduces the concept of an **item context** without prematurely redesigning the entire workflow format.

### Conceptual model

```
Workflow
 ├── Fixed actions
 └── Item workflow
       ├── target relative to current item
       ├── action
       └── action
```

A future normalized representation may look like:

```json
{
  "type": "LOOP",
  "source": "discovered.items",
  "itemVariable": "currentItem",
  "workflow": [
    {
      "type": "ACTION",
      "action": "open",
      "target": {
        "scope": "currentItem"
      }
    },
    {
      "type": "ACTION",
      "action": "download",
      "target": {
        "scope": "currentItem"
      }
    }
  ]
}
```

This JSON is a design target, not a requirement to implement this exact schema immediately.

---

## 6. Discovery Pipeline

The first implementation should follow a deterministic pipeline:

```
Recorded workflow
       ↓
Recorded target/fingerprint
       ↓
Find nearby structural candidates
       ↓
Find repeated sibling/container patterns
       ↓
Score candidate collections
       ↓
Select best candidate
       ↓
Enumerate equivalent items
       ↓
Validate minimum confidence
       ↓
Return discovered collection
```

### Important rule

Discovery should fail safely.

If confidence is low, the system should report:

```
Unable to confidently identify the repeated collection.
```

It should not silently process unrelated records.

---

## 7. Initial Discovery Heuristics

The first version should prefer simple, explainable heuristics.

### Priority 1 — Sibling repetition

Look for multiple siblings that share:

- the same element type;
- similar child structure;
- similar attributes;
- similar actionable controls.

### Priority 2 — Repeated container structure

Identify a parent containing multiple structurally similar children.

### Priority 3 — Recorded target similarity

Compare the recorded item fingerprint against candidate siblings.

### Priority 4 — Action-target similarity

If the recorded workflow clicked a download button, search candidate items for equivalent download controls.

The implementation should keep these heuristics modular so they can later be replaced or augmented by stronger algorithms.

---

## 8. Safety Rules

Bulk automation is potentially destructive. The first implementation must be conservative.

### Rule 1 — Never bulk execute without confirmation

Discovery:

```
Found N items
```

must be followed by explicit confirmation before execution.

### Rule 2 — Minimum confidence threshold

If the discovery score is below the configured threshold, stop and request human intervention.

### Rule 3 — No CAPTCHA bypass

If CAPTCHA or a human-verification challenge blocks execution, pause for the user.

### Rule 4 — Preserve item identity

Do not rely solely on array indexes when a stable record identifier is available.

### Rule 5 — Never assume static DOM nodes

Re-query the page for every iteration.

---

## 9. Acceptance Criteria

This branch is successful when the following scenario works reliably on a representative test portal:

```
1. User opens an invoice list.
2. User records processing of one invoice.
3. Recorder saves the workflow and item context.
4. Discovery identifies the invoice collection.
5. System reports the discovered item count.
6. User confirms execution.
7. Engine processes each invoice on the current page.
8. DOM is re-queried between items.
9. Each item receives an execution status.
10. A failed item does not incorrectly mark successful items as failed.
11. The final run contains enough information to diagnose the result.
```

### Minimum proof

```
1 manual demonstration
        ↓
N discovered invoices
        ↓
N item executions
        ↓
per-item result
```

Pagination is **not** required for this branch's acceptance.

---

## 10. Test Strategy

### Unit tests

Test independently:

- repeated-structure detection;
- collection scoring;
- item fingerprint comparison;
- item-relative target resolution;
- confidence thresholds;
- item state transitions.

### Integration tests

Use the existing sandbox portals to validate:

- collection discovery;
- item iteration;
- dynamic DOM changes;
- failure isolation.

### Real-portal validation

After deterministic tests pass, validate against at least one realistic management-company/invoice portal.

The real portal should be treated as a validation target, not as the source of generic assumptions.

---

## 11. Implementation Order

The implementation should proceed in small, reviewable steps:

### Step 1 — Discovery data model

Define the internal representation for:

- collection;
- item;
- item identity;
- discovery score;
- discovery diagnostics.

### Step 2 — Collection detector

Implement repeated sibling/container detection.

### Step 3 — Item matcher

Match the recorded item against discovered candidates.

### Step 4 — Item-relative target resolution

Extend target resolution so recorded actions can operate inside the current item.

### Step 5 — Current-page loop

Execute the item workflow for every discovered item.

### Step 6 — Confirmation + diagnostics

Expose discovered count, confidence, and diagnostics before execution.

### Step 7 — Item-level state

Add execution states and final batch results.

### Step 8 — Tests

Add unit and integration coverage before moving to pagination.

---

## 12. Expected Deliverables

By the end of this branch we should have:

- a deterministic collection discovery component;
- a discovered-item data model;
- item-relative target resolution;
- current-page batch execution;
- confirmation before batch execution;
- per-item execution state;
- failure isolation;
- unit/integration tests;
- documentation of discovery behavior and limitations.

---

## 13. What Comes After This Branch

Once current-page discovery and iteration are reliable, the next branch should address pagination:

```
feature/item-discovery
        ↓
feature/pagination
        ↓
feature/download-tracking
        ↓
feature/production-execution
        ↓
feature/ai-recovery
```

The pagination branch will add:

- Next buttons;
- numbered pages;
- Load More;
- infinite scroll;
- duplicate prevention across pages;
- page-state synchronization.

---

## 14. Definition of Done

This branch is ready for review when:

- [ ] Collection discovery works on the test fixture.
- [ ] Discovery has deterministic scoring and diagnostics.
- [ ] Item context can be resolved reliably.
- [ ] Current-page items can be processed in a loop.
- [ ] DOM is re-queried per iteration.
- [ ] User confirmation is required.
- [ ] Item-level failures are isolated.
- [ ] Results are persisted or returned in a structured form.
- [ ] Unit tests cover discovery and item matching.
- [ ] Integration tests cover the complete current-page workflow.
- [ ] No pagination assumptions are embedded in the current-page implementation.
- [ ] Documentation reflects the actual implementation.
- [ ] The branch is ready for a pull request into `main`.

---

## 15. Engineering Principle

The implementation should optimize for **generalizable behavior**, not for making one portal pass.

If a portal-specific workaround is necessary, isolate it behind a strategy/adapter rather than weakening the generic discovery engine.

The branch should answer one technical question:

> **Can Workflow Capture reliably turn one recorded item procedure into a repeatable procedure for the other equivalent items on the page?**
