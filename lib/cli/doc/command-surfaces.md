---
name: CLI command surfaces
description: "Current operator-facing command groups owned by @op/cli."
last_updated: 2026-04-07
---

# CLI command surfaces

## Read this when

- you are changing `io agent ...`, `io browser-agent`, `io mcp ...`, or
  top-level task dispatch
- you need the ownership boundary between the workflow TUI, the legacy agent
  TUI, the browser-agent runtime, and the MCP server

## Purpose

`@op/cli` owns the `io` binary and the operator-facing command groups behind
it. This doc stays at the command-surface level. Package-local behavior details
live in the more specific docs linked below.

## Top-level dispatch

- `io <cmd> ...` dispatches to `../src/task/<cmd>.ts`, which then calls the
  owning package entrypoint

Current top-level task modules:

- `agent`
- `browser-agent`
- `graph`
- `install`
- `mcp`
- `schema`
- `setup`
- `show-files`
- `start`
- `tui`

## Agent runtime commands

- `io agent start [entrypointPath] [--once]`
- `io agent validate [entrypointPath]`
- `io agent tui [entrypointPath] [--once]`
- `io agent tui attach <issue> [entrypointPath]`
- `io agent tui replay <issue> [entrypointPath] [--delay-ms <ms>]`
- `io agent tail <issue> [entrypointPath]`

Current rules:

- if `entrypointPath` is omitted, the workflow loader resolves `./io.ts` plus
  `./io.md`
- `io agent tui ...` is the legacy retained-session monitor, not the workflow
  product shell
- `io agent validate` only validates and logs the normalized workflow config;
  it does not start the supervisor

## Workflow TUI command

- `io tui [entrypointPath] [--graph-url <url>] [--project <projectId>] [--branch <branchId>]`

Current behavior details live in [`./tui.md`](./tui.md).

## Browser-agent command

- `io browser-agent [entrypointPath] [--host <host>] [--port <port>]`

Current local HTTP surface:

- `GET /health`
- `POST /launch-session`
- `POST /active-session`
- `POST /session-events`

Current rules:

- the browser-agent is a local runtime bridge for browser-owned launch, attach,
  and live session-event streaming
- when no shared launch coordinator is configured, the runtime reports itself
  as unavailable instead of pretending browser launch exists

## MCP command

- `io mcp graph [--url <url>] [--bearer-token <token>] [--allow-writes]`

Current behavior details live in [`./graph-mcp.md`](./graph-mcp.md).

## Source anchors

- `../src/cli/index.ts`
- `../src/task/agent.ts`
- `../src/task/browser-agent.ts`
- `../src/task/mcp.ts`
- `../src/task/tui.ts`
- `../src/agent/server.ts`
- `../src/browser-agent/server.ts`
- `../src/browser-agent/transport.ts`
- `../src/mcp/index.ts`
- `../src/tui/server.ts`

## Related docs

- [`./agent-runtime.md`](./agent-runtime.md): current issue-driven automation
  runtime
- [`./agent-workflow.md`](./agent-workflow.md): workflow loading, routing, and
  context assembly
- [`./tui.md`](./tui.md): current graph-backed workflow TUI
- [`./legacy-agent-tui.md`](./legacy-agent-tui.md): current retained-session
  monitor
- [`./graph-mcp.md`](./graph-mcp.md): current graph MCP surface
- [`./roadmap.md`](./roadmap.md): future CLI direction
