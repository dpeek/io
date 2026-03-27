# Graph Secrets

## Status

This page is retained in `doc/agent` as a short pointer after the doc move. The
canonical secret-backed graph docs now live under `doc/graph`.

The older phase-by-phase proposal that used to live here is stale. Most of the
contracts it described are now implemented.

## Current Repo State

- `core:secretHandle` is the canonical secret-handle type
- app types such as `workflow:envVar` author secret-backed refs with
  `defineSecretField(...)`
- field authority metadata and write scopes are live:
  `client-tx`, `server-command`, and `authority-only`
- the web authority keeps plaintext in authority-owned storage and commits only
  safe metadata into the graph
- total sync, incremental sync, MCP schema reads, and entity reads all filter
  `authority-only` fields from the replicated/public surface

## Canonical Docs

- [Graph Index](../graph/index.md)
- [Env Vars](../graph/env-vars.md)
- [Authority](../graph/authority.md)
- [Storage](../graph/storage.md)
- [Runtime](../graph/runtime.md)
- [MCP](../graph/mcp.md)

## Relevant Code

- [core secret type](../../lib/graph-module-core/src/core/secret.ts)
- [env-var type](../../lib/graph-module-workflow/src/env-var/type.ts)
- [runtime schema](../../lib/app/src/graph/runtime/schema.ts)
- [type-module helpers](../../lib/graph-module/src/type-module.ts)
- [web authority](../../lib/app/src/web/lib/authority.ts)
- [MCP schema filtering](../../lib/app/src/mcp/schema.ts)
