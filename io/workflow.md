# Stream Feature Task Workflow

## Status

This is the primary user-facing contract for the current `io` Linear workflow.
It defines the preferred `Stream -> Feature -> Task` shape and the current
automation boundary. When runtime behavior is still being tightened, the gap is
called out explicitly below.

## Issue Model

- `Stream`: long-lived workstream. Owns the overall outcome, roadmap,
  sequencing, and stream-level release decision.
- `Feature`: integration-sized slice inside a stream. Owns a concrete delivery
  scope and the branch that its task commits accumulate on.
- `Task`: one execution session under exactly one feature. Owns a narrow
  implementation step that should complete in one supervised run.

## Entry Points

- `./backlog.md`: interactive backlog editing flow for stream descriptions and
  child issue structure.
- `./overview.md`: repo map and workflow navigation.
- `../agent/io/overview.md`: agent package map for scheduling, routing, and
  runtime files.
- `../agent/io/module-stream-workflow-plan.md`: implementation notes for
  workflow loading, routing, and context assembly.

## Ownership

Humans own:

- stream descriptions, feature descriptions, priorities, sequencing, and
  acceptance
- moving stream and feature issues between planning, release, and terminal
  states
- deciding when a feature is ready to finalize and when a stream is ready to
  land

The agent/runtime owns:

- selecting released leaf issues for execution
- moving runnable tasks from `Todo` to `In Progress` when execution starts
- committing successful task work and landing that commit on the parent feature
  branch
- marking successful tasks `Done`
- preserving blocked or interrupted task worktrees and runtime state instead of
  discarding them

## State Contract

- Planning states such as `Backlog` or `Todo` remain user-owned. Nothing is
  execution-released until the relevant parent issue is `In Progress`.
- A task under a feature only becomes runnable when both the feature and the
  stream are `In Progress`.
- The supervisor only picks released leaf issues. In the preferred workflow,
  that means tasks.
- A successful task run lands its commit and moves the task to `Done`
  automatically.
- Successful top-level backlog-style runs still move the top-level issue to `In
  Review`; that is retained compatibility behavior, not the preferred execution
  path for this workflow.

## Branch And Finalization Contract

- Each runnable task gets its own detached worktree, but its commit lands on the
  immediate parent branch.
- In the preferred workflow, that immediate parent is the feature, so
  successful task runs accumulate on `io/<feature-issue-key>`.
- Parallel feature work is allowed inside one stream. The current scheduler only
  serializes work within the same feature branch.
- Target feature completion behavior: when a feature moves to `Done`, the
  feature branch should be squashed, rebased onto the stream branch, and merged
  back into the stream.
- Target stream completion behavior: once the stream branch contains the
  accepted feature work, it should land on `main`.

## Current Gaps And Compatibility Notes

- The scheduler still treats any released leaf issue as runnable. A feature with
  no task children can still run directly, even though the preferred path is
  `Stream -> Feature -> Task`.
- Top-level issues with `io` plus exactly one configured module label still fall
  back to backlog routing for retained compatibility.
- Task landing onto the feature branch is implemented today, but automated
  feature-branch squashing, rebasing, and merge into the stream branch is still
  being tightened.
- The runtime still uses some legacy "stream" naming in internal state files
  for the current branch owner, even when that branch is actually a feature
  branch in the preferred workflow.
- Automatic finalization of a top-level retained branch into `main` exists
  today; the full preferred feature-to-stream-to-main chain is not yet
  end-to-end.
