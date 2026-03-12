# Stream Workflow For Linear Parent Issues

Status: Current-approach runtime contract for the first managed-stream pass.

Use this doc for the branch, worktree, runtime-state, and finalization behavior
that exists today. Use
[`../io/module-stream-workflow-plan.md`](../io/module-stream-workflow-plan.md)
for the higher-level managed-stream contract that defines parent phases,
backlog behavior, and the current 2-level parent/child model.

## Purpose

The current runtime treats one parent Linear issue as one stream:

- the parent issue owns the long-lived stream branch
- child issues are implementation steps that land onto that same branch
- parent issue phase gates backlog work vs child execution
- child and parent finalization stay separate so finished child work can be
  cleaned up before the parent stream merges to `main`

## Current Approach

### Parent stream phases

- parent `Todo`: explicit backlog-authoring state; this is the only state where
  a managed parent is auto-scheduled for backlog work
- parent `In Review`: safe bootstrap and post-backlog holding state; new
  streams wait here while humans edit and approve the parent brief
- parent `In Progress`: execution-released state; unblocked child issues may
  run automatically
- parent `Done`: stream-complete state; the runtime may finalize the parent
  stream once its branch is on `main`

### Child issue role

- child issues are implementation steps only in this first pass
- new child issues are seeded in `Todo`
- seeded `Todo` children stay parked until the parent moves to `In Progress`
- child readiness still respects `blockedBy` ordering and one active child per
  stream
- successful child runs land on the parent stream branch and transition the
  child to `Done`
- child transitions do not change the parent issue state

## Branches And Worktrees

### Stream branch ownership

- branch identity comes from the parent issue identifier
- the current branch format is `io/<parent-key>`
- parent backlog runs and child execution runs both use that same stream branch

Examples:

- parent `OPE-147` -> branch `io/ope-147`
- child `OPE-152` under parent `OPE-147` also runs on `io/ope-147`

### Worktree layout

The runtime keeps worktrees flat under the configured workspace root. The
current implementation does not nest child worktrees under a parent directory.

If the workspace root is `.io/`, the runtime layout looks like:

- `.io/tree/ope-147/`
- `.io/tree/ope-152/`
- `.io/issue/ope-147/issue-state.json`
- `.io/issue/ope-152/issue-state.json`
- `.io/stream/ope-147.json`
- `.io/workers/<worker-id>/worker-state.json`

Rules:

- worktree paths are keyed by the current issue identifier
- issue runtime state is keyed per issue under `issue/<issue>/`
- stream runtime state is keyed per parent under `stream/<parent>.json`
- `worktreeRoot` in stream state points at the shared flat `tree/` directory

## Runtime State

### Stream runtime state

`stream/<parent>.json` records the current stream-level state:

- `parentIssueId`
- `parentIssueIdentifier`
- `branchName`
- `activeIssueId`
- `activeIssueIdentifier`
- `latestLandedCommitSha`
- `status`
- `worktreeRoot`
- `createdAt`
- `updatedAt`

Current meaning:

- `status: "active"` means the stream still owns a live branch, even if no
  child is currently active
- `status: "completed"` is reserved for the parent stream after it has been
  finalized against `main`

### Issue runtime state

`issue/<issue>/issue-state.json` records per-run issue state:

- `issueId`
- `issueIdentifier`
- `parentIssueId`
- `parentIssueIdentifier`
- `streamIssueId`
- `streamIssueIdentifier`
- `branchName`
- `commitSha`
- `landedCommitSha`
- `landedAt`
- `finalizedAt`
- `finalizedLinearState`
- `status`
- `worktreePath`

For child issues, `branchName` points at the parent stream branch rather than a
child-only branch.

## Scheduling And Transitions

### Automatic scheduling

- managed parents still route to the backlog profile for explicit runs
- automatic backlog scheduling for a managed parent stops once the parent
  leaves `Todo`
- managed parent comment polling also includes `In Review` so top-level
  `@io backlog`, `@io focus`, `@io status`, and `@io help` stay available
  during the review hold
- child auto-scheduling requires:
  - a parent in `In Progress`
  - no unresolved `blockedBy` issues
  - no other active issue in the same stream

### Successful state transitions

- parent backlog run:
  - service moves the parent to `In Progress` while the run is active
  - success returns the parent to `In Review`
- child execution run:
  - service moves the child to `In Progress` while the run is active
  - success moves the child to `Done`

This keeps backlog and execution transitions separate. Moving the parent to
`In Progress` releases execution, but it does not mutate child states.

## Finalization Semantics

### Child finalization

When a child reaches a terminal Linear state:

- the runtime first verifies that the child commit is reachable from the stream
  branch
- if the commit has landed, the child worktree can be removed
- the child issue runtime state is marked `finalized`
- the stream runtime stays `active`
- the stream branch is preserved

This means child cleanup depends on stream-branch landing, not on `main`.

### Parent finalization

When the parent reaches a terminal Linear state:

- if the parent is `Done`, the runtime merges the stream branch to `main`
- the parent worktree is kept until the stream branch is confirmed on `main`
- once landed, the parent worktree is removed
- the local stream branch may be deleted
- the stream runtime state moves to `completed`

This keeps parent cleanup separate from child cleanup.

## Proof Surfaces

- runtime routing and parent-phase gating:
  `agent/src/issue-routing.ts`, `agent/src/service.ts`,
  `agent/src/service.test.ts`
- parent stream metadata on child candidates:
  `agent/src/tracker/linear.ts`, `agent/src/types.ts`,
  `agent/src/service.test.ts`
- branch, runtime-state, and finalization behavior:
  `agent/src/workspace.ts`, `agent/src/workspace.test.ts`

## Out Of Scope

- a 3-level stream/planning/implementation hierarchy
- nesting child worktrees under `.io/streams/<parent>/<child>/`
- automatic PR creation or merge automation beyond the current parent merge
- redesigning managed comment commands beyond the current contract
