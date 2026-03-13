# Agent Overview

## Purpose

`agent` owns the issue-driven automation layer: workflow loading, issue routing, context assembly, worker scheduling, worktree lifecycle, retained runtime state, and the operator-facing session stream used by the TUI.

## Entry Points

- `../../io/backlog.md`: interactive stream backlog prompt and issue-structure contract
- `./module-stream-workflow-plan.md`: workflow loading, context assembly, routing, and module scoping
- `../src/service.ts`: supervisor scheduling and issue run orchestration
- `../src/workspace.ts`: branch lifecycle, task landing, and feature finalization

## Current Package Layout

- `../src/service.ts`: supervisor loop, task selection, and run orchestration
- `../src/workspace.ts`: control repo, stream/feature branches, issue worktrees, runtime files, and finalization
- `../src/workflow.ts`, `../src/context.ts`, `../src/issue-routing.ts`, `../src/builtins.ts`: workflow config, prompt docs, issue hints, routing, and built-in context
- `../src/runner/codex.ts`: Codex app-server process, approvals, session logging, and sandbox defaults
- `../src/session-events.ts`, `../src/tui-runtime.ts`, `../src/tui.ts`: retained event stream, replay/attach, and operator display surface
- `../src/tracker/linear.ts`: Linear candidate polling and state writes

## Current vs Roadmap

Current code centers on a three-level issue model: streams are maintained interactively, features own integration-sized branches under a stream, and the supervisor only runs leaf tasks. Task commits land on the feature branch; a completed feature is squashed and merged back into its stream branch during reconciliation.

## Future Work Suggestions

1. Add a short "start here by task" matrix for common jobs like stream backlog edits, task scheduling, or retained TUI debugging.
2. Add a compact API index for the exports in `../src/index.ts`.
3. Mark which docs describe durable contracts versus current repo proof surfaces.
4. Add explicit links from each focused doc to its most relevant tests.
5. Keep this page limited to navigation and move topic detail into the focused docs above.
