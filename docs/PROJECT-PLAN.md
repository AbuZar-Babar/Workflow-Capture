# Workflow Capture — Product & Technical Plan

## 1. Product Vision

Workflow Capture is being developed as a **generic browser automation engine for management-company portals and other web applications where users repeatedly collect documents or records**.

The primary business workflow is:

> A human demonstrates how to process one document/record once. The system learns the workflow, discovers all matching records on the portal, repeats the workflow for each record, handles pagination/dynamic lists, tracks success/failure, and stores the resulting files for downstream processing.

The system is **not intended to be a simple macro recorder**.

### Target example

A management company has an invoice portal containing 10, 100, or 1,000 invoices.

A user:

1. Logs into the portal.
2. Opens one invoice.
3. Downloads its PDF.
4. Returns to the invoice list.

Workflow Capture should turn that demonstration into a reusable item-processing workflow:

```
Login / existing session
        ↓
Navigate to invoice list
        ↓
Discover invoice collection
        ↓
For each invoice:
    identify current invoice
    execute recorded workflow
    download PDF
    verify/download tracking
        ↓
Check for another page
        ↓
Process next page
        ↓
Finish with execution manifest
```

The downloaded documents can then be passed to a separate **Document AI pipeline** for extraction, classification, validation, summarization, or other processing.

---

## 2. Core Product Principle

### Record the procedure, not the individual records

The recorder should capture:

- what the user did;
- what UI element they interacted with;
- how that element can be resolved later;
- the surrounding element/DOM context;
- navigation and state changes;
- the relationship between an action and a repeated item when detectable.

It should **not** turn a list of 100 invoices into 100 hard-coded clicks.

The target abstraction is:

```
Record one item
      ↓
Generalize the item workflow
      ↓
Discover matching items
      ↓
Iterate
      ↓
Execute
```

---

## 3. Target Architecture

```
                         Dashboard
                             │
                             ▼
                    Workflow Definition
                             │
              ┌──────────────┴──────────────┐
              │                             │
        Fixed Actions                 Item Discovery
              │                             │
       Navigate / Login              Find Collection
       Click / Type                  Find Item
       Wait / Select                 Find Pagination
              │                             │
              └──────────────┬──────────────┘
                             ▼
                     Workflow Engine
                             │
                 ┌───────────┴───────────┐
                 │                       │
             Conditions                Loops
                 │                       │
                 └───────────┬───────────┘
                             ▼
                     Download Engine
                             │
                    Run State / Manifest
                             │
                             ▼
                       File Storage
                             │
                             ▼
                  Future Document AI Layer
```

### Core components

#### Recorder
Captures human interaction through CDP and produces normalized workflow data.

#### Selector / Target Resolver
Resolves the intended element using multiple selector candidates and element fingerprints instead of relying on one brittle CSS/XPath selector.

#### Discovery Engine
Identifies repeated entities such as:

- invoice rows;
- document cards;
- table records;
- search results;
- download links;
- pagination controls.

#### Workflow Engine
Executes fixed actions, conditions, waits, loops, retries, and item-level workflows.

#### Loop Engine
Processes every discovered item and re-queries the DOM between iterations so that dynamic/virtualized lists are supported.

#### Pagination Engine
Detects and processes additional pages through:

- Next buttons;
- numbered pages;
- Load More;
- infinite scroll;
- other portal-specific pagination patterns.

#### Download Engine
Captures downloads, associates them with the current item, verifies completion where possible, and produces a run manifest.

#### Run State
Tracks:

- discovered items;
- processed items;
- successful downloads;
- failed items;
- retries;
- downloaded artifact paths;
- execution timestamps.

#### AI Recovery Layer — Future
AI/Browser Use-style capabilities may be integrated later for cases where deterministic discovery or element resolution fails.

AI should assist the deterministic engine rather than replace it.

---

## 4. Workflow Model

The workflow model should evolve beyond a flat list of recorded actions.

### Action

A deterministic interaction:

```text
CLICK
TYPE
SELECT
KEY_PRESS
NAVIGATE
DOWNLOAD
WAIT
```

### Discovery

A request to find a collection or target entity:

```text
DISCOVER_COLLECTION
DISCOVER_ITEM
DISCOVER_DOWNLOAD
DISCOVER_NEXT_PAGE
```

