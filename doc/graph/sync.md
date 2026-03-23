# Graph Sync

## Purpose

This document is the entry point for agents working on sync payloads, authoritative write replay, or synced client behavior.

## Implementation Layout

The public runtime entry surface remains `../../src/graph/runtime/sync.ts`.
The internal implementation is now split by concern under `../../src/graph/runtime/sync/`:

- `contracts.ts`: public sync contracts, state types, clone helpers, and activity helpers
- `transactions.ts`: graph write transaction derivation, canonicalization, and snapshot materialization
- `validation.ts`: payload/result validation plus total and incremental apply preparation
- `authority.ts`: authoritative write session state, history replay, and incremental delivery
- `session.ts`: total-sync sessions, controller wiring, and the synced typed client

## Current Contract

The current engine already supports two authoritative delivery shapes in `../../src/graph/runtime/sync.ts`:

- total payloads for bootstrap and recovery
- incremental payloads for ordered authoritative write delivery after a cursor
- transaction envelopes keyed by stable idempotency ids
- authoritative write acknowledgements that retain `writeScope` and explicit
  replay state

Total payloads carry:

- `mode: "total"`
- `scope: { kind: "graph" }`
- `snapshot`
- `cursor`
- `completeness`
- `freshness`

Incremental payloads carry:

- `mode: "incremental"`
- `scope: { kind: "graph" }`
- `after`
- `transactions`
- `cursor`
- `completeness`
- `freshness`
- optional `fallback`

Stable delivery rules:

- `GraphWriteTransaction.id` is the idempotency key; reusing it with identical
  canonical operations replays the accepted result, and reusing it for
  different operations is invalid
- `AuthoritativeGraphWriteResult.replayed` is only `true` on the direct replay
  acknowledgement returned from `apply(...)`; retained history and incremental
  pull delivery keep the original accepted result with `replayed: false`
- an incremental result with `transactions: []` and no `fallback` is still a
  successful pull: `cursor === after` means no new authoritative change,
  while `cursor !== after` means the cursor advanced without any replicated
  writes in scope
- `fallback` is reserved for `unknown-cursor`, `gap`, and `reset`, and always
  means the caller must recover with total sync
- cursor strings are opaque to transport callers; the shared runtime may parse
  its own authority-issued tokens internally, but downstream callers should
  only persist them, compare them for equality, and echo them back

## Current Session APIs

### Authoritative side

- `createAuthoritativeGraphWriteSession(store, namespace)`
- `createJsonPersistedAuthoritativeGraph(store, namespace, { path, ... })`
- `createPersistedAuthoritativeGraph(store, namespace, { storage, ... })`
- `createJsonPersistedAuthoritativeGraphStorage(path, namespace)`
- `apply(transaction)`
- `getBaseCursor()`
- `getCursor()`
- `createSyncPayload({ freshness?, authorizeRead? })`
- `getChangesAfter(cursor?)`
- `getIncrementalSyncResult(after?, { freshness?, authorizeRead? })`
- `getHistory()`

The current authority session already treats transaction ids as idempotency keys and emits monotonic cursors.
The persisted authority helper layers restart hydration, per-transaction durable commits, explicit snapshot persistence, retained history recovery, legacy snapshot rewrite, and rollback-on-durable-write-failure on top of that session model without changing the sync payload shapes clients consume.
Legacy persisted histories that predate `writeScope` are normalized to `client-tx` on load, so restarted diagnostics are compatibility-oriented rather than perfect pre-migration audit recovery.
When provided, `authorizeRead` runs after transport visibility filtering for
both total snapshots and incremental transaction materialization, so denied
predicates are omitted instead of masked.
The public runtime surface also exports `authoritativeWriteScopes`,
`incrementalSyncFallbackReasons`, `isAuthoritativeWriteScope(...)`, and
`isIncrementalSyncFallback(...)` so downstream callers can branch on the shared
contract without copying raw literal lists.

### Client/session side

