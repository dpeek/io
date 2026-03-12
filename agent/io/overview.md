# Agent Overview

## Purpose

`agent` owns the issue-driven automation layer: workflow loading, issue routing, context assembly, worker scheduling, worktree lifecycle, managed Linear writes, retained runtime state, and the operator-facing session stream used by the TUI.

## Entry Points

- `./module-stream-workflow-plan.md`: workflow loading, context assembly, routing, and module scoping
- `./managed-stream-contract.md`: managed-parent contract and parent/child phase model
- `./managed-stream-backlog.md`: parent brief refresh and child backlog maintenance contract
- `./managed-stream-comments.md`: `@io` comment parsing, writeback, and dedupe behavior
- `../src/workspace.ts`: lower-level branch and worktree lifecycle reference

## Current Package Layout

- `../src/service.ts`: supervisor loop, candidate selection, managed comment processing, and run orchestration
- `../src/workspace.ts`: control repo, stream branches, issue worktrees, runtime files, and finalization
- `../src/workflow.ts`, `../src/context.ts`, `../src/issue-routing.ts`, `../src/builtins.ts`: workflow config, prompt docs, issue hints, routing, and built-in context
- `../src/managed-stream.ts`, `../src/backlog-proposal.ts`, `../src/managed-comments.ts`, `../src/comment-state.ts`: managed parent refresh, child payload generation, comment commands, and replay safety
- `../src/runner/codex.ts`: Codex app-server process, approvals, session logging, and sandbox defaults
- `../src/session-events.ts`, `../src/tui-runtime.ts`, `../src/tui.ts`: retained event stream, replay/attach, and operator display surface
- `../src/tracker/linear.ts`: Linear candidate polling, state writes, managed child sync, and reply comments

## Current vs Roadmap

Current code already proves one supervisor can route issues into backlog or execute runs, materialize narrow context bundles, manage stream-scoped worktrees, refresh managed parent backlog state in Linear, and retain enough session data for replay or attach. The remaining roadmap is mostly around richer observability, broader tracker support, better operator tooling, and stricter contract boundaries as more automation lands.

## Future Work Suggestions

1. Add a short "start here by task" matrix for common jobs like routing bugs, managed-stream work, or retained TUI debugging.
2. Add a compact API index for the exports in `../src/index.ts`.
3. Mark which docs describe durable contracts versus current repo proof surfaces.
4. Add explicit links from each focused doc to its most relevant tests.
5. Keep this page limited to navigation and move topic detail into the focused docs above.
