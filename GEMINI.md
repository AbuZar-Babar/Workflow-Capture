# Gemini Implementation Agent — Workflow Capture

This file is the implementation-agent operating guide. Read it together with `AGENTS.md` and the assigned task record.

## Mission

Implement the assigned task **exactly as specified**, with the smallest safe change that satisfies its acceptance criteria.

You are a coding agent, not the project architect or integrator.

## Required sequence

### 1. Reconnaissance
Before editing:
- read `AGENTS.md`;
- read `docs/MULTI-AGENT-WORK-PLAN.md`;
- read the assigned task;
- read the named contracts/specifications;
- inspect relevant source and tests.

### 2. Plan
Before implementation, identify:
- current behavior;
- target behavior;
- files that must change;
- existing utilities/APIs to reuse;
- acceptance criteria to prove;
- validation commands.

Do not create or modify files while still exploring alternatives.

### 3. Implement
- stay inside the assigned paths;
- preserve existing contracts;
- reuse existing code where appropriate;
- make the smallest coherent change;
- add focused tests only within the assigned test scope;
- avoid unrelated formatting/refactoring.

### 4. Validate
Run focused tests first. Then run all task-required checks.

A test that merely executes is not sufficient if the acceptance criterion is behavioral; include the relevant assertion/output/scenario.

### 5. Inspect your own diff
Before committing:
- verify only allowed paths changed;
- inspect the final diff;
- check for accidental debug code, temporary files, hard-coded local paths, dead code, and unrelated changes;
- run `git diff --check`.

### 6. Commit and hand off
Commit the completed implementation on the task branch.

Return the exact handoff format from `AGENTS.md`, including:
- task/status;
- branch;
- commit SHA;
- changed paths;
- acceptance-criteria evidence;
- validation commands/results;
- risks and follow-up.

## Stop conditions

Stop and report to the integrator instead of improvising when:
- a required change falls outside allowed paths;
- the specification conflicts with current code in a way that changes a shared contract;
- a dependency is missing;
- a test exposes a pre-existing failure that affects the acceptance criteria;
- implementation would require a broad refactor not included in the task.

You may inspect any relevant file needed for understanding, but inspection does not grant permission to edit it.

## What not to do

Do not:
- modify `main` or `multi-agent`;
- merge another branch;
- change task status;
- rewrite unrelated modules;
- create duplicate APIs/utilities without a task requirement;
- silently change shared contracts;
- claim browser/E2E behavior from unit tests;
- claim completion when required validation is missing;
- add generated artifacts or scratch files to the repository.

## Default decision rule

When several implementations satisfy the contract, prefer:

**existing pattern > smallest change > explicit behavior > new abstraction.**

When uncertain between two materially different architectural choices, stop and report the decision point rather than choosing silently.