### Loop

Repeat an item workflow:

```text
FOR_EACH discovered.invoice
    execute item workflow
```

### Control

Execution logic:

```text
IF
ELSE
WAIT_UNTIL
RETRY
STOP
CONTINUE
```

A future workflow can therefore be represented conceptually as:

```json
{
  "steps": [
    { "type": "ACTION", "action": "navigate" },
    { "type": "DISCOVERY", "entity": "invoice_collection" },
    {
      "type": "LOOP",
      "source": "discovered.invoices",
      "workflow": [
        { "type": "ACTION", "action": "open_current_item" },
        { "type": "ACTION", "action": "download" },
        { "type": "CONTROL", "action": "verify_download" }
      ]
    },
    { "type": "CONTROL", "action": "next_page_if_available" }
  ]
}
```

This is a target model, not a requirement that every field already exists in the current implementation.

---

## 5. Discovery Strategy

Discovery is the most important new capability for the product.

### Step 1 — Observe the recorded item

The recorder stores the DOM/fingerprint context around the item the user processed.

### Step 2 — Identify repeated structure

Search for sibling or structurally similar elements:

- table rows;
- list items;
- cards;
- repeated containers;
- repeated links/buttons.

### Step 3 — Score candidate collections

Use structural and semantic evidence such as:

- same tag hierarchy;
- shared stable attributes;
- similar text structure;
- similar child elements;
- repeated action targets;
- similar dimensions;
- position within a common parent.

### Step 4 — Confirm before destructive/bulk execution

For the first versions, discovery should be:

```
Automatic detection
       ↓
Show "Found N matching items"
       ↓
User confirms
       ↓
Batch execution
```

This prevents an incorrect detector from processing unrelated records.

---

## 6. Pagination and Dynamic Content

The engine must assume that the DOM can change after every action.

It should **re-query the page instead of caching a static list of DOM nodes**.

Target behavior:

```
Discover page 1
      ↓
Process current items
      ↓
Detect next-page mechanism
      ↓
Navigate
      ↓
Wait until page/list state changes
      ↓
Discover again
      ↓
Process
      ↓
Repeat until no next page
```

The engine should eventually support:

1. Traditional Next buttons.
2. Numbered pagination.
3. Load More.
4. Infinite scrolling.
5. Virtualized tables/lists.
6. Search/filter result sets.

Portal-specific mechanisms should be implemented as adapters where possible rather than hard-coded into the generic engine.

---

## 7. Failure Handling

A single failed invoice must not necessarily terminate an entire batch.

Example:

```
Invoice 001  ✓
Invoice 002  ✓
Invoice 003  ✗
Invoice 004  ✓
Invoice 005  ✓
```

The run should record Invoice 003 as failed and continue where safe.

Each item should have a state such as:

```
DISCOVERED
IN_PROGRESS
DOWNLOADED
FAILED
RETRY_PENDING
SKIPPED
```

A later retry can target failed items without repeating successful downloads.

---

## 8. Idempotency and Duplicate Prevention

The system should eventually remember which records have already been processed.

Example:

```
Run 1:
Invoice 001–100 → downloaded

Run 2:
Invoice 001–100 → already processed
Invoice 101–105 → new
```

The engine should compare stable item identity where available, such as:

- invoice number;
- document ID;
- record ID;
- stable URL;
- portal-provided identifier;
- controlled fingerprint.

If no reliable identity exists, the system should fall back to artifact/file checks and configurable duplicate rules.

---

## 9. Portal-Agnostic Design

The core engine must remain generic.

### Generic core

- Recorder
- Selector Resolver
- Discovery Engine
- Wait System
- Workflow Engine
- Loop Engine
- Pagination abstraction
- Download Engine
- Run State
- Storage
- Dashboard

### Optional adapters

Some portals/frameworks will require specialized handling:

- Angular Material;
- ExtJS;
- DevExpress;
- React/Vue applications;
- virtualized grids;
- unusual download mechanisms.

The rule is:

> Portal-specific behavior belongs in an adapter/strategy layer where practical, not throughout the core engine.

This prevents the generic engine from becoming a collection of one-off portal hacks.

---

## 10. Authentication

Authentication remains separate from the item-processing workflow.

Supported/target methods include:

