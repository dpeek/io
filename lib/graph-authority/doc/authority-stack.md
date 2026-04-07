---
name: Graph authority stack
description: "Cross-package ownership for predicate visibility, command-lowering, authorization, and authoritative execution centered on @io/graph-authority."
last_updated: 2026-04-03
---

# Graph authority stack

## Read this when

- the question spans predicate visibility, typed command authoring,
  authorization, authoritative apply, or secret-handling boundaries
- you need the shared authority boundary before changing permissions,
  command-lowering, or server-side graph behavior
- you want the owning package doc before editing authority-related code

## Main source anchors

- `../src/index.ts`: shared authority package surface
- `../src/contracts.ts`: auth, share, admission, capability, bootstrap, and
  installed-module contracts
- `../src/authorization.ts`: request-bound policy evaluator
- `../src/session.ts`: authoritative write sessions and total-sync payload
  creation
- `../../graph-kernel/src/schema.ts`: predicate visibility and field-write
  policy literals
- `../../graph-kernel/src/tx.ts`: shared write-scope literals and transaction
  id contracts
- `../../graph-module/src/contracts.ts`: authored command execution and
  command-surface contracts
- `../../app/src/web/lib/authority.ts`: host-owned request bridge and web
  authority composition

## What this doc owns

- the cross-package ownership map for the shipped authority stack
- stable seams between predicate policy metadata, shared authorization,
  authoritative write sessions, sync write scopes, and consumer-owned command
  transport
- redirects to the package-local docs that own current runtime behavior

It does not own Durable Object SQL layout, Better Auth parsing, or host-local
command registries.

## Current ownership

- `@io/graph-kernel` owns field visibility metadata, field-write policy
  literals, and canonical write envelopes
- `@io/graph-module` owns pure authored command and command-surface
  descriptors, including execution-mode metadata
- `@io/graph-authority` owns shared authorization, share and admission
  contracts, authoritative apply or replay, persistence contracts, replication
  filtering, and installed-module compatibility helpers
- `@io/graph-sync` carries write-scope and payload contracts consumed by
  authority and client layers
- host runtime code owns command envelopes, dispatch registries, HTTP or RPC
  routes, auth-provider or session bridges, Durable Object wiring, and SQLite
  storage adapters

## Stable contracts

### One logical graph, explicit authority boundary

The working model stays the same:

- one logical graph across client and server
- replication is policy, not a given
- authority is a first-class runtime boundary
- client APIs may feel local and typed, but authoritative state changes cross
  an explicit authority boundary

That is the boundary that keeps one graph model without pretending every
runtime has the same rights or the same data.

### Predicate-level visibility is the base rule

Policy starts at the predicate:

- predicate metadata decides whether data may replicate
- hidden predicates are omitted from the client slice; they are not represented
  as false
- write audiences and required capabilities are evaluated per predicate
- secret-backed predicates stay explicit in schema metadata rather than being
  treated like ordinary scalars

`authorizeRead(...)`, `authorizeWrite(...)`, and `authorizeCommand(...)` stay
fail closed when policy or capability metadata is missing or stale.

### Shared package boundary today

`@io/graph-authority` publishes the shared authority runtime. It does not
publish a graph-owned command registry or generic command transport.

Shared package surface:

- authoritative write sessions
- total-sync payload creation
- authority validation helpers
- authorization snapshots and evaluators
- graph-owned policy, share, admission, and browser-bootstrap contracts

Consumer-owned for now:

- generic command envelopes and result payloads
- dispatch registries and command naming
- HTTP or RPC routes such as `/api/commands`
- auth-provider bridges and request-session projection
- Durable Object and SQLite storage adapters

### Type-local business methods lower through commands

Type-local business logic should stay authored close to the type or module that
owns it, but authoritative execution still lowers through an explicit command
boundary.

That means:

- authored command descriptors live with the owning module
- object-style DX may exist above the boundary
- the authoritative path remains inspectable, authorizable, replayable, and
  auditable

`GraphCommandSpec` owns execution mode and policy. Human invocation metadata
belongs on `GraphCommandSurfaceSpec`.

### Execution modes and trust

The authored execution modes are the current trust split:

- `localOnly`: pure client-side derivation from already replicated data
- `optimisticVerify`: client may produce a tentative result, but the server
  must rerun it authoritatively
- `serverOnly`: the client expresses intent, but only the server executes the
  logic

Sync and reconcile remain the place where tentative local state meets
authoritative graph state.

### Secrets stay as handles, not client-readable scalars

Sensitive values still belong in the graph model, but the client-facing shape
is a handle plus safe metadata, not plaintext.

Shared authority rule:

- secret-backed predicates are explicit in graph schema and policy metadata

Host-owned storage rule:

- plaintext storage, unseal paths, and web-specific secret lifecycle stay in
  app-owned authority storage code and docs

Do not restate web storage details here as if they were part of the shared
authority package.

## Where current details live

- `./write-session.md`: authoritative apply flow, replay, retained history, and
  total or incremental payload seams
- `./replication.md`: transport visibility filtering and read-authorizer
  contracts
- `./persistence.md`: persisted-authority runtime and storage adapter
  contracts
- `./authorization.md`: request-bound policy evaluation, admission, share, and
  browser bootstrap contracts
- `./installed-modules.md`: installed-module ledger validation and lifecycle
  planning
- `../../graph-module/doc/authored-contracts.md`: authored command and
  command-surface contracts
- `../../graph-sync/doc/sync-stack.md`: shared write-scope and replay boundary
- `../../app/doc/authority-storage.md`: current web Durable Object storage and
  secret side-storage shape
- `../../graph-module/doc/secret-stack.md`: secret-handle semantics and current
  reveal or rotation seam

## Related docs

- `../../graph-module/doc/module-stack.md`: built-in module ownership and
  activation boundaries
- `../../graph-surface/doc/roadmap.md`: graph-native command and UI direction
  above the authority seam
- `../../cli/doc/graph-mcp.md`: current MCP write gate
- `../../cli/doc/roadmap.md`: command-oriented longer-term MCP direction

Keep this doc narrow. Current-state package behavior belongs in the package docs
listed above.
