# Workflow Capture — Architectural Decisions

## ADR 001 — Generic Engine + Portal Configuration
Keep browser automation mechanisms generic and represent portal-specific behavior through workflows/configuration or focused adapters.

## ADR 002 — Item Discovery Is Core
Repeated-item discovery is a first-class product capability. The product should be able to generalize a demonstrated item workflow to a discovered collection.

## ADR 003 — Generic Filtering
Use a reusable filter model over discovered item fields. The integrated v1 evaluator supports one text condition; the approved v2 contract adds multiple conditions, `all`/`any` matching, inclusive date ranges, and an optional attempt limit. See [LOOP-FILTER-REQUIREMENTS.md](LOOP-FILTER-REQUIREMENTS.md) for the normative behavior.

## ADR 004 — Structured Artifact Traceability
Use the relationship **Workflow → Run/Timestamp → Item → Artifact** for downloaded outputs.

## ADR 005 — Separate Dashboard Security from Portal Login
Dashboard local-mode authentication and access control are part of the integrated platform baseline. Portal login remains the user's browser/session responsibility; these are separate concerns.

## ADR 006 — Stabilization Before Speculative Expansion
Prioritize real-portal validation and reliability before cloud-scale infrastructure, scheduling, AI recovery, or other speculative capabilities.

## ADR 007 — Drawflow
Use Drawflow for the visual workflow graph because the dashboard uses Vanilla JavaScript ES modules and does not require a heavy React/Vue graph architecture.

## ADR 008 — Backward-Compatible Workflow Schema
Normalize legacy recorded action data into the current workflow-step representation at the API boundary.

## ADR 009 — One Loop-Start Marker for the Initial Batch Model
A workflow without a loop marker runs once. With one loop-start marker, preceding steps run once and the marked step through the final step repeats for each selected item. The initial model has no separate loop-end marker or post-loop action region.

## ADR 010 — Filter First, Then Apply an Attempt Limit
Filter discovered items first, preserve discovery order, and select the first N matches when a positive limit is configured. Each item consumes one slot when its workflow begins regardless of outcome; retries do not consume another slot. Date ranges use inclusive date-only endpoints.
