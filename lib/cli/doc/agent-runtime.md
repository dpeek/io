---
name: CLI agent runtime
description: "Current issue-driven automation runtime owned by @op/cli."
last_updated: 2026-04-07
---

# CLI agent runtime

## Read this when

- you are changing `lib/cli/src/agent/*` outside the legacy TUI monitor
- you need the current scheduler, workspace, or retained-runtime behavior for
  `io agent ...`
- you want the package-owned runtime summary after retiring `doc/agent/index.md`

## Purpose

The agent runtime owns issue-driven automation: workflow loading, issue
routing, context assembly, worker scheduling, worktree lifecycle, retained
runtime state, and the operator-facing session stream consumed by the legacy
agent TUI.

## Current repo defaults

- `./io.ts` plus `./io.md` are the only supported repo-local agent entrypoints
- the current repo routes issues labeled `backlog` or `planning` to the
  backlog profile; everything else falls back to `execute`
- review support exists in the runtime, but the current repo keeps
  `reviewPlanningEnabled = false`, so `In Review` tasks are not auto-routed
- the tracker currently polls `Todo` and `In Progress` issues only

## Current scheduling rules

- the supervisor auto-schedules only released leaf task issues
- a task is execution-released only when the task itself is a leaf and both
  the parent feature and stream are `In Progress`
- `pickCandidateIssues(...)` keeps at most one runnable task per stream or
  feature branch at a time and respects Linear manual order
- successful execute runs move the task to `In Progress` before work starts and
  then to `Done` after completion succeeds
- review runs reuse the landed checkout and require the follow-up issue
  contract before the review can complete

## Current workspace and finalization behavior

- each scheduled issue gets a retained runtime directory, output log, and
  worktree under the configured workspace root
- execute runs land the task commit onto the feature branch through the shared
  workspace finalization coordinator
- commit closure stays human-owned; when a feature moves to `Done`, workspace
  finalization squashes the feature branch onto the stream branch, preserves
  recoverable state on conflicts, and cleans up on success
- interrupted or blocked runs preserve retained runtime state instead of
  deleting it

## Main source anchors

- `../src/agent/service.ts`
- `../src/agent/workspace.ts`
- `../src/agent/workflow.ts`
- `../src/agent/context.ts`
- `../src/agent/issue-routing.ts`
- `../src/agent/runner/codex.ts`
- `../src/agent/tracker/linear.ts`

## Related docs

- [`./agent-workflow.md`](./agent-workflow.md): workflow loading, routing, and
  context assembly
- [`./command-surfaces.md`](./command-surfaces.md): `io agent ...` commands
- [`./legacy-agent-tui.md`](./legacy-agent-tui.md): retained session monitor
- [`../../../doc/agent/backlog.md`](../../../doc/agent/backlog.md): planning
  skill
- [`../../../doc/agent/review.md`](../../../doc/agent/review.md): review skill
