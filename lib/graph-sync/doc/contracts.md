---
name: Graph sync contracts
description: "Sync scopes, payload shapes, diagnostics, and state contracts in @io/graph-sync."
last_updated: 2026-04-02
---

# Graph sync contracts

## Read this when

- you are changing the public sync payload contract
- you need to reason about graph scope versus module scope behavior
- you are touching sync state, diagnostics, or activity records

## Main source anchors

- `../src/contracts.ts`: public types, constructors, clone helpers, and equality helpers
- `../src/contracts.test.ts`: scoped fallback vocabulary coverage
- `../src/index.ts`: package-root export surface

## Scope model

- `graphSyncScope` is the singleton whole-graph scope.
- `ModuleSyncScopeRequest` is the caller request shape:
  - `kind`
  - `moduleId`
  - `scopeId`
- `ModuleSyncScope` is the materialized delivered scope:
  - `kind`
  - `moduleId`
  - `scopeId`
  - `definitionHash`
  - `policyFilterVersion`

Request scope and delivered scope are intentionally different. The request asks for one named scope; the delivered scope freezes the exact scope identity the authority actually served.

## Payload model

- `TotalSyncPayload` is the bootstrap or recovery shape:
  - full snapshot
  - cursor
  - completeness
  - freshness
  - optional diagnostics
- `IncrementalSyncPayload` is successful incremental delivery after `after`
- `IncrementalSyncFallback` is recovery-only and keeps `transactions: []` plus explicit `fallbackReason`

An empty incremental payload without `fallbackReason` is still a successful pull.

## Fallback reasons

- Graph scope accepts `unknown-cursor`, `gap`, and `reset`.
- Module scope may also use `scope-changed` and `policy-changed`.
- `moduleSyncScopeFallbackReasons` is the bounded vocabulary for those extra module-scope recovery cases.

## Completeness and freshness

- Graph-scoped total and incremental payloads are expected to be `complete`.
- Module-scoped payloads may be `incomplete` because the scope intentionally omits unrelated data.
- `freshness` is just `current` or `stale`.

## Diagnostics

`SyncDiagnostics` carries retained-history context only:

- `retainedHistoryPolicy`
- `retainedBaseCursor`

Diagnostics explain why an incremental request may have fallen out of the replay window, but they do not change apply rules by themselves.

## Session state

`SyncState` is the total-sync session model exported by this package:

- `requestedScope` is what the caller asked for
- `scope` is the currently delivered scope
- `status` is `idle`, `syncing`, `ready`, or `error`
- `recentActivities` records recent total, incremental, fallback, and write events
- `pendingCount` is part of the shared state shape even though this package does not model client-side `"pushing"`

## Practical rules

- Treat `definitionHash` and `policyFilterVersion` as part of scope identity, not metadata that can change silently during incremental apply.
- Keep request scope and delivered scope distinct in docs and APIs.
- Use the clone helpers before re-emitting payloads or state from untrusted input.
- Keep transport and HTTP concerns outside this package; `@io/graph-sync` stops at the shared sync-core contract.
