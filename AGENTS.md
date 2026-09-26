# Agent Working Rules

## Branches and worktrees
- Work only on the task-specific branch/worktree assigned to you.
- Start from the agreed baseline and keep `multi-agent` as the integration target.
- Do not merge or push work to `multi-agent` unless you are the integrator.
- Keep behavior changes separate from unrelated refactors.

## File ownership
- Edit only paths explicitly assigned to your task in `docs/MULTI-AGENT-WORK-PLAN.md`.
- Do not edit another task's files concurrently.
- If the task genuinely requires another path, stop and tell the integrator before changing it.
- Treat shared files and status documents as owned resources; avoid opportunistic cleanup.

## Validation evidence
- Validate the acceptance criteria that apply to your task.
- Report the exact commands/scenarios run and their outcomes.
- Distinguish passing checks from checks that were not run, could not run, or were blocked.
- Include relevant logs, counts, screenshots, artifacts, or other reproducible evidence when applicable.

## Handoff
- Return the task ID, status, changed paths, commit SHA(s), validation evidence, and unresolved risks/limitations.
- State any follow-up work or dependency discovered during implementation.
- Do not claim a task is done merely because code was written; acceptance criteria and evidence are required.
- The integrator reviews the handoff and performs integration into `multi-agent`.
