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
- browser/bootstrap principal summary contracts, module-permission approvals,
  and installed-module ledger state

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

## Installed Module Ledger

`@io/graph-authority` now owns the authoritative installed-module ledger
contract used by later install planning and runtime rebuild work.

- `InstalledModuleRecord` captures module identity, version, digest, source
  linkage, compatibility metadata, granted permission keys, and timestamps.
- `InstalledModuleTarget` and `InstalledModuleRuntimeExpectation` are the
  planner-facing inputs derived from one manifest plus one concrete bundle
  digest and the current runtime contract.
- `installState` records whether the ledger row is `installing`, `installed`,
  `uninstalling`, or `failed`.
- `activation` separately records the desired activation target plus the
  observed activation status so a module can stay installed while `inactive` or
  activation-`failed`.
- `defineInstalledModuleRecord(...)` validates and freezes that ledger row so
  browser-safe consumers can fail closed on malformed install state.
- `validateInstalledModuleCompatibility(...)` compares a planner target against
  the installed row and current runtime expectations, then reports whether the
  target is a fresh install, the current bundle, or an explicit replacement.
- `planInstalledModuleLifecycle(...)` turns that compatibility result into one
  of four contract-level plans: `install`, `activate`, `deactivate`, or
  `update`. In-flight or incomplete rows fail closed with recovery guidance
  instead of being guessed through.

## Package Boundary

`@io/graph-authority` intentionally avoids a build-time dependency on
`@io/graph-module-core`. Package-local typecheck probes use self-contained graph
fixtures so `turbo build` can preserve the acyclic package graph. Cross-package
authority coverage now lives in `@io/graph-integration`.