- existing authenticated Chrome session;
- username/password;
- OTP/MFA;
- SSO;
- manual verification.

CAPTCHA should pause execution for human intervention rather than attempting to bypass it.

The existing CDP approach is valuable because a user can authenticate in a real browser session and the automation engine can reuse that session.

---

## 11. AI Integration Strategy

AI is a **future assistance layer**, not the foundation of the first MVP.

### Deterministic first

Use deterministic automation for:

- known navigation;
- selectors;
- clicks;
- typing;
- waits;
- loops;
- pagination;
- downloads;
- retries;
- state tracking.

### AI when necessary

Use AI for:

- identifying an unfamiliar document collection;
- finding a replacement element when selectors fail;
- interpreting page structure;
- recovering from unexpected UI changes;
- mapping user intent to a workflow;
- document processing after download.

Conceptually:

```
Deterministic Engine
       ↓
   Step succeeds
       │
       └──────────────→ continue

   Step fails
       ↓
 AI Recovery / Discovery
       ↓
 candidate found?
    /       \
  YES        NO
   ↓          ↓
continue     human
```

Browser Use or a similar agent framework can be evaluated later as an **AI recovery/discovery provider**, without making it a hard dependency of the core engine.

---

## 12. MVP Definition

The first meaningful product milestone is **not** a complete generic RPA platform.

### MVP Goal

Prove this complete loop on a real portal:

> Record how to download one invoice → discover all invoices → download each invoice → handle pagination → track results.

### MVP acceptance criteria

A successful MVP should:

- connect to an authenticated Chrome session;
- record a single invoice-download workflow;
- identify a collection of similar invoices;
- show the number of discovered items;
- allow confirmation;
- execute the item workflow for every item;
- re-query dynamic DOM content;
- handle at least one pagination pattern;
- continue after an item-level failure;
- capture downloaded files;
- associate downloads with items;
- generate a run manifest;
- avoid re-downloading successfully processed items when identity is available.

Only after this works reliably should the project expand into broader portal generalization.

---

## 13. Development Phases

### Phase 1 — Single-item recording/replay
Status: largely implemented.

Goal:

```
Record → Save workflow → Replay
```

### Phase 2 — Collection discovery and item loops
Priority: **next major milestone**

Goal:

```
Record one item
      ↓
Detect collection
      ↓
Confirm N items
      ↓
Process all
```

### Phase 3 — Pagination and dynamic lists

Add:

- Next;
- page numbers;
- Load More;
- infinite scroll;
- DOM re-querying;
- virtualized list handling.

### Phase 4 — Reliable downloads and run state

Add:

- download verification;
- item-level status;
- retry;
- duplicate prevention;
- checkpoint/resume;
- manifests.

### Phase 5 — Multi-portal validation

Test against multiple genuinely different management-company portals.

The objective is to determine which behaviors are truly generic and which require adapters.

### Phase 6 — Production execution

Add:

- headless execution where appropriate;
- isolated browser sessions;
- job queue;
- persistent storage;
- cloud execution;
- scheduling;
- monitoring;
- alerting.

### Phase 7 — AI-assisted recovery

Add:

- semantic discovery;
- selector repair;
- page interpretation;
- recovery from workflow drift.

### Phase 8 — Document AI

Build the downstream pipeline:

```
Downloaded PDF
      ↓
Document classification
      ↓
OCR / text extraction
      ↓
Field extraction
      ↓
Validation
      ↓
Structured database
      ↓
Reports / business actions
```

---

## 14. What We Are Explicitly Not Building First

To keep scope controlled, the first MVP will not attempt to solve:

- every possible website;
- autonomous browsing from natural language;
- CAPTCHA bypass;
- fully autonomous AI agents;
- perfect self-healing;
- every browser/framework;
- enterprise SaaS multi-tenancy;
- complete document intelligence.

The immediate objective is **reliable repeated document acquisition**.

---

## 15. Success Metric

The central technical/business metric is:

> **Can a user demonstrate how to download one record and then reliably automate downloading the entire collection without manually specifying every record?**

A strong proof is:

```
1 manual demonstration
        ↓
N automatically discovered records
        ↓
N automated downloads
        ↓
0 unnecessary manual clicks
        ↓
complete manifest
```

This is the capability that separates Workflow Capture from a basic macro recorder.
