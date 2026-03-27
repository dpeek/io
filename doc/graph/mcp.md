# Graph MCP

## Purpose

Describe the current read-first Model Context Protocol surface for `io`,
including the current bearer-share auth proof, the opt-in CRUD write gate, and
the remaining command roadmap.

## Current Implemented Surface

The repo now ships a stdio graph MCP entrypoint:

- command:
  `io mcp graph [--url <url>] [--bearer-token <token>] [--allow-writes]`
- runtime: one `createHttpGraphClient(namespace, ...)` session kept alive for
  the stdio server
- auth:
  - default local flow can run without a bearer token against a locally trusted
    Worker
  - optional bearer auth comes from `--bearer-token` or
    `IO_GRAPH_BEARER_TOKEN` and is forwarded as
    `Authorization: Bearer <token>` on MCP transport requests
  - the shipped bearer auth path is the existing bearer-share flow backed by
    hashed share-grant lookup
  - this is not machine-token auth and not principal-backed service auth
- current read tools:
  - `graph.status`
  - `graph.listTypes`
  - `graph.listEntities`
  - `graph.getEntity`
  - `graph.getEntities`
- gated write tools when `--allow-writes` is set:
  - `graph.createEntity`
  - `graph.updateEntity`
  - `graph.deleteEntity`
- read behavior:
  - entity tools re-sync before reading
  - type discovery stays local to the compiled schema
  - default entity reads only expose visible fields
  - explicit field-path selections are validated against the compiled schema
  - unknown type keys, ids, and field paths return structured errors
- write behavior:
  - write tools stay unregistered unless `--allow-writes` is set
  - writes use the current typed mutation plus `sync.flush()` path
  - failed pushes surface the current validation or authority error text
  - failed pushes reset the local MCP session client before the next request
- bearer-share limitation:
  - bearer share tokens only authorize `GET /api/sync` in the current Worker
    proof
  - startup rejects `--allow-writes` when bearer auth comes from
    `--bearer-token` or `IO_GRAPH_BEARER_TOKEN`
  - bearer-auth MCP is therefore explicitly read-only in the current shipped
    proof
  - MCP writes require another auth path that can post to `/api/tx`

## Why This Is Feasible Now

The repo now ships its own MCP server, and the underlying runtime pieces were
already in place:

- `@io/graph-client`, implemented in
  `../../lib/graph-client/src/graph.ts` and
  `../../lib/graph-client/src/http.ts`, already provides the typed client,
  local query surface, and HTTP-backed graph adapter
- the Worker authority already exposes thin sync and write routes in
  `../../lib/app/src/web/lib/server-routes.ts`
- the Durable Object wrapper already hosts that authority in
  `../../lib/app/src/web/lib/graph-authority-do.ts`
- field visibility and write policy already exist in
  `../../lib/app/src/graph/runtime/schema.ts`
- secret-backed and `server-command` fields already reject ordinary writes in
  `../../lib/app/src/web/lib/authority.test.ts`

That meant the missing work was mostly the MCP adapter, the tool shape, and a
small amount of schema-to-tool plumbing.

## Goals

- let MCP-capable agents inspect the graph without bespoke repo integration
- reuse the existing Worker and graph runtime contracts rather than introducing
  a second data path
- keep the MVP small enough to land quickly
- make write support clearly opt-in and clearly non-final

## Non-Goals

- a final auth or capability model for remote multi-tenant access
- machine tokens or principal-backed service auth for MCP
- a complete graph query language
- a full graph-command framework for type-local business methods
- exposing secret reveal or secret rotation through the first MCP cut
- building a production remote MCP control plane before the local stdio path
  proves useful

## Proposed MVP Shape

### Transport

The first version should be a stdio MCP server launched by the existing CLI:

- command: `io mcp graph`
- default backend: the existing graph HTTP routes exposed by the Worker
- expected local flow: run `io start`, then point an MCP-capable client at
  `io mcp graph --url http://io.localhost:1355/`
