# Stream Workflow For Linear Parent Issues

## Purpose

This document proposes a stream-based execution model for `io` where:

- a parent Linear issue represents a larger stream of work
- child Linear issues represent ordered execution units under that parent
- all child work lands onto a single long-lived stream branch owned by the parent
- child worktrees are easy to find locally and are cleaned up as soon as the child lands

This model is optimized for accumulating a larger diff over time without forcing every issue to merge back to `main` before the next issue can continue.

## Goals

- Enforce dependency order within a parent stream.
- Let a parent issue own a long-lived branch.
- Keep child execution scoped to dedicated worktrees.
- Clean up child worktrees promptly once their work has landed on the stream branch.
- Make active worktrees easy to browse directly from the repo root.
- Preserve the existing `backlog` and `execute` agent split.

## Non-goals

- Maximizing parallelism within a single stream.
- Allowing multiple child issues in the same stream to land concurrently.
- Replacing Linear as the source of truth for issue hierarchy and dependency order.

## Current Behavior

Today the runtime is issue-branch oriented:

- branch names are derived from the current issue identifier
- worktrees live under the runtime root in `worktrees/<issue-branch>`
- issue cleanup waits until the issue commit has landed on `main`
- the scheduler already respects `blockedBy`, so only unblocked issues are considered runnable

This works well for independent issue branches, but it is the wrong lifecycle for long-lived stream branches.

## Proposed Model

### Core concepts

- `stream issue`
  - a parent Linear issue
  - owns the long-lived branch
  - owns the stream workspace folder

- `child issue`
  - a Linear issue with `parentId = <stream issue>`
  - may declare dependencies through `blockedBy`
  - runs in its own dedicated worktree
  - lands onto the parent stream branch instead of `main`

- `stream branch`
  - one branch per parent issue
  - receives landed commits from all completed child issues
  - remains alive until the parent issue is complete

### Operational rule

Within a stream:

- schedule only child issues with no unmet dependencies
- default to one active child issue at a time
- land child work onto the stream branch
- remove the child worktree immediately after the child is safely landed

Across streams:

- multiple streams may run in parallel

This yields:

- serialized execution within a stream
- parallel execution across streams

## Branching

### Branch ownership

Branch identity should move from the child issue to the parent issue.

Recommended branch format:

- `stream/ope-12`

Acceptable shorter format:

- `ope-12`

The important property is that the branch name is stable for the full lifetime of the parent stream.

### Child landing

Each child issue should:

1. start from the current head of the parent stream branch
2. make its changes in a dedicated child worktree
3. commit with the child issue identifier in the message
4. update the parent stream branch to include that commit
5. mark the child issue as landed

The system should not treat child completion as a merge to `main`.

## Worktree Layout

The current runtime-managed worktree paths are too hidden for day-to-day use.

Recommended repo-local layout:

- `.io/streams/OPE-12/stream-state.json`
- `.io/streams/OPE-12/branch.txt`
- `.io/streams/OPE-12/OPE-13/`
- `.io/streams/OPE-12/OPE-14/`

Why this layout:

- easy to inspect from the repo root
- groups all child work under the parent stream
- gives the runtime a natural place for durable stream metadata
- makes stream cleanup simple when the parent is finished

If a less hidden path is preferred later, the same structure can move under `io/streams/`, but `.io/streams/` is a safer default because it is clearly runtime-owned and should be ignored by git.

## Lifecycle

### 1. Stream creation

When a parent issue is selected for backlog work:

- create or resolve the parent stream branch
- create `.io/streams/<parent>/`
- write a `stream-state.json` file
- optionally add a Linear comment with the stream branch name and local path

### 2. Backlog planning

The backlog agent should:

- read the parent issue
- create child issues under the parent via `parentId`
- add `blockedBy` edges for ordering
- leave enough structure in the issue descriptions for execution

The backlog agent should be able to run again later, but it should avoid destructive rewrites of already-executing child issues.

### 3. Child execution

When a child issue is scheduled:

- resolve its parent stream
- ensure the stream branch exists locally
- create or reuse `.io/streams/<parent>/<child>/`
- check out the stream branch in that worktree
- run the child issue there

The worktree is child-scoped, but the branch is stream-scoped.

### 4. Child completion

When a child completes successfully:

- commit the child work
- confirm the landed commit is reachable from the stream branch head
- record the landed commit SHA in child runtime state
- mark the child as completed in runtime state

### 5. Child finalization

When the child is marked done in Linear and its commit is on the stream branch:

- run `beforeRemove` if configured
- remove `.io/streams/<parent>/<child>/`
- keep the child runtime record with `finalizedAt`
- do not delete the stream branch
- do not require the parent stream to be merged to `main`

### 6. Parent completion

