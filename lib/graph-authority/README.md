# Graph Authority

`@io/graph-authority` is the extracted authority/runtime boundary for shared
authoritative graph behavior.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Use the package-adjacent docs below for package-specific semantics.
- Read `./src/index.ts` for the curated package surface.
- Read `./src/index.test.ts`, `./src/authorization.test.ts`, or
  `./src/contracts.test.ts` for focused usage examples.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-authority`.

- [`./doc/authority-stack.md`](./doc/authority-stack.md): cross-package ownership for predicate visibility, command-lowering, authorization, and authoritative execution
- [`./doc/write-session.md`](./doc/write-session.md): authoritative apply flow, idempotent replay, retained-history windows, and total or incremental sync seams
- [`./doc/replication.md`](./doc/replication.md): transport visibility filtering, authority-owned read filtering, and write-scope enforcement
- [`./doc/persistence.md`](./doc/persistence.md): persisted authority runtime, startup recovery, durable commit boundaries, and the Node JSON adapter
- [`./doc/authorization.md`](./doc/authorization.md): request-bound policy evaluation, admission, share, and browser bootstrap contracts
- [`./doc/installed-modules.md`](./doc/installed-modules.md): installed-module ledger validation and lifecycle planning
- [`./doc/roadmap.md`](./doc/roadmap.md): retained-record storage and durable restore direction above the live authority graph

Cross-package architecture now lives in `./doc/authority-stack.md`,
`../graph-sync/doc/sync-stack.md`, `../graph-module/doc/module-stack.md`, and
`../graph-module/doc/secret-stack.md`. Start here when the question is local to
this package. Jump to the broader package roadmaps when the question crosses
package boundaries or future direction.

## What It Owns

- authoritative write sessions and retained-history replay semantics
- total sync payload creation from an authority store
- persisted-authority runtime plus durable storage adapter contracts
- authority-side replication filtering and read-authorizer contracts
- authority-side validation helpers and validators
- graph-owned authorization evaluation and share/admission/capability contracts
- browser/bootstrap principal summary contracts, module-permission approvals,
  and installed-module ledger state

## What It Does Not Own

- graph store, schema, ids, and write-envelope primitives from `@io/graph-kernel`
- sync session, cursor, and payload core contracts from `@io/graph-sync`
- client runtime and HTTP/query helpers from `@io/graph-client`
- Durable Object wiring, SQLite layouts, route handlers, or request-session bridges
- workflow-specific web authority logic, live-scope routing, or React/web UI

## Common Workflows

- Build an in-memory authority runtime: `createAuthoritativeGraphWriteSession`
- Build a full replicated snapshot: `createAuthoritativeTotalSyncPayload`
- Build a durable authority runtime: `createPersistedAuthoritativeGraph`
- Validate external authority input: `validateAuthoritativeGraphWriteTransaction`, `validateAuthoritativeGraphWriteResult`, `validateAuthoritativeTotalSyncPayload`
- Evaluate graph-owned policy: `authorizeRead`, `authorizeWrite`, `authorizeCommand`
- Plan installed-module lifecycle: `validateInstalledModuleCompatibility`, `planInstalledModuleLifecycle`

## Important Semantics

- Transaction `id` values are authority idempotency keys. Replaying the same id
  with the same canonical transaction returns a replayed write result; reusing
  the id for different contents fails validation.
- Retained history may be unbounded or pruned by transaction count. When a
  persisted baseline can no longer be justified by retained history, startup
  diagnostics report a baseline reset instead of silently resuming.
- Durable storage adapters own persistence details only. The shared runtime sees
  `load`, per-transaction `commit`, and full-baseline `persist`.
- Replication filtering first removes authority-only predicates, then applies an
  optional read authorizer over the remaining replicated slice.
- Policy evaluation assumes request-bound authorization context may be stale and
  should fail closed when policy snapshots no longer line up.

## Public API

`@io/graph-authority` exposes a browser-safe root entrypoint from `./src/index.ts`
plus a Node-only `@io/graph-authority/server` subpath for filesystem-backed
helpers.

- persisted authority runtime: `createPersistedAuthoritativeGraph`
- write/session helpers: `createAuthoritativeGraphWriteSession`,
  `createAuthoritativeTotalSyncPayload`
- validation helpers: `validateAuthoritativeGraphWriteTransaction`,
  `validateAuthoritativeGraphWriteResult`,
  `validateAuthoritativeTotalSyncPayload`
- policy/runtime helpers: `authorizeRead`, `authorizeWrite`, `authorizeCommand`
- durable authority contracts: `PersistedAuthoritativeGraphStorage`,
  `PersistedAuthoritativeGraphStartupDiagnostics`,
  `AuthoritativeGraphWriteSession`, `ReplicationReadAuthorizer`
- graph-owned policy contracts: `AuthorizationContext`, `AdmissionPolicy`,
  `CapabilityGrant`, `ShareGrant`, `PrincipalRoleBinding`, `GraphCommandPolicy`,
  `WebPrincipalBootstrapPayload`, `ModulePermissionApprovalRecord`,
  `InstalledModuleRecord`
- server-only persistence helpers from `@io/graph-authority/server`:
  `createJsonPersistedAuthoritativeGraph`,
  `createJsonPersistedAuthoritativeGraphStorage`

## Build Output

Run `turbo build --filter=@io/graph-authority` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-authority` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.

## Package Boundary

`@io/graph-authority` intentionally avoids a build-time dependency on
`@io/graph-module-core`. Package-local typecheck probes use self-contained graph
fixtures so `turbo build` can preserve the acyclic package graph. Cross-package
authority coverage now lives in `@io/graph-integration`.