- explicit remote bearer-share flow:
  `io mcp graph --url <url> --bearer-token <token>`

The explicit remote bearer flow is intentionally narrow: it reuses the current
share-link style bearer-share proof instead of introducing a second auth model.
That means the remote bearer path is for shared reads, not general write access.

This is the fastest path because it:

- works with current MCP clients immediately
- keeps auth and deployment concerns out of the first cut
- reuses the same authority path local users already exercise through the web
  surface

Remote MCP transport can come later, but it should wrap the same tool handlers
rather than inventing a second implementation.

### Runtime Approach

The MCP server should keep a synced graph client alive for the duration of the
stdio session:

1. bootstrap a `createHttpGraphClient(...)` instance against the existing
   Worker endpoint
2. call `sync.sync()` before serving the first request
3. optionally re-sync before every read tool call, or expose a lightweight
   refresh tool if request cost matters
4. perform writes only through the existing synced-client mutation and flush
   path

This keeps MCP behavior aligned with current graph semantics instead of
re-implementing reads and writes directly against store internals.

## Current Read Surface

### Required tools

#### `graph.status`

Return enough operational context for an agent to reason about the current
server:

- configured base URL
- current sync cursor
- whether the local MCP session graph is ready
- counts for known entity types

#### `graph.listTypes`

Return a compact schema summary derived from the compiled namespace:

- type key
- kind: `entity`, `enum`, or `scalar`
- display name
- for entities: visible fields with path label, range, cardinality, and write
  policy
- for enums: available option ids and names

This tool is the main discovery surface for agents. It avoids forcing them to
reverse-engineer field names from raw entity payloads.

#### `graph.listEntities`

Return ids plus a shallow preview for one entity type.

Input should be minimal:

- `type`
- `limit?`

Output should avoid trying to be a generic query language. The first version
can return:

- `id`
- a best-effort preview assembled from visible fields like `name`,
  `headline`, `slug`, `updatedAt`

This is enough for agents to discover candidate ids before fetching full
entities.

#### `graph.getEntity`

Return one entity by type and id.

Inputs:

- `type`
- `id`
- optional `select`

If `select` is omitted, the server returns the visible default field shape,
including raw reference ids for entity references. If `select` is provided, the
server validates the requested field paths against the compiled schema and
builds a typed selection object dynamically.

The important constraint is that MCP should only expose fields whose visibility
is currently safe to replicate. Hidden or authority-only fields should stay
hidden by default even though the MCP server runs close to authority.

#### `graph.getEntities`

Return a batch by ids for one entity type.

Inputs:

- `type`
- `ids`
- optional `select`

This is mostly a token-efficiency tool. The current typed query client already
supports `where: { ids: [...] }`, so this should be a thin wrapper.

### Optional resources

If the chosen MCP client benefits from resources, the same information can also
be published through:

- `graph://schema`
- `graph://types/{typeKey}`

That is useful, but not required for the first cut. Tool support is more
important than resource support for the MVP.

## Why Not Start With `graph.query`

The current typed query client only supports `id` and `ids` lookup, not a full
generic field-filter DSL. The explorer has UI-side filter plumbing, but the repo
does not yet have a compact server-side query language worth standardizing as an
MCP contract.

That means the MVP should not pretend to offer arbitrary graph queries. A small
set of reliable read tools is better than a fake-generic query tool that would
need to be redesigned immediately.

## Opt-In Write Support

The MVP now ships opt-in CRUD writes behind `--allow-writes`.

### Proposed write gate

Write tools are only registered when the server is launched with
`--allow-writes`.

That is not real auth. It is just a deliberate local safety latch for the MVP.
Actual write authorization still comes from the graph HTTP authority path behind
`/api/tx`.

For bearer-share sessions, that means:

- startup rejects the write gate before the MCP server boots
- bearer-auth MCP remains read-only in the current shipped proof

### Proposed write tools

#### `graph.createEntity`

Inputs:

- `type`
- `values`

The server resolves the requested type handle, calls the current typed
`create(...)` path, then flushes through the synced-client authority channel.

