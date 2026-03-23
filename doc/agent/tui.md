# TUI Overview

## Purpose

The agent-owned TUI renders the operator-facing session UI for IO runs on top of
the retained runtime and normalized event stream produced by `agent`.

## Entry Points

- `io agent tui [entrypointPath] [--once]`: live supervisor plus worker view
- `io agent tui attach <issue> [entrypointPath]`: follow retained output for one
  issue until it reaches a terminal phase
- `io agent tui replay <issue> [entrypointPath] [--delay-ms <ms>]`: replay
  retained events for one issue with a default `40ms` event delay
- `io agent tail <issue> [entrypointPath]`: raw tail of the retained issue log

## Current Behavior

- live mode subscribes to the session event bus emitted by
  [service.ts](../../src/agent/service.ts)
- retained modes rebuild session state from runtime files, retained events, and
  `codex.stdout.jsonl`
- the default live store keeps the two most recent terminal worker sessions
  visible
- finalized worker sessions are removed from the live store by default
- attach mode exits when the retained worker session reaches a terminal phase

## Related Docs

- [Agent Overview](./index.md)
- [Workflow And Context](./workflow.md)
- [CLI Overview](./cli.md)

## Code Surface

- [agent/server.ts](../../src/agent/server.ts): CLI modes and retained TUI
  command parsing
- [agent/tui-runtime.ts](../../src/agent/tui-runtime.ts): retained replay and
  attach support
- [agent/tui/store.ts](../../src/agent/tui/store.ts): retained session state and
  pruning rules
- [agent/tui/transcript.ts](../../src/agent/tui/transcript.ts): transcript
  shaping and block formatting
- [agent/tui/layout.ts](../../src/agent/tui/layout.ts) and
  [agent/tui/tui.tsx](../../src/agent/tui/tui.tsx): layout and rendering
- [agent/tui/session-events.ts](../../src/agent/tui/session-events.ts) and
  [agent/tui/codex-event-stream.ts](../../src/agent/tui/codex-event-stream.ts):
  event schema and Codex stream normalization
- [agent/tui/ui.test.ts](../../src/agent/tui/ui.test.ts): UI/runtime regression
  coverage
