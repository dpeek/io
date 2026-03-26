# Agent Overview

## Purpose

`agent` owns the issue-driven automation layer: workflow loading, issue routing,
context assembly, worker scheduling, worktree lifecycle, retained runtime
state, and the operator-facing session stream used by the TUI.

## Docs

- [Backlog Workflow](./backlog.md): interactive `Stream -> Feature -> Task`
  planning contract
- [Review Workflow](./review.md): review-pass contract for landed task work and
  next-issue creation
- [Workflow And Context](./workflow.md): workflow loading, routing, context
  assembly, and module scoping
- [CLI Overview](./cli.md): `io agent ...` and `io mcp ...` entrypoints
- [TUI Overview](./tui.md): live and retained operator UI
- [Browser Agent Proposal](./browser.md): browser-first workflow control
  surface, launch bridge, and delegated authority model
- [Documentation Agent](./document.md): doc-maintenance prompt contract
- [Simplification Agent](./simplify.md): cleanup prompt contract
- [Secrets Note](./secrets.md): retained pointer to the canonical graph secret
  docs after the doc move

## Current Runtime Defaults

- `./io.ts` plus `./io.md` are the only supported repo-local agent entrypoints.
- `./io.ts` currently routes issues labeled `backlog` or `planning` to the
  backlog profile; everything else falls back to `execute`.
- Review support exists in the runtime, but the current repo config keeps
  `reviewPlanningEnabled = false`, so `In Review` issues are not auto-routed
  today.
- The tracker currently polls `Todo` and `In Progress` issues only.
- The supervisor auto-schedules only released leaf task issues: stream
  `In Progress`, feature `In Progress`, task `Todo`, and at most one runnable
  task per feature branch.
- Successful execution lands the task commit onto the feature branch and moves
  the task to `Done` in the current repo configuration.
- Feature closure stays human-owned. When a feature moves to `Done`,
  [workspace.ts](../../src/agent/workspace.ts) squashes the feature branch onto
  the stream branch, preserves recoverable state on conflicts, and cleans up the
  branch when finalization succeeds.

## Code Surface

- [server.ts](../../src/agent/server.ts): `io agent ...` command handling and
  live/retained TUI modes
- [service.ts](../../src/agent/service.ts): scheduling, prompt assembly, run
  orchestration, and issue state transitions
- [workspace.ts](../../src/agent/workspace.ts): control repo, feature branches,
  issue worktrees, retained runtime files, landing, and finalization
- [workflow.ts](../../src/agent/workflow.ts),
  [context.ts](../../src/agent/context.ts),
  [issue-routing.ts](../../src/agent/issue-routing.ts), and
  [builtins.ts](../../src/agent/builtins.ts): workflow config, doc resolution,
  routing, and built-in prompt docs
- [runner/codex.ts](../../src/agent/runner/codex.ts): Codex app-server process,
  approvals, session logging, and sandbox defaults
- [tui-runtime.ts](../../src/agent/tui-runtime.ts) and
  [tui/index.ts](../../src/agent/tui/index.ts): retained replay/attach support,
  session event schema, transcript shaping, layout, and rendering
- [tracker/linear.ts](../../src/agent/tracker/linear.ts): Linear candidate
  polling and state writes
