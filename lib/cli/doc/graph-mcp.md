---
name: CLI graph MCP
description: "Current stdio graph MCP surface owned by @op/cli."
last_updated: 2026-04-07
---

# CLI graph MCP

## Read this when

- you are changing `io mcp graph`
- you need the current auth, tool, or write-gate behavior for the stdio MCP
  server
- you want the current shipped surface before touching longer-term MCP design

## Purpose

`@op/cli` ships a stdio MCP server that talks to the existing graph HTTP
authority path through one synced graph client session. This doc owns the
current shipped surface only. Future direction lives in
[`./roadmap.md`](./roadmap.md).

## Command

- `io mcp graph [--url <url>] [--bearer-token <token>] [--allow-writes]`

Defaults:

- `--url`: `@io/graph-client` default HTTP graph URL
- `--bearer-token`: `IO_GRAPH_BEARER_TOKEN`

## Current runtime shape

- one `createHttpGraphClient(...)` session stays alive for the stdio server
- the compiled MCP schema comes from the current built-in `core` plus
  `workflow` graph namespaces
- type discovery comes from the compiled schema, not from remote schema
  introspection
- entity reads re-sync through the synced client before serving the request
- writes use the current typed mutation plus `sync.flush()` path

## Current auth and write gate

- the default local flow can run without a bearer token against a locally
  trusted Worker
- optional bearer auth comes from `--bearer-token` or
  `IO_GRAPH_BEARER_TOKEN` and is forwarded as `Authorization: Bearer <token>`
- the shipped bearer path is the current bearer-share flow backed by share
  grants
- bearer-share sessions are read-only in the current Worker proof because they
  only authorize `GET /api/sync`
- startup rejects `--allow-writes` when bearer auth is present

## Current tools

Always available:

- `graph.status`
- `graph.listTypes`
- `graph.listEntities`
- `graph.getEntity`
- `graph.getEntities`

Available only with `--allow-writes`:

- `graph.createEntity`
- `graph.updateEntity`
- `graph.deleteEntity`

## Current read behavior

- `graph.status` returns base URL, sync cursor, readiness, freshness, pending
  count, sync status, and per-entity-type counts
- `graph.listTypes` returns a compact schema summary derived from the compiled
  namespace
- `graph.listEntities` returns ids plus shallow previews for one entity type
- `graph.getEntity` and `graph.getEntities` return visible graph data for one
  type and either one id or a batch of ids
- explicit `select` field paths are validated against the compiled schema
- unknown type keys, ids, and field paths return structured errors
- hidden and authority-only fields are not returned by default

## Current write behavior

- write tools are unregistered unless `--allow-writes` is set
- writes still go through local mutation validation and authoritative write
  validation
- failed pushes surface the current validation or authority error text
- failed pushes reset the local MCP session client before the next request
- secret-backed `server-command` fields still reject ordinary write attempts

## Current limits

- there is no generic `graph.query` tool
- resources such as `graph://schema` are not published yet
- MCP does not expose secret reveal, secret rotation, or authority-only field
  reads
- MCP write tools are still CRUD-oriented rather than command-oriented

## Source anchors

- `../src/task/mcp.ts`
- `../src/mcp/index.ts`
- `../src/mcp/graph.ts`
- `../src/mcp/schema.ts`
- `../../app/src/web/lib/server-routes.ts`
- `../../graph-authority/doc/authority-stack.md`

## Related docs

- [`./command-surfaces.md`](./command-surfaces.md): CLI command entrypoints
- [`./roadmap.md`](./roadmap.md): future CLI MCP direction
- [`../../graph-authority/doc/authority-stack.md`](../../graph-authority/doc/authority-stack.md):
  shared authority and command boundary
