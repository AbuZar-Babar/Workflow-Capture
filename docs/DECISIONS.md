# Workflow Capture — Architectural Decisions

## ADR 001 — Generic Engine + Portal Configuration
Keep browser automation mechanisms generic and represent portal-specific behavior through workflows/configuration or focused adapters.

## ADR 002 — Item Discovery Is Core
Repeated-item discovery is a first-class product capability. The product should be able to generalize a demonstrated item workflow to a discovered collection.

## ADR 003 — Generic Filtering
The current hardcoded portal filter is an intermediate implementation. The target is a reusable filter model over discovered item attributes/content.

## ADR 004 — Structured Artifact Traceability
Use the relationship **Workflow → Run/Timestamp → Item → Artifact** for downloaded outputs.

## ADR 005 — Authentication Deferred
Authentication is not a current product milestone. Core recording, discovery, filtering, execution, and artifact reliability come first.

## ADR 006 — Stabilization Before Speculative Expansion
Prioritize real-portal validation and reliability before cloud-scale infrastructure, scheduling, AI recovery, or other speculative capabilities.

## ADR 007 — Drawflow
Use Drawflow for the visual workflow graph because the dashboard uses Vanilla JavaScript ES modules and does not require a heavy React/Vue graph architecture.

## ADR 008 — Backward-Compatible Workflow Schema
Normalize legacy recorded action data into the current workflow-step representation at the API boundary.
