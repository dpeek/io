# Managed Module Stream Workflow Plan

Status: Active implementation plan for the current-approach slice.

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
- the service already respects child `blockedBy` edges and one active child per
  parent stream
- managed parents still fall back to backlog regardless of parent state
- child candidates do not currently expose parent state, so execution cannot
  yet be gated on the parent stream phase
- successful parent backlog runs move the parent to `In Review`; successful
  child runs move the child to `Done`

## Current Approach Phase Contract

- parent `Todo`: backlog grooming is eligible
- parent `In Review`: human review and editing pause; no automatic backlog or
  child execution
- parent `In Progress`: child execution is eligible when the child is unblocked
- child readiness still respects `blockedBy` and one active child per stream
- the first pass keeps the current 2-level parent/child model; it does not
  require a separate planning tier

## Planned Slices

1. **Expose parent stream phase on child candidates**
   Outcome: `AgentIssue` carries parent state for child issues.
   Proof surfaces: `agent/src/types.ts`, `agent/src/tracker/linear.ts`, tracker
   normalization tests.
   Notes: extend the candidate query to request `parent { state { name } }`
   instead of adding a second fetch pass.
2. **Gate automatic routing and scheduling by phase**
   Outcome: managed parents only auto-route to backlog in `Todo`, and children
   only auto-schedule when their parent is `In Progress`.
   Proof surfaces: `agent/src/issue-routing.ts`, `agent/src/service.ts`,
   `agent/src/service.test.ts`.
   Notes: keep standalone issue behavior unchanged and preserve one active
   child per stream.
3. **Separate backlog and execution transitions**
   Outcome: parent backlog success continues to move the parent to `In Review`,
   child success continues to move the child to `Done`, and parent
   `In Progress` is never implied by backlog success.
   Proof surfaces: `agent/src/service.ts`, `agent/src/service.test.ts`.
   Notes: keep parent phase changes human-driven for this slice.
4. **Refresh docs and focused coverage**
   Outcome: repo docs describe the phase contract and tests prove
   `Todo`/`In Review`/`In Progress` behavior.
   Proof surfaces: `io/goals.md`, `agent/io/module-stream-workflow-plan.md`,
   `agent/src/service.test.ts`, `agent/src/workflow.test.ts`.
   Notes: keep docs concise and update only the surfaces that summarize the
   current contract.

## Explicit Follow-ups

- Decide whether mutating `@io backlog` and `@io focus` commands should also be
  phase-gated or remain explicit operator overrides.
- Revisit `activeStates` only if `In Review` needs comment-trigger processing or
  other supervised automation.

## Out Of Scope For This Slice

- 3-level stream/planning/implementation hierarchy
- changing child payload shape beyond what parent-phase gating requires
- reworking stream branch or worktree lifecycle beyond the current
  parent-branch model
- parallel child execution inside a single stream

## Done Means

- parent phase is visible on child candidates
- parent `Todo`, `In Review`, and `In Progress` lead to distinct scheduling
  behavior
- only children of parent `In Progress` streams auto-run
- managed parents do not auto-run backlog after they leave `Todo`
- docs and tests match the shipped current approach
