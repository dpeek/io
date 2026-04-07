# Graph Sync

`@io/graph-sync` is the extracted sync-core boundary for graph payloads,
cursored incremental delivery, and total sync sessions.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Use the package-adjacent docs below for package-specific semantics.
- Read `./src/index.ts` for the curated root export surface.
- Read one nearby `./src/*.test.ts` file for usage examples.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-sync`.

- [`./doc/sync-stack.md`](./doc/sync-stack.md): cross-package ownership for scopes, payloads, authoritative replay, client reconcile, and retained projections
- [`./doc/contracts.md`](./doc/contracts.md): sync scopes, payload shapes, diagnostics, and state contracts
- [`./doc/cursor.md`](./doc/cursor.md): cursor parsing, ordering helpers, and fallback classification
- [`./doc/transactions.md`](./doc/transactions.md): transaction preparation, canonicalization, snapshot materialization, and store apply behavior
- [`./doc/total-sync-session.md`](./doc/total-sync-session.md): total-sync session state, activity tracking, pull behavior, and controller helpers
- [`./doc/validation.md`](./doc/validation.md): payload normalization, incremental apply rules, and sync-specific validation results

Cross-package architecture now lives in `./doc/sync-stack.md`,
`../graph-query/doc/query-stack.md`, and
`../graph-kernel/doc/runtime-stack.md`. Start here when the question is local
to this package. Jump to the broader package docs when the question crosses
package boundaries.

## What It Owns

- sync payload and scope contracts
- opaque cursor helpers and incremental fallback semantics
- sync validation result helpers
- sync-specific transaction preparation, materialization, and apply helpers
- total sync session and controller primitives

## What It Does Not Own

- authoritative write-envelope contracts, graph write-scope literals, and canonicalization helpers
- authoritative write sessions or retained-history persistence adapters
- browser, worker, or HTTP transport wiring
- typed client conveniences such as `createSyncedGraphClient(...)`
- auth bridge, policy-version, or share-route concerns
- schema bootstrap, projection planning, or principal-aware read filtering

Kernel-owned write-envelope symbols and `GraphWriteScope` come from `@io/graph-kernel` directly.

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
- `SyncStatus` in this package is total-sync-only and excludes `@io/graph-client`'s `"pushing"` phase.
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

Run `turbo build --filter=@io/graph-sync` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-sync` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
extracted sync-core Bun tests.

The package `tsconfig.json` drives the normal `tsgo` build and emits `./out`.

The intended first-read contract artifact for agents is `./out/index.d.ts`.
