# Task Assignment Template

Use this template when assigning an implementation task to Gemini or another coding agent.

## Task record

- **Task ID:** `Task [ID]`
- **Title:** [Short action-oriented title.]
- **Goal:** [One clear statement of the intended user-visible/system outcome.]
- **Owner:** [One agent/owner.]
- **Role:** `IMPLEMENTER` / `REVIEWER` / `OTHER`
- **Branch:** `[task-specific branch]`
- **Baseline:** `[exact multi-agent commit SHA]`
- **Worktree:** `[optional local worktree path]`
- **Dependencies:** [Task IDs, or `None`]
- **Contract/specs to read:** [Exact docs/files.]
- **Allowed paths:**
  - `[path]`
- **Excluded paths:**
  - `[path]`

## Context

### Current behavior
[What exists today. Do not describe intended behavior as if it already exists.]

### Required change
[What the implementation must accomplish.]

### Integration points
[Existing APIs/modules/contracts this task must preserve or consume.]

### Non-goals
- [Explicitly out of scope.]
- [Explicitly out of scope.]

## Acceptance criteria

- [ ] [Objective criterion.]
- [ ] [Objective criterion.]
- [ ] [Objective criterion.]

## Edge cases

- [Case and expected behavior.]
- [Case and expected behavior.]

## Implementation constraints

- Preserve existing contracts unless this task explicitly changes them.
- Prefer existing utilities and patterns.
- Do not refactor unrelated code.
- Do not modify files outside the allowed paths.
- If an allowed path is insufficient, stop and report the required scope expansion before editing.

## Validation evidence

- **Focused checks:** [Exact commands/scenarios.]
- **Required checks:** [Exact commands/scenarios.]
- **Result:** [PASS / FAIL / BLOCKED for each.]
- **Evidence:** [Relevant output, artifact, count, screenshot, or reproducible observation.]
- **Not run / limitations:** [Explicitly list anything not validated and why.]

## Handoff

Return:

- **Status:** `IMPLEMENTED` / `REVIEW` / `BLOCKED`
- **Changed paths:** [Exact list.]
- **Commit SHA:** [SHA.]
- **Acceptance criteria:** [PASS / NOT VALIDATED per criterion.]
- **Validation:** [Exact results.]
- **Risks / limitations:** [Or `None`.]
- **Follow-up:** [Task IDs or `None`.]
- **Notes for integrator:** [Anything required for safe integration.]

Do not mark the task `DONE` or `INTEGRATED`. The integrator owns those states.
