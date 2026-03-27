# Agent TUI Overview

## Purpose

The agent-owned TUI renders the legacy operator-facing session UI for IO runs on
top of the retained runtime and normalized event stream produced by `agent`.
The new graph-backed workflow product shell now lives in `../../lib/app/src/tui/*`.

## Entry Points

- `io agent tui [entrypointPath] [--once]`: live supervisor plus worker view
- `io agent tui attach <issue> [entrypointPath]`: follow retained output for one
  issue until it reaches a terminal phase
- `io agent tui replay <issue> [entrypointPath] [--delay-ms <ms>]`: replay
  retained events for one issue with a default `40ms` event delay
- `io agent tail <issue> [entrypointPath]`: raw tail of the retained issue log

## Current Behavior

- live mode subscribes to the session event bus emitted by
  [service.ts](../../lib/app/src/agent/service.ts)
- retained modes rebuild session state from runtime files, retained events, and
  `codex.stdout.jsonl`
- the default live store keeps the two most recent terminal worker sessions
  visible
- finalized worker sessions are removed from the live store by default
- attach mode exits when the retained worker session reaches a terminal phase

## Migration Boundary

- `../../lib/app/src/agent/tui/*` remains the retained session monitor while the
  graph-backed workflow shell in `../../lib/app/src/tui/*` stays focused on workflow
  board, detail, and commit-queue composition
- do not add new workflow product-shell panels here; branch selection and
  commit-queue UX belong in `../../lib/app/src/tui/*`
- when session launch moves into the workflow shell, keep shared event
  envelopes and transcript formatting reusable, but move workflow-specific
  chrome and selection logic from the new shell rather than expanding the
  legacy monitor
- attach and replay stay here until workflow history reads can come from
  graph-backed `AgentSession` and `AgentSessionEvent` records instead of the
  retained runtime files used today
- the workflow shell migration notes live in [TUI Overview](../tui/index.md)

## Related Docs

- [Agent Overview](./index.md)
- [Workflow And Context](./workflow.md)
- [CLI Overview](./cli.md)

## Code Surface

- [agent/server.ts](../../lib/app/src/agent/server.ts): CLI modes and retained TUI
  command parsing
- [agent/tui-runtime.ts](../../lib/app/src/agent/tui-runtime.ts): retained replay and
  attach support
- [agent/tui/store.ts](../../lib/app/src/agent/tui/store.ts): retained session state and
  pruning rules
- [agent/tui/transcript.ts](../../lib/app/src/agent/tui/transcript.ts): transcript
  shaping and block formatting
- [agent/tui/layout.ts](../../lib/app/src/agent/tui/layout.ts) and
  [agent/tui/tui.tsx](../../lib/app/src/agent/tui/tui.tsx): layout and rendering
- [agent/tui/session-events.ts](../../lib/app/src/agent/tui/session-events.ts) and
  [agent/tui/codex-event-stream.ts](../../lib/app/src/agent/tui/codex-event-stream.ts):
  event schema and Codex stream normalization
- [agent/tui/ui.test.ts](../../lib/app/src/agent/tui/ui.test.ts): UI/runtime regression
  coverage