- `createTotalSyncSession(store, { preserveSnapshot, validate, validateWriteResult })`
- `apply(payload)`
- `applyWriteResult(result)`
- `pull(source)`
- `getState()`
- `subscribe(listener)`

`SyncState.recentActivities` is the shared runtime-diagnostics surface for
authoritative sync events:

- `write` entries include the acknowledged `writeScope`
- `incremental` entries include `txIds` plus aligned `writeScopes` so callers
  can tell which pulled transactions came from `client-tx` versus
  `server-command` without re-parsing raw transactions

### Typed synced client

- `createSyncedTypeClient(namespace, { pull, push?, createTxId? })`
- exposes `graph` for both `core` and the provided namespace, plus `sync`
- local typed mutations capture committed diffs as pending `GraphWriteTransaction`s
- `sync.flush()` pushes queued writes
- `sync.sync()` pulls authoritative state
- `sync.getPendingTransactions()` and `sync.getState()` expose queue and delivery state

## Ownership Boundary

- `graph` owns the total/incremental payload contracts, cursor progression rules, fallback semantics, and the persisted-authority history that feeds those contracts after restart.
- Consumer packages own transport and endpoint policy: when to call `createSyncPayload()` or `getIncrementalSyncResult(...)`, how to expose them over HTTP or another transport, how to construct any `authorizeRead` callback from request-local auth context, and what auth wraps those endpoints.
- The web Worker is one such consumer: `src/web/lib/graph-authority-do.ts` now owns the SQLite-backed Durable Object storage path, while `src/web/lib/authority.ts` stays focused on the shared web authority behavior and request handlers.
- The current web authority layer now includes a thin consumer-owned command
  dispatcher in `src/web/lib/authority.ts` over a shared scoped command seam,
  so routes can lower supported `/api/commands` payloads into the shared write
  boundary without binding directly to one bespoke method entrypoint. Each
  supported command declares its authoritative write scope explicitly, and
  staged authority-local side effects registered there are unwound for any
  failure before durable commit.
- That same web authority write and command path now consumes the shared
  `authorizeWrite(...)` and `authorizeCommand(...)` evaluators, fails closed on
  stale `AuthorizationContext.policyVersion`, and treats predicates without an
  explicit current web-graph policy descriptor as authority-only for the
  current proof so downstream sync/UI work can target one stable deny contract.

## Current Behavior

- schema is bootstrapped locally before authoritative data arrives
- synced clients hydrate both local and authoritative stores from a cached bootstrapped schema snapshot
- preserved bootstrap schema facts are layered back in at authoritative total apply
- incoming total payloads are validated before replace
- incoming write results and incremental batches are validated before apply
- successful total replace clears pending local transactions
- successful write reconciliation or incremental apply keeps local optimistic replay coherent
- fallback reasons already distinguish `unknown-cursor`, `gap`, and `reset`
- persisted authoritative runtimes can resume cursor progression from retained write history after restart
- unusable retained history is rewritten as a reset baseline instead of partially replayed

## Current Failure Model

- invalid local mutations fail before a transaction is queued
- invalid authoritative payloads or write results leave local state unchanged
- failed `flush()` calls preserve queued writes and surface `GraphSyncWriteError`
- incremental fallback results do not silently repair state; callers must recover via total sync
- failed persisted-authority saves roll back the in-memory authoritative write session instead of leaving a half-committed durable state

## Roadmap

- persistence backends beyond the current JSON snapshot-plus-history implementation
- live transport layered on top of the current pull/result shapes
- query-scoped partial sync and query-aware completeness
- richer conflict handling than retry-or-recover-by-total-snapshot

## Future Work Suggestions

1. Add one concrete sequence diagram for local mutation -> queue -> authority apply -> peer incremental pull.
2. Document the intended public stability of cursor formats and fallback reasons.
3. Add a short section on how `preserveSnapshot` should be captured and why it matters.
4. Document the contract expected from non-JSON persistence adapters once another backend exists.
5. Capture which conflict classes should remain “recover by snapshot” versus graduate to first-class protocols.
