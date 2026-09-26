# Task Assignment Template

Copy this template for each agent assignment.

## Task record

- **Task ID:** `Task [ID]`
- **Goal:** [One clear statement of the intended outcome.]
- **Owner:** [One agent/owner.]
- **Branch:** `[task-specific branch]`
- **Worktree:** `[optional local worktree path]`
- **Dependencies:** [Task IDs, or `None`]
- **Allowed paths:**
  - `[path]`
  - `[path]`
- **Excluded paths:** [Files/directories this task must not edit.]

## Acceptance criteria

- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

## Validation evidence

- **Commands/scenarios run:** [Exact commands or reproducible scenarios.]
- **Result:** [Pass/fail/blocked for each relevant check.]
- **Evidence:** [Relevant output, artifact, log, screenshot, count, or other evidence.]
- **Not run / limitations:** [Explicitly list anything not validated and why.]

## Status

**Status:** `READY`

Use `IN PROGRESS`, `BLOCKED`, or `REVIEW` as appropriate while the task is being worked. Only the integrator may mark the task `INTEGRATION` or `DONE` after reviewing the acceptance criteria and validation evidence.

## Handoff summary

- **Changed files:** [List exact paths.]
- **Commit SHA(s):** [Commit SHA(s).]
- **Acceptance criteria met:** [Summary.]
- **Known risks / limitations:** [Summary or `None`.]
- **Follow-up tasks:** [Task IDs or `None`.]
- **Notes for integrator:** [Anything needed for safe merge/integration.]
