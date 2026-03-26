# Agent CLI Overview

The `io` binary dispatches `io <cmd> ...` to `./src/task/<cmd>.ts` and calls
that module's exported `run(args)` function.

Current top-level task modules are:

- `agent`
- `browser-agent`
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

- `io tui [entrypointPath] [--graph-url <url>] [--project <projectId>] [--branch <branchId>]`

`io tui` boots the new terminal workflow product shell from `src/tui/*`.
`io agent tui ...` remains the legacy retained session monitor.
The CLI now initializes the synced workflow graph client before rendering and
fails closed when startup cannot materialize the initial workflow surface.

The first workflow TUI startup contract is intentionally small:

- `entrypointPath` still resolves through the existing `io.ts` plus `io.md`
  loader path
- graph source is one HTTP base URL resolved from `--graph-url`, then
  `io.ts -> tui.graph.url`, then the default `http://io.localhost:1355/`
- sync scope is fixed to the workflow review module scope
  `ops/workflow / scope:ops/workflow:review`
- initial project resolves from `--project`, then
  `io.ts -> tui.initialScope.project`, then by inferring the one visible
  `WorkflowProject` in the synced scope
- initial branch resolves from `--branch`, then
  `io.ts -> tui.initialScope.branch`, then the first branch-board row in the
  resolved project

## MCP

- `io mcp graph [--url <url>] [--bearer-token <token>] [--allow-writes]`
  starts the stdio MCP server against the graph HTTP routes.
- `--bearer-token` overrides the `IO_GRAPH_BEARER_TOKEN` env fallback and sends
  `Authorization: Bearer <token>` on graph MCP HTTP requests.
- `IO_GRAPH_BEARER_TOKEN` provides the same bearer-share token through the
  environment when the flag is omitted.
- bearer auth here is the existing bearer-share path backed by hashed share
  grants. It is not machine-token auth and it is not principal-backed service
  auth.
- bearer-share auth is currently read-only in the shipped proof because the
  Worker only accepts bearer share tokens on `GET /api/sync`. MCP reads work
  over that path; MCP writes do not.
- `--allow-writes` registers the gated `graph.createEntity`,
  `graph.updateEntity`, and `graph.deleteEntity` tools.
- `--allow-writes` only helps when the backing graph URL is using an auth path
  that can post to `/api/tx`.
- startup now fails closed when `--allow-writes` is combined with
  `--bearer-token` or `IO_GRAPH_BEARER_TOKEN` because bearer-share sessions are
  explicitly read-only in the current proof.
- The canonical graph MCP contract lives in
  [../graph/mcp.md](../graph/mcp.md).

## Relevant Code

- [cli/index.ts](../../src/cli/index.ts): top-level task dispatch
- [task/agent.ts](../../src/task/agent.ts) and
  [agent/server.ts](../../src/agent/server.ts): `io agent ...`
- [task/browser-agent.ts](../../src/task/browser-agent.ts) and
  [browser-agent/server.ts](../../src/browser-agent/server.ts): `io browser-agent`
- [task/mcp.ts](../../src/task/mcp.ts) and
  [mcp/index.ts](../../src/mcp/index.ts): `io mcp ...`

## Browser-Agent Command

- `io browser-agent [entrypointPath] [--host <host>] [--port <port>]`

`io browser-agent` starts the local long-lived browser bridge used by `/workflow`
for browser-owned launch, attach, and active-session lookup. The first shipped
runtime serves a localhost HTTP transport with:

- `GET /health`
- `POST /launch-session`
- `POST /active-session`

The runtime stays explicit when the shared launch coordinator is not configured:
`/workflow` surfaces the local runtime as unavailable and points operators at
`io browser-agent` rather than pretending browser launch exists.

When `/workflow` reloads after a browser-owned launch, it rechecks the selected
branch or commit through `POST /active-session` and reuses the returned attach
handoff when the local runtime still owns that session. Typed attach or launch
failures stay visible in the page instead of degrading into a silent retry.