When the parent stream is done:

- merge the stream branch to `main`
- clean up the stream folder if no active children remain
- optionally delete the stream branch

## Cleanup Semantics

This is the key lifecycle change.

### Current cleanup rule

- preserve the issue worktree until the issue branch has landed on `main`

### Proposed cleanup rule

- preserve the child worktree until the child commit has landed on the parent stream branch

This means child worktrees disappear much earlier, while the parent stream remains active.

## Scheduler Rules

### Candidate selection

The scheduler should continue to use dependency order:

- ignore blocked child issues
- prefer the next unblocked child in a stream
- do not schedule a child if another child in the same stream is currently running

### Parent issue handling

A parent issue with no children or with a planning label can still route to the `backlog` agent.

A parent issue with child issues already created should not route to `execute` directly unless explicitly requested.

### Stream-level concurrency

The default stream policy should be:

- `max active child runs per stream = 1`

The global scheduler can still allow:

- `max concurrent streams > 1`

## Runtime State

The current issue runtime state should gain a stream-level layer.

### Stream state

Recommended file:

- `.io/streams/<parent>/stream-state.json`

Suggested fields:

- `parentIssueId`
- `parentIssueIdentifier`
- `branchName`
- `status`
- `activeChildIssueId`
- `activeChildIssueIdentifier`
- `latestLandedCommitSha`
- `worktreeRoot`
- `createdAt`
- `updatedAt`

### Child issue state

The existing issue runtime state should gain:

- `parentIssueId`
- `parentIssueIdentifier`
- `streamBranchName`
- `streamPath`
- `landedCommitSha`
- `landedAt`

The existing `branchName` field should refer to the stream branch for child issues rather than a child-specific branch.

## Linear Behavior

### Parent issue

The parent issue should be the stream container:

- owns the thematic goal
- owns the long-lived branch
- remains open while child issues are executed

Suggested labels:

- `stream`
- `planning`

### Child issues

Child issues should:

- have `parentId` set to the parent issue
- use `blockedBy` for execution order
- carry execution-specific acceptance criteria

### Comments

Useful automatic comments:

- stream branch created
- child issue landed on stream branch at `<sha>`
- child worktree finalized and removed
- parent stream ready to merge to `main`

## Code Changes

### `agent/src/tracker/linear.ts`

Add enough issue metadata to reason about parent streams directly:

- include parent identifiers, not just `hasParent`
- optionally include parent issue details when normalizing issues
- keep existing dependency handling based on blocking relations

This makes it possible to resolve the stream owner without extra fetches during scheduling.

### `agent/src/types.ts`

Extend runtime types to include:

- stream-level metadata on `AgentIssue`
- a new `StreamRuntimeState`
- child issue runtime fields for parent and stream linkage

### `agent/src/service.ts`

Update scheduling rules:

- group child issues by parent stream
- pick only one runnable child per stream
- keep the existing unblocked-first behavior
- route parent planning issues to `backlog`
- route child execution issues to `execute`

### `agent/src/workspace.ts`

This file will need the largest semantic change.

Replace:

- issue branch creation
- issue worktree under the runtime root
- cleanup on merge to `main`

With:

- stream branch resolution from the parent issue
- child worktree creation under `.io/streams/<parent>/<child>/`
- child finalization after landing on the stream branch
- parent stream cleanup only after the parent completes

The current finalize path should be split into:

- child finalization against the stream branch
- parent stream finalization against `main`

## Migration Strategy

### Phase 1

Introduce the stream model but keep execution serialized everywhere:

- one active child globally
- child worktrees under `.io/streams`
- cleanup on landing to stream branch

This validates the lifecycle changes with minimal scheduler complexity.

### Phase 2

Allow multiple streams to execute in parallel:

- one active child per stream
- multiple parent streams across the repo

### Phase 3

Add richer backlog automation:

- parent issue expansion into children
- dependency graph refinement
- automatic parent progress summaries

## Open Questions

- Should the parent branch be `stream/<identifier>` or just `<identifier>`?
- Should `.io/streams/` live inside the repo, or should it be a sibling directory with a repo-local symlink?
- Should a child move to `Done` automatically when landed, or stop at `In Review` until a human approves the stream diff?
- Should parent streams auto-open a PR against `main`, or only do so when all child issues are complete?

## Recommendation

Implement the stream model with these defaults:

- one parent Linear issue equals one stream
- one stream branch per parent
- one active child at a time per stream
- child worktrees under `.io/streams/<parent>/<child>/`
- child cleanup when landed on the stream branch
- parent cleanup only when the full stream merges to `main`

This best matches the desired operating model: ordered, low-conflict accumulation on a long-lived issue branch with accessible local worktrees and prompt cleanup of finished child work.
