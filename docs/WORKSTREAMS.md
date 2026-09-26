# Workflow Capture — Agent Workstreams

**Integration branch:** `multi-agent`
**Integration owner:** **AbuZar-Babar — project owner / integrator**
**Source of truth:** `docs/MULTI-AGENT-WORK-PLAN.md`

Status reflects integration progress as of 2026-09-26. `READY` means the task may be assigned now; `BLOCKED` means one or more task dependencies must be integrated first.

> **Status authority:** Only the integration owner/integrator may move a task to `INTEGRATION` or `DONE`, and only after reviewing the owner's validation evidence and acceptance criteria.

| Task | Dependencies | Current status |
|---|---|---|
| Task 0 — Establish the agent workboard | None | DONE |
| Task 1 — Secure dashboard local mode | None | DONE |
| Task 2 — Stabilize repeated-item execution | None | DONE |
| Task 3 — Isolate browser-backed tests | None | DONE |
| Task 4 — Implement a reusable filter evaluator | None; shared filter contract must be frozen | DONE |
| Task 5 — Unify discovery, review, filtering, and execution UI | Shared filter contract; coordinate with Task 6 response contract | DONE |
| Task 6 — Integrate generic filters in API and runtime | Tasks 1, 2, 4; Task 5 may proceed in parallel | READY |
| Task 7 — Make test suites complete and discoverable | Tasks 3, 4, 6 | BLOCKED |
| Task 8 — Reconcile project status and technical docs | Tasks 1–7 | BLOCKED |
| Task 9 — Cross-portal and end-to-end validation | Tasks 1–8 | BLOCKED |
| Task 10 — Dashboard lifecycle correctness | Task 5 | READY |
| Task 11 — Modularize large modules (deferred) | Tasks 1–10; stable behavior baseline | BLOCKED |

## Ownership and integration rules

- Each task has one owner and must stay within its allowed paths from the work plan.
- Agents use separate branches/worktrees from the agreed baseline.
- Agents hand back commits, changed paths, validation evidence, and unresolved risks.
- The integrator reviews dependency order, file scope, compatibility, and acceptance evidence before merging into `multi-agent`.
- A task must not be marked `INTEGRATION` or `DONE` by its task owner. Those statuses are reserved for the integrator after evidence review.
- Suggested lifecycle is `READY` → `IN PROGRESS` → `REVIEW` → `INTEGRATION` → `DONE`; use `BLOCKED` when a dependency prevents progress.
