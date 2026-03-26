# Graph Authority

`@io/graph-authority` is the extracted authority/runtime boundary for shared
authoritative graph behavior.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Read `./src/index.ts` for the curated package surface.
- The package owns write sessions, persisted authority runtime, authority-side
  sync filtering, validation, and graph-owned authorization/policy contracts.

## What It Owns

- authoritative write sessions and retained-history replay semantics
- total sync payload creation from an authority store
- persisted-authority runtime plus durable storage adapter contracts
- authority-side replication filtering and read-authorizer contracts
- authority-side validation helpers and validators
- graph-owned authorization evaluation and share/admission/capability contracts
- browser/bootstrap principal summary contracts and module-permission approvals

## What It Does Not Own

- graph store, schema, ids, and write-envelope primitives from `@io/graph-kernel`
- sync session, cursor, and payload core contracts from `@io/graph-sync`
- client runtime and HTTP/query helpers from `@io/graph-client`
- Durable Object wiring, SQLite layouts, route handlers, or request-session bridges
- workflow-specific web authority logic, live-scope routing, or React/web UI

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

`@io/graph-authority` exposes a single public entrypoint from `./src/index.ts`.

- persisted authority runtime: `createPersistedAuthoritativeGraph`,
  `createJsonPersistedAuthoritativeGraph`,
  `createJsonPersistedAuthoritativeGraphStorage`
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
  `WebPrincipalBootstrapPayload`, `ModulePermissionApprovalRecord`

## Build Output

Run `bun run build` in this package to emit `./out`.
Run `bun test` in this package to execute the package-local tests.
