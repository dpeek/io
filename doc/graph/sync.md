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
- one named proof scope beyond whole-graph sync: `scope.kind === "module"`

The first shipped non-graph scope is a module slice. The shared sync contract
freezes that proof shape without claiming support for every Branch 3 scope
class yet.

The current web authority now plans one concrete module scope on the authority
side:

- request:
  `{ kind: "module", moduleId: "ops/workflow", scopeId: "scope:ops/workflow:review" }`
- delivered scope:
  `{ kind: "module", moduleId, scopeId, definitionHash, policyFilterVersion }`
- current materialization:
  the `ops/workflow` entity family only, using the current request
  `AuthorizationContext.policyVersion` as the planned `policyFilterVersion`

That first scoped proof is now defined from one shared graph-owned seam:

- `../../src/graph/runtime/projection.ts` exports the public Branch 3
  `ModuleReadScopeDefinition`, `ProjectionSpec`, `DependencyKey`, and
  `InvalidationEvent` helpers
- `../../src/graph/modules/ops/workflow/projection.ts` owns the canonical
  `workflowReviewModuleReadScope`, `workflowReviewSyncScopeRequest`, and the
  first workflow projection descriptors plus the explicit
  `compileWorkflowReviewScopeDependencyKeys(...)`,
  `compileWorkflowReviewWriteDependencyKeys(...)`, and
  `createWorkflowReviewInvalidationEvent(...)` helpers for
  `project-branch-board` and `branch-commit-queue`

The first live invalidation proof is intentionally conservative:

- active registrations for `scope:ops/workflow:review` subscribe to
  `scope:ops/workflow:review`,
  `projection:ops/workflow:project-branch-board`, and
  `projection:ops/workflow:branch-commit-queue`
- any accepted write that touches an `ops/workflow` entity republishes that
  full dependency-key set as one `cursor-advanced` invalidation event with the
  workflow review scope id plus both workflow projection ids attached
- callers drain those queued events with
  `POST /api/workflow-live { kind: "workflow-review-pull", scopeId }`; a
  response with `active: false` means the live registration expired or the
  router restarted, so the caller re-registers from its current scoped cursor
  and performs an explicit scoped `/api/sync` pull. The first shipped caller
  helper for that path now lives in
  `../../src/web/lib/workflow-review-live-sync.ts`
- direct scoped-delta delivery remains a reserved contract shape; the current
  proof only emits `cursor-advanced`

Scoped cursors stay opaque to callers, but the web authority now binds them to
the planned module scope metadata. Incremental refreshes for that scope fail
explicitly with `scope-changed` or `policy-changed` when the cursor no longer
matches the current planned scope.

Total payloads carry:

- `mode: "total"`
- `scope`, which is either `{ kind: "graph" }` or:
  `{ kind: "module", moduleId, scopeId, definitionHash, policyFilterVersion }`
- `snapshot`
- `cursor`
- `completeness`
- `freshness`

Incremental payloads carry:

- `mode: "incremental"`
- `scope`, using the same graph-or-module contract as total payloads
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
- graph-scoped `fallback` remains limited to `unknown-cursor`, `gap`, and
  `reset`
- module-scoped incremental fallbacks may also report `scope-changed` or
  `policy-changed`; those are explicit recovery signals, not successful
  incremental repairs
- incremental apply must stay on the active scope identity; changing
  `moduleId`, `scopeId`, `definitionHash`, or `policyFilterVersion` requires a
  total refresh rather than a silent incremental scope swap
- cursor strings are opaque to transport callers; the shared runtime may parse
  its own authority-issued tokens internally, but downstream callers should
  only persist them, compare them for equality, and echo them back

### First Scoped Proof

The current end-to-end proof is intentionally narrow and explicit:

1. the browser requests
   `scopeKind=module&moduleId=ops/workflow&scopeId=scope:ops/workflow:review`
2. the web authority returns a scoped total payload with explicit
   `completeness`, `freshness`, `definitionHash`, `policyFilterVersion`, and
   an opaque scoped cursor
3. later scoped refreshes must reuse that same requested scope; if the planned
   scope hash or policy version no longer matches, the authority returns an
   incremental fallback with `transactions: []` plus `scope-changed` or
   `policy-changed`
4. the client keeps the existing scoped cache readable but stale, records the
   fallback, and recovers with a new whole-graph total request
   `scopeKind=graph`; recovery is never a silent incremental widen

That flow is the baseline proof covered today across shared sync validation,
client apply behavior, HTTP client transport, and the durable `/api/sync`
browser route.

The current live workflow proof layers on top of that scoped sync baseline:

1. a scoped caller registers the current workflow-review cursor through
   `POST /api/workflow-live { kind: "workflow-review-register", cursor }`
2. accepted workflow-affecting writes publish one conservative
   `cursor-advanced` invalidation from the authority write hook and fan it out
   to each active registration whose workflow-review dependency keys overlap
3. the caller drains queued invalidations through
   `POST /api/workflow-live { kind: "workflow-review-pull", scopeId }`
4. when a drained event reports `delivery.kind === "cursor-advanced"`, the
   caller re-pulls the same workflow-review scope over `/api/sync` instead of
   widening to `scopeKind=graph`
