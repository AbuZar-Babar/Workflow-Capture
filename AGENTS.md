# Workflow Capture — Agent Operating Rules

This repository uses a **planner → implementer → reviewer → integrator** workflow.

## 1. Agent roles

### ChatGPT — Head Agent / Orchestrator
ChatGPT owns:
- repository reconnaissance and architecture mapping;
- task decomposition and dependency planning;
- task assignment and implementation prompts;
- cross-task contract consistency;
- review of diffs, tests, and evidence;
- integration into `multi-agent`;
- repository hygiene and documentation alignment;
- final task status decisions.

ChatGPT does **not** use Gemini's implementation work as proof of correctness without review.

### Gemini — Coding / Implementation Agent
Gemini owns:
- implementing the assigned task;
- writing or updating tests within the assigned scope;
- running required validation;
- committing the implementation branch;
- reporting reproducible evidence and risks.

Gemini does **not** own architecture changes outside the task, integration, task-status promotion, or unrelated cleanup.

### Human / Project Owner
The project owner decides product priorities and approves consequential scope or architectural changes.

## 2. Repository branch model

- `main` — stable/default branch. **Never code directly here for active work.**
- `multi-agent` — integration branch. Only the integrator updates it through reviewed integration.
- `chatgpt/*` — orchestration, documentation, review, or integration-support branches.
- `gemini/*` — implementation branches assigned to Gemini.
- Every implementation branch must start from the exact agreed `multi-agent` baseline unless the integrator explicitly says otherwise.

Do not merge, rebase, or push another agent's branch unless you are the integrator.

## 3. Read before editing

Before making changes, read:
1. `AGENTS.md`;
2. `docs/MULTI-AGENT-WORK-PLAN.md`;
3. the assigned task record;
4. every contract/spec document named by that task;
5. the relevant existing source and tests.

Do not infer a new contract when an existing contract already defines the behavior.

## 4. Task scope is a hard boundary

Each task has:
- one owner;
- explicit allowed paths;
- explicit dependencies;
- acceptance criteria;
- validation requirements.

**Edit only the assigned paths.**

Do not:
- opportunistically refactor unrelated code;
- rename files/modules for convenience;
- rewrite working code because a different architecture is preferred;
- modify another task's files;
- update status/docs unless those paths are explicitly assigned;
- change shared contracts inside an implementation task.

If an additional file is genuinely required:
1. stop before editing it;
2. explain why it is required;
3. tell the integrator which path and why;
4. wait for the scope decision.

## 5. Implementation discipline

Before coding, establish:
- the existing behavior;
- the exact input/output contract;
- the smallest change that satisfies the acceptance criteria;
- dependencies and integration points.

Prefer:
- existing utilities over duplicate helpers;
- existing APIs/contracts over parallel interfaces;
- small, local changes over broad rewrites;
- backward compatibility where the task requires it;
- deterministic behavior and explicit error handling.

Do not introduce a new abstraction merely to make the implementation look cleaner.

## 6. No silent architecture changes

An implementation task must not silently:
- change API shapes;
- change persisted data formats;
- alter shared evaluator semantics;
- change status names;
- change authentication/security policy;
- change product behavior outside its acceptance criteria.

If the task cannot be implemented correctly without such a change, report the conflict to the integrator instead of making the change silently.

## 7. Validation is part of implementation

Run the most relevant focused checks first, then the task's required validation.

For every check report:
- exact command or reproducible scenario;
- pass/fail/blocked result;
- useful output or evidence;
- anything not tested and why.

Do not turn a failed, skipped, or unavailable check into a passing claim.

Use `git diff --check` when the task changes text/source files.

Browser/E2E validation is required only when the task or acceptance criteria require it; do not claim browser behavior from unit tests alone.

## 8. Handoff contract

When implementation is complete, report exactly:

```text
Task: Task <ID>
Status: IMPLEMENTED | REVIEW | BLOCKED
Branch: <branch>
Commit: <SHA>

Changed paths:
- <path>

Acceptance criteria:
- PASS: <criterion>
- PASS: <criterion>
- NOT VALIDATED: <criterion>

Validation:
- <command/scenario> — PASS/FAIL/BLOCKED
- <command/scenario> — PASS/FAIL/BLOCKED

Evidence:
- <concise reproducible evidence>

Risks / limitations:
- <item or None>

Follow-up:
- <task/dependency or None>
```

Do not claim `DONE`, `INTEGRATED`, or `RELEASE-VALIDATED`.

## 9. Completion semantics

Use these meanings consistently:

- **IMPLEMENTED** — code exists on the agent branch.
- **REVIEW** — implementation is ready for integrator inspection.
- **VALIDATED** — acceptance criteria have been checked with sufficient evidence.
- **INTEGRATION** — integrator has accepted the change for merge/integration.
- **DONE** — integrator confirms integration and required validation.
- **RELEASE-VALIDATED** — the combined product journey and required release gates have passed.

Only the integrator may mark a task `INTEGRATION` or `DONE`.

## 10. Review feedback loop

If review finds a defect:
1. ChatGPT identifies the exact defect and affected requirement.
2. ChatGPT sends Gemini a narrow correction task.
3. Gemini changes only the permitted scope.
4. Gemini returns a new commit and validation evidence.
5. ChatGPT re-reviews the corrected diff.

Do not restart or redesign an otherwise valid task because of one localized defect.

## 11. Documentation and repository hygiene

Documentation is part of the product contract.

- No document should describe behavior the code does not implement.
- No implemented core behavior should remain undocumented when it affects the product contract.
- Do not create temporary reports, generated artifacts, screenshots, logs, or scratch files in tracked paths unless the task explicitly requires them.
- Keep status documents factual and evidence-based.
- Historical status must remain distinguishable from current status.

## 12. Integration rule

The integrator is the only role that:
- reviews the completed handoff;
- checks branch/diff scope;
- verifies cross-task compatibility;
- merges into `multi-agent`;
- records integration evidence;
- promotes the task to `INTEGRATION` / `DONE`.

A green agent report is evidence, **not automatic approval**.
