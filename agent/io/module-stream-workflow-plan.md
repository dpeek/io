# Managed Module Stream Workflow Plan

Status: Current-approach contract after the first end-to-end proof pass.

## Purpose

Keep the next managed-stream change narrow: use parent stream state to separate
backlog grooming, human review, and child execution while keeping Linear as the
canonical evolving brief.

## Stable Contract Sources

- label and parent ownership contract:
  [`./managed-stream-goals.md`](./managed-stream-goals.md)
- parent brief and child backlog shape:
  [`./managed-stream-backlog.md`](./managed-stream-backlog.md)
- `@io` comment trigger model:
  [`./managed-stream-comments.md`](./managed-stream-comments.md)
- branch, worktree, and landing lifecycle:
  [`../doc/stream-workflow.md`](../doc/stream-workflow.md)

## Current Runtime Baseline

- managed parent identity already uses `io` plus exactly one configured module
  label
- `@io` comments already refresh the managed brief, focus doc, and speculative
  `Todo` children
- tracker candidate polling still uses `activeStates = ["Todo", "In Progress"]`
- managed parent comment polling also includes `In Review` so explicit
  `@io backlog`, `@io focus`, `@io status`, and `@io help` remain available
  during the human review hold
- child candidates carry parent stream state, so execution can distinguish
  stream phase from child readiness
- the service respects child `blockedBy` edges, keeps one active child per
  parent stream, and only auto-runs children whose parent is `In Progress`
- managed parents keep the backlog profile for explicit runs and `@io`
  commands, but automatic backlog scheduling stops once the parent leaves
  `Todo`
- successful parent backlog runs move the parent to `In Review`; successful
  child runs move the child to `Done`
- workspace runtime state is split into flat child worktrees under `tree/`,
  per-issue runtime state under `issue/`, and per-parent stream state under
  `stream/`

## Current Approach Linear Contract

### Parent stream phases

- parent `Todo`: explicit backlog-authoring state; use it only when a human
  wants another backlog pass before execution resumes
- parent `In Review`: safe bootstrap and post-backlog holding state; new
  streams start here so humans can edit and approve the parent brief without
  releasing child execution
- parent `In Progress`: execution-released state; unblocked child issues may
  run when they are ready for implementation
- parent `Done`: stream-complete state; no new backlog or execution work should
  be scheduled automatically

### Child role and bootstrap

- child issues are implementation steps only in this first pass; planning,
  review, and approval stay on the parent issue
- safe bootstrap seeds the parent in `In Review` and seeds all new child issues
  in `Todo`
- seeded `Todo` children stay parked because the parent gate only releases
  execution once the stream moves to `In Progress`
- moving the parent to `In Progress` is a human approval step; it does not
  imply a child state transition
- child readiness still respects `blockedBy` and one active child per stream
- the first pass keeps the current 2-level parent/child model; it does not
  add a separate planning tier beneath the parent

## Proof Surface

- parent stream phase is visible on child candidates:
  `agent/src/types.ts`, `agent/src/tracker/linear.ts`,
  `agent/src/service.test.ts`
- automatic scheduling is phase-gated:
  `agent/src/service.ts`, `agent/src/service.test.ts`
- explicit backlog/context routing stays available on managed parents:
  `agent/src/issue-routing.ts`, `agent/src/workflow.test.ts`
- parent and child transitions stay separate:
  `agent/src/service.ts`, `agent/src/service.test.ts`,
  `agent/src/workspace.ts`, `agent/src/workspace.test.ts`
- current repo docs summarize the contract tersely:
  `io/goals.md`, `agent/io/managed-stream-backlog.md`,
  `agent/io/module-stream-workflow-plan.md`

## Explicit Follow-ups

- Decide whether mutating `@io backlog` and `@io focus` commands should stay
  available after a parent stream reaches `Done`.

## Out Of Scope For This Slice

- 3-level stream/planning/implementation hierarchy
- changing child payload shape beyond what parent-phase gating requires
- reworking stream branch or worktree lifecycle beyond the current
  parent-branch model
- parallel child execution inside a single stream

## Done Means

- parent phase is visible on child candidates
- parent `Todo`, `In Review`, `In Progress`, and `Done` have explicit stream
  meanings
- new streams bootstrap with parent `In Review` and children in `Todo`
- only children of parent `In Progress` streams auto-run
- managed parents do not auto-run backlog after they leave `Todo`
- docs and tests match the documented current approach contract
