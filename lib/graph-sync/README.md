# Graph Sync

`@io/graph-sync` is the extracted sync-core boundary for graph payloads,
cursored incremental delivery, and total sync sessions.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Read `./src/index.ts` for the curated root export surface.
- Read `./src/index.test.ts` for package-level usage examples.

## What It Owns

- sync payload and scope contracts
- opaque cursor helpers and incremental fallback semantics
- sync validation result helpers
- sync-specific transaction preparation, materialization, and apply helpers
- total sync session and controller primitives

## What It Does Not Own

- authoritative write-envelope contracts, write-scope literals, and canonicalization helpers
- authoritative write sessions or retained-history persistence adapters
- browser, worker, or HTTP transport wiring
- typed client conveniences such as `createSyncedTypeClient(...)`
- auth bridge, policy-version, or share-route concerns
- schema bootstrap, projection planning, or principal-aware read filtering

Kernel-owned write-envelope symbols come from `@io/graph-kernel` directly.

## Common Workflows

- Build a bootstrap payload: `createTotalSyncPayload`
- Describe incremental delivery: `createIncrementalSyncPayload`
- Signal a required reset: `createIncrementalSyncFallback`
- Validate transport input: `validateTotalSyncPayload`, `validateIncrementalSyncResult`
- Derive write envelopes from snapshots: `createGraphWriteTransactionFromSnapshots` from `@io/graph-kernel`
- Apply payloads to a store: `createTotalSyncSession`

## Important Semantics

- Cursor strings are opaque to callers. Persist them and compare them for equality only.
- An empty incremental payload is still a successful pull when `fallbackReason` is absent.
- `fallbackReason` means incremental apply must recover with a total refresh.
- Module scope identity includes `moduleId`, `scopeId`, `definitionHash`, and `policyFilterVersion`.
- `GraphWriteTransaction.id` is the idempotency key for authoritative replay semantics.
- `SyncStatus` in this package is total-sync-only and excludes the runtime shim's `"pushing"` phase.
- Diagnostics describe retained-history context only. They do not change apply rules by themselves.

## Public API

`@io/graph-sync` exposes a single public entrypoint from `./src/index.ts`.
Everything intended for consumers is re-exported from the package root.

- sync scopes, request-scope helpers, payloads, diagnostics, and state contracts
- `createTotalSyncPayload`, `createIncrementalSyncPayload`, `createIncrementalSyncFallback`
- `createModuleSyncScope`, `createModuleSyncScopeRequest`
- `createTotalSyncSession`, `createTotalSyncController`
- cursor helpers from `cursor`
- sync-owned transaction materialization/apply helpers from `transactions`
- package-owned validation helpers from `validation`

## Build Output

Run `bun run build` in this package to emit `./out`.
Run `bun test` in this package to execute the extracted sync-core unit tests.

Tests stay colocated in `./src`, but the build uses `tsconfig.build.json` so
`*.test.ts` files are not emitted into `./out`.