#### `graph.updateEntity`

Inputs:

- `type`
- `id`
- `patch`

The server resolves the entity ref, applies the current typed `update(...)`
path, then flushes.

#### `graph.deleteEntity`

Inputs:

- `type`
- `id`

The server resolves the entity ref, calls `delete()`, then flushes.

### MVP write safety story

This is intentionally incomplete but still better than a raw store backdoor:

- local mutation validation still runs
- authoritative write validation still runs
- field visibility and write-policy checks already still apply on the
  authority side
- secret-backed fields that require `server-command` writes already reject
  ordinary transactions

In other words, the current gated write path can be unprotected at the process
level without being totally unstructured at the graph-runtime level.

### What write should not do yet

The first write pass should not expose:

- raw `GraphWriteTransaction` authoring as the public MCP contract
- secret reveal
- secret rotation
- authority-only field reads
- arbitrary type-local business commands that do not exist yet

## Longer-Term Write Direction

The long-term direction should still be command-oriented, not CRUD-only.

The repo already has the right conceptual shape for this in
`./authority.md` and `../../lib/app/src/graph/runtime/contracts.ts`:

- graph methods should lower to explicit authority commands
- commands should carry policy and execution metadata
- MCP write tools should eventually call those commands rather than exposing
  generic entity mutation forever

That suggests a staged path:

1. MVP read-only MCP
2. opt-in CRUD write tools backed by current typed mutation plus flush
3. graph-command dispatch in the authority layer
4. replace or narrow CRUD write tools in favor of command-oriented MCP tools

## Suggested File Layout

The implementation should stay small and keep transport separate from graph
runtime internals.

- `../../lib/app/src/task/mcp.ts`: CLI entrypoint for `io mcp ...`
- `../../lib/app/src/mcp/index.ts`: MCP server bootstrap
- `../../lib/app/src/mcp/graph.ts`: graph-session bootstrap and tool registration
- `../../lib/app/src/mcp/schema.ts`: type lookup, selection validation, preview shaping
- `../../lib/app/src/mcp/*.test.ts`: protocol and handler coverage

The root `graph` package should not absorb MCP-specific transport logic.
`graph` should keep owning schema, client, validation, sync, and authority
contracts. The MCP server is a consumer of those contracts.

## Current Status

The read-first MCP plus opt-in CRUD writes is in place:

- an MCP client can launch `io mcp graph`
- the server can connect to the current local or deployed Worker authority
- `graph.listTypes` returns a usable schema summary
- `graph.listEntities` returns ids and previews for entity types
- `graph.getEntity` and `graph.getEntities` return visible graph data
- unknown type keys, ids, and field paths produce explicit structured errors
- authority-only and hidden fields are not returned by default
- write tools are registered only when the server is launched with
  `--allow-writes`
- bearer-share sessions reject `--allow-writes` at startup when bearer auth is
  provided through the CLI flag or environment fallback
- `graph.createEntity`, `graph.updateEntity`, and `graph.deleteEntity` work for
  normal replicated fields
- failed flushes surface the current validation or authority error text
- attempts to mutate secret-backed `server-command` fields fail with the
  current authoritative rejection path

## Next Steps

1. Add tests that prove ordinary replicated writes work and secret-backed
   `server-command` writes still fail.
2. Decide whether resources such as `graph://schema` belong in the next cut or
   can wait behind the write pass.
3. Continue narrowing write-heavy flows toward command-oriented MCP tools as
   graph-owned command descriptors become more real.

## Open Questions

- Should the MCP session always re-sync before every read, or should it expose
  an explicit refresh tool?
- Should `graph.getEntity` default to all visible fields, or to a compact
  preview plus explicit `select` for deep reads?
- Do we want resources in the first cut, or only tools?
- Should local stdio MCP talk only to the HTTP Worker, or should a future mode
  allow direct in-process authority access for tests and scripts?
- When graph commands become real, which CRUD tools should remain public versus
  becoming implementation details?