5. if `workflow-review-pull` reports `active: false`, the caller re-registers
   from its current scoped cursor and performs that same scoped `/api/sync`
   pull; router loss or expiry never requires data repair or implicit
   whole-graph resync. `createWorkflowReviewLiveSync(...)` is the current
   shipped seam that packages that register, pull, and scoped re-pull flow for
   workflow-review callers.

## Current Session APIs

### Authoritative side

- `createAuthoritativeGraphWriteSession(store, namespace)`
- `createJsonPersistedAuthoritativeGraph(store, namespace, { path, ... })`
- `createPersistedAuthoritativeGraph(store, namespace, { storage, ... })`
- `createJsonPersistedAuthoritativeGraphStorage(path, namespace)`
- `apply(transaction)`
- `getBaseCursor()`
- `getCursor()`
- `getRetainedHistoryPolicy()`
- `createSyncPayload({ freshness?, authorizeRead? })`
- `getChangesAfter(cursor?)`
- `getIncrementalSyncResult(after?, { freshness?, authorizeRead? })`
- `getHistory()`

The current authority session already treats transaction ids as idempotency keys and emits monotonic cursors.
The persisted authority helper layers restart hydration, per-transaction durable commits, explicit snapshot persistence, retained history recovery, legacy snapshot rewrite, and rollback-on-durable-write-failure on top of that session model without changing the sync payload shapes clients consume.
Retained history is now governed by one explicit shared runtime policy surface:
`writeHistory.retainedHistoryPolicy`, mirrored by `getRetainedHistoryPolicy()`.
The shipped baseline remains count-based pruning via
`{ kind: "transaction-count", maxTransactions }`; `kind: "all"` keeps the
retained suffix unbounded.
Total and incremental sync payloads may also carry `diagnostics` with the
current `retainedHistoryPolicy` plus `retainedBaseCursor`, so callers can see
which retained window produced a `gap`, `reset`, or hidden-only cursor
advance without re-deriving authority state from transport-local guesses.
Legacy persisted histories that predate `writeScope` or
`retainedHistoryPolicy` are normalized on load and rewritten, so restarted
diagnostics are compatibility-oriented rather than perfect pre-migration audit
recovery.
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

- `createSyncedTypeClient(namespace, { pull, push?, createTxId?, requestedScope? })`
- exposes `graph` for both `core` and the provided namespace, plus `sync`
- local typed mutations capture committed diffs as pending `GraphWriteTransaction`s
- `sync.flush()` pushes queued writes
- `sync.sync()` pulls authoritative state
- `sync.getPendingTransactions()` and `sync.getState()` expose queue and delivery state
- `SyncState.requestedScope` preserves the active graph-or-module scope request even before a total snapshot arrives
- `SyncState.fallback` retains the last recovery-only incremental fallback so callers can see scoped `scope-changed` or `policy-changed` failures without silently widening the cache
- `SyncState.diagnostics` retains the last authority-published retained-window
  metadata, so UI and transport consumers can show the current base cursor and
  retention policy alongside fallback state

## Ownership Boundary

- `graph` owns the total/incremental payload contracts, cursor progression rules, fallback semantics, and the persisted-authority history that feeds those contracts after restart.
- Consumer packages own transport and endpoint policy: when to call `createSyncPayload()` or `getIncrementalSyncResult(...)`, how to expose them over HTTP or another transport, how to construct any `authorizeRead` callback from request-local auth context, and what auth wraps those endpoints.
- The current web transport proof uses one shared HTTP sync-request shape on
  `GET /api/sync`: optional `after`, plus an explicit scope request via either
  `scopeKind=graph` or
  `scopeKind=module&moduleId=ops/workflow&scopeId=scope:ops/workflow:review`.
- `createHttpGraphClient(..., { requestedScope })` now forwards that same
  explicit graph-or-module request on both bootstrap and incremental refreshes,
  so whole-graph recovery stays available without relying on an implicit
  missing-param fallback.
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
- module-scoped proofs can now carry explicit `scopeId`, `definitionHash`, and
  `policyFilterVersion`, plus `scope-changed` and `policy-changed` recovery
  reasons
- persisted authoritative runtimes can resume cursor progression from retained write history after restart
- unusable retained history is rewritten as a reset baseline instead of partially replayed

## Current Failure Model

- invalid local mutations fail before a transaction is queued
- invalid authoritative payloads or write results leave local state unchanged
- failed `flush()` calls preserve queued writes and surface `GraphSyncWriteError`
- incremental fallback results do not silently repair state; callers must recover via total sync
- failed persisted-authority saves roll back the in-memory authoritative write session instead of leaving a half-committed durable state

## Offline Recovery Expectations

- retained history may survive restart and still deliver an incremental result
  with `transactions: []` when the authority cursor advanced only through
  hidden or filtered writes
- stale, missing, pruned, or reset cursors stay explicit: authorities return an
  incremental `fallback` such as `unknown-cursor`, `gap`, or `reset` instead of
  widening scope or repairing incrementally
- clients keep the last readable cache and mark sync state as stale/error until
  the caller performs a new total sync; recovery is never implicit
- the HTTP client, example runtime, persisted-authority helper, and Durable
  Object adapter all follow that same contract so offline cursor handling stays
  transport-independent

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
