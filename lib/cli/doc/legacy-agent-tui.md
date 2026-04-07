---
name: CLI legacy agent TUI
description: "Current retained-session monitor owned by @op/cli for `io agent tui ...`."
last_updated: 2026-04-07
---

# CLI legacy agent TUI

## Read this when

- you are changing `io agent tui ...`, `io agent tail ...`, retained attach or
  replay, transcript shaping, or session-event normalization
- you need the boundary between the legacy retained-session monitor and the
  graph-backed workflow TUI

## Purpose

The legacy agent TUI renders the retained operator-facing session monitor for
`agent` runs on top of the normalized session stream and retained runtime
files. The graph-backed workflow shell lives separately in `../src/tui/*`.

## Entry points

- `io agent tui [entrypointPath] [--once]`: live supervisor plus worker view
- `io agent tui attach <issue> [entrypointPath]`: follow one retained issue
  until its worker session reaches a terminal phase
- `io agent tui replay <issue> [entrypointPath] [--delay-ms <ms>]`: replay one
  retained issue with a default `40ms` event delay
- `io agent tail <issue> [entrypointPath]`: raw tail of the retained issue log

## Current behavior

- live mode subscribes to the session event bus emitted by `agent`
- retained attach and replay rebuild session state from runtime files,
  retained events, and `codex.stdout.jsonl`
- the live store keeps the two most recent terminal worker sessions visible by
  default
- finalized worker sessions are removed from the live store by default
- transcript state is bounded in memory; large output, reasoning, and tool
  payloads are truncated
- raw Codex stdout and stderr are persisted to runtime log files instead of
  staying in memory for completed runs
- attach mode exits when the retained worker session reaches a terminal phase

## Ownership boundary

- keep the live supervisor or worker monitor, retained attach or replay flows,
  transcript shaping, and Codex event normalization in `../src/agent/tui/*`
- keep workflow branch-board, branch-detail, commit-queue composition, and
  workflow shell selection logic in `../src/tui/*`
- keep attach and replay here until workflow history reads can come from
  graph-backed `AgentSession` and `AgentSessionEvent` records instead of the
  retained runtime files used today

## Source anchors

- `../src/agent/server.ts`
- `../src/agent/tui-runtime.ts`
- `../src/agent/tui/store.ts`
- `../src/agent/tui/transcript.ts`
- `../src/agent/tui/layout.ts`
- `../src/agent/tui/tui.tsx`
- `../src/agent/tui/session-events.ts`
- `../src/agent/tui/codex-event-stream.ts`
- `../src/agent/tui/ui.test.ts`

## Related docs

- [`./command-surfaces.md`](./command-surfaces.md): current CLI entrypoints
- [`./tui.md`](./tui.md): current graph-backed workflow TUI
- [`./roadmap.md`](./roadmap.md): future CLI direction
