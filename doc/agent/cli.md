# Agent CLI Overview

The `io` binary dispatches `io <cmd> ...` to `./src/task/<cmd>.ts` and calls
that module's exported `run(args)` function.

Current top-level task modules are:

- `agent`
- `check`
- `graph`
- `install`
- `mcp`
- `schema`
- `setup`
- `show-files`
- `start`
- `tui`

## Agent Commands

- `io agent start [entrypointPath] [--once]`
- `io agent tui [entrypointPath] [--once]`
- `io agent tui attach <issue> [entrypointPath]`
- `io agent tui replay <issue> [entrypointPath] [--delay-ms <ms>]`
- `io agent tail <issue> [entrypointPath]`
- `io agent validate [entrypointPath]`

If `entrypointPath` is omitted, the loader defaults to `./io.ts` plus
`./io.md`.

## TUI Commands

- `io tui [entrypointPath]`

`io tui` boots the new terminal workflow product shell from `src/tui/*`.
`io agent tui ...` remains the legacy retained session monitor.

## MCP

- `io mcp graph [--url <url>] [--allow-writes]` starts the stdio MCP server
  against the graph HTTP routes.
- `--allow-writes` registers the gated `graph.createEntity`,
  `graph.updateEntity`, and `graph.deleteEntity` tools.
- The canonical graph MCP contract lives in
  [../graph/mcp.md](../graph/mcp.md).

## Relevant Code

- [cli/index.ts](../../src/cli/index.ts): top-level task dispatch
- [task/agent.ts](../../src/task/agent.ts) and
  [agent/server.ts](../../src/agent/server.ts): `io agent ...`
- [task/mcp.ts](../../src/task/mcp.ts) and
  [mcp/index.ts](../../src/mcp/index.ts): `io mcp ...`
