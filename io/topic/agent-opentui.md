# Agent TUI And Operator Runtime

## What This Topic Covers

This topic covers the operator-facing runtime around `io agent`:

- live supervisor and worker execution
- retained runtime output per issue
- the OpenTUI-based multi-column UI
- plain-text follow mode via `io agent tail <issue>`

This is not just a UI package. It is the operator surface over the agent
runtime, retained issue state, and normalized session events.

## Main Commands

- `io agent start`
  - run the supervisor and workers in plain terminal mode
- `io agent tui`
  - run the same agent service with the TUI attached
- `io agent tui attach <issue>`
  - reconstruct a retained issue session and continue following it
- `io agent tui replay <issue>`
  - replay retained output into the TUI
- `io agent tail <issue>`
  - follow the main readable output stream for one issue without launching the
    full TUI

## Where To Look

CLI surface:

- `agent/src/server.ts`
- `cli/src/cli.ts`

Service and scheduling:

- `agent/src/service.ts`
- `agent/src/workspace.ts`

Codex runner and event model:

- `agent/src/runner/codex.ts`
- `agent/src/session-events.ts`

TUI runtime:

- `agent/src/tui.ts`
- `agent/src/tui-runtime.ts`
- `agent/src/tui.test.ts`
- `tui/src/store.ts`
- `tui/src/transcript.ts`
- `tui/src/tui.tsx`
- `tui/src/tui.test.ts`

Related repo docs:

- `io.md`
- `agent/doc/stream-workflow.md`
- `io/topic/overview.md`

## Current Runtime Model

The runtime centers on normalized session events rather than scraping terminal
output after the fact.

That event stream feeds:

- live stdout rendering
- the TUI
- retained per-issue runtime files
- attach and replay reconstruction

The important design boundary is:

- `AgentService` schedules work and owns supervisor plus worker lifecycle
- `Codex` runner code translates raw App Server traffic into typed session
  events
- retained issue runtime files preserve enough state to rebuild an operator view
  later
- the TUI and tail mode are just different consumers of the same runtime data

## Retained Runtime And Workspace Shape

By default this repo keeps agent runtime state under the workspace root declared
in `io.ts`, currently `.io`.

In practice that means:

- worktrees and merge helpers live under the external workspace root, not inside
  the repo tree
- issue runtime state and retained logs also live under that external workspace
  root

If you are changing worktree retention, runtime output locations, or cleanup
behavior, start with:

- `agent/src/workspace.ts`
- `agent/src/service.ts`

## Operator Model

The current operator experience has two levels:

- plain text
  - concise streamed output for one issue via `io agent tail`
- TUI
  - one supervisor column plus one column per worker session

The TUI is session-oriented, not file-oriented. It is intended to answer:

- what is the supervisor doing?
- which issues are active?
- what readable output is each worker producing?
- what raw Codex output is available if the readable path is insufficient?

The current transcript direction is to keep the readable path literal and
compact:

- supervisor lines should read like operator status, for example `IO is supervising <repo>`
- issue lifecycle lines should read like `OPE-81 Starting agent in ./.io/...`
- command and tool blocks should prefer plain readable headers over bracketed
  label prefixes

## Long-Term Goal

Long term, the operator surface should become the control room for IO:

- live and retained multi-agent runs use the same event model
- nested child-agent sessions can render as first-class sessions
- issue lifecycle, worktree state, and retained output are all inspectable from
  one place
- plain-text and TUI modes stay aligned because they consume the same runtime
  events

The goal is not just a nicer terminal UI. The goal is a durable operator model
for multi-agent work that remains debuggable after the original process exits.
