# Stream Feature Task Workflow

## Status

This is the primary user-facing contract for the current `io` Linear workflow.
It defines the preferred `Stream -> Feature -> Task` shape and the current
automation boundary.

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
- committing successful task work, rebasing it onto the current parent feature
  branch head, and merging it before the task is marked `Done`
- marking successful tasks `Done`
- preserving blocked or interrupted task worktrees and runtime state instead of
  discarding them

## State Contract

- Planning states such as `Backlog` or `Todo` remain user-owned. Nothing is
  execution-released until the relevant parent issue is `In Progress`.
- A task under a feature only becomes runnable when both the feature and the
  stream are explicitly `In Progress`.
- The supervisor only picks released task issues. Top-level stream issues,
  feature issues, and other non-task leaves are not auto-run.
- A successful task run rebases and merges its work onto the current parent
  branch, then moves the task to `Done` automatically.

## Branch And Finalization Contract

- Each runnable task gets its own detached worktree, but its commit lands on the
  immediate parent branch.
- In the preferred workflow, that immediate parent is the feature, so
  successful task runs accumulate on `io/<feature-issue-key>`.
- Supervisor-side reconciliation after a task run is limited to stale-state
  cleanup, retained-worktree cleanup, and leftover branch deletion; it does not
  land task work onto feature branches.
- Parallel feature work is allowed inside one stream. The current scheduler only
  serializes work within the same feature branch.
- When a feature moves to `Done`, the runtime finalizes it by squashing the
  feature branch onto the current stream branch head as one commit with subject
  `OPE-XXX Feature title` and a concise completed-task body, then cleaning up
  the local feature branch state.
- If feature finalization conflicts or cannot update the stream branch cleanly,
  the runtime preserves the retained branch state so reconciliation can be
  retried without operator guesswork.
- Target stream completion behavior: once the stream branch contains the
  accepted feature work, it should land on `main`.

## Current Gaps And Compatibility Notes

- The runtime still uses some legacy "stream" naming in internal state files
  for the current branch owner, even when that branch is actually a feature
  branch in the preferred workflow.
- Automatic finalization of a top-level retained stream branch into `main`
  exists today, but stream-to-main release still remains a separate boundary
  from feature-to-stream reconciliation.
