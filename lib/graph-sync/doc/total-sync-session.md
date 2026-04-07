---
name: Graph sync total session
description: "Total-sync session state, activity tracking, pull behavior, and controller helpers in @io/graph-sync."
last_updated: 2026-04-02
---

# Graph sync total session

## Read this when

- you are changing `createTotalSyncSession()` or `createTotalSyncController()`
- you need to understand sync state transitions or recent activity tracking
- you are wiring a transport source on top of the sync-core session

## Main source anchors

- `../src/session.ts`: total-sync session, controller, and simple total-payload helper
- `../src/session.test.ts`: requested-scope, activity, and error-state coverage
- `../src/contracts.ts`: exported session and controller types

## What this layer owns

- applying total payloads
- applying incremental results
- applying authoritative write acknowledgements directly
- tracking requested scope, delivered scope, cursor, freshness, and recent activities
- exposing a transport-neutral `pull()` or `sync()` seam

It does not own HTTP, worker, browser, or authority routing.

## Requested scope versus delivered scope

- `requestedScope` stays what the caller asked for
- `scope` is what the last applied payload actually delivered

That distinction matters for module-scoped flows where the authority materializes `definitionHash` and `policyFilterVersion`.

## Apply paths

- `apply(totalPayload)` validates, optionally merges `preserveSnapshot`, replaces the store, and records a `total` activity
- `apply(incrementalResult)` validates incremental rules, rejects fallback-as-success, materializes each transaction over a validation store, replaces the store, and records an `incremental` activity
- `applyWriteResult()` applies one authoritative write result directly and records a `write` activity

## Pull behavior

- `pull(source)` publishes `status: "syncing"` first
- it clones current state and hands that to the transport-neutral source callback
- successful payloads go back through the same apply paths
- thrown errors mark the session `status: "error"` and `freshness: "stale"`
- if the fetched incremental result carried a fallback reason, that reason is preserved on the error state when apply fails

## Activity tracking

Recent activities are capped through `appendSyncActivity()` and currently keep the last 10 entries.

Kinds:

- `total`
- `incremental`
- `fallback`
- `write`

Incremental activity records tx ids and write scopes; write activity records replay status.

## Controller helper

- `createTotalSyncController()` is the thin convenience wrapper around one session plus a fixed `pull` source
- `sync()` just delegates to `session.pull(options.pull)`

## Practical rules

- Keep fallback handling explicit. A fallback is not a successful empty incremental apply.
- Reject incremental scope swaps instead of silently widening or retargeting the session.
- Use `requestedScope` for caller intent and `scope` for applied authority state.
- Keep transport retries and backoff policy outside this package.
