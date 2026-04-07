---
name: CLI roadmap
description: "Future operator-runtime direction for @op/cli."
last_updated: 2026-04-07
---

# CLI roadmap

## Read this when

- you are deciding future direction for `@op/cli`
- the question is about still-provisional CLI, MCP, or legacy-monitor behavior
- you need the roadmap after retiring current-state docs from `doc/agent/*`

## Current state

`@op/cli` already ships:

- the `io` binary and top-level task dispatch
- the graph-backed workflow TUI in [`./tui.md`](./tui.md)
- the legacy retained-session monitor in
  [`./legacy-agent-tui.md`](./legacy-agent-tui.md)
- the local browser-agent runtime
- the stdio graph MCP surface in [`./graph-mcp.md`](./graph-mcp.md)

Those docs own current behavior. This page only keeps future direction.

## Graph MCP direction

The staged MCP direction remains:

1. keep the current stdio server on top of the synced HTTP graph client
2. keep the current opt-in CRUD write gate small and explicit
3. add graph-command dispatch once authority-owned command descriptors are
   real enough to expose as tools
4. narrow or replace generic CRUD tools in favor of command-oriented MCP tools

Open design questions:

- whether MCP should publish resources such as `graph://schema`
- whether reads should always re-sync or expose a more explicit refresh seam
- which CRUD tools, if any, should remain public once command-oriented tools
  exist

## Browser-agent direction

The browser-agent should stay a local runtime for the things the authority
cannot own safely:

- launch, attach, and local session-event streaming
- workspace reservation, git, worktrees, PTYs, and Codex execution
- browser reconnect handoff for sessions that still exist in the local runtime

Follow-on work still includes:

- cleaner repository finalization handoff after browser-owned sessions
- tighter lease or grant validation between browser, browser-agent, and
  authority
- eventual convergence where the workflow shell depends less on the legacy
  retained-session monitor

## Surface convergence

`@op/cli` currently carries both the graph-backed workflow shell and the legacy
agent session monitor. The medium-term direction is to keep:

- workflow screen composition and subject-aware launch affordances in
  `../src/tui/*`
- retained attach or replay and runtime-file-backed session monitoring in
  `../src/agent/tui/*` only while graph-backed workflow history reads are still
  incomplete

Retiring the legacy monitor requires workflow history and attach flows to come
from graph-backed `AgentSession` and `AgentSessionEvent` reads instead of the
retained runtime files used today.
