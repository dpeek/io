---
name: Graph sync stack
description: "Cross-package ownership for scopes, payloads, authoritative replay, and retained projections centered on @io/graph-sync."
last_updated: 2026-04-03
---

# Graph sync stack

## Read this when

- the question spans `@io/graph-kernel`, `@io/graph-sync`,
  `@io/graph-authority`, `@io/graph-client`, `@io/graph-projection`, or
  host-owned transport wiring
- you need the shared scope, replay, or fallback contract before changing code
- you want the owning package doc before changing a sync-related area

## Main source anchors

- `../src/index.ts`: package-root sync-core surface
- `../../graph-kernel/src/tx.ts`: authoritative write-envelope and snapshot
  diff contract
- `../../graph-authority/src/session.ts`: authoritative replay generation and
  total or incremental payload creation
- `../../graph-client/src/sync.ts`: pending-write replay and client reconcile
  on top of sync-core
- `../../graph-projection/src/index.ts`: module scope, retained projection,
  and invalidation contracts
- `../../app/src/web/lib/server-routes.ts`: app-owned sync route wiring

## What this doc owns

- the cross-package ownership map for the shipped sync stack
- stable compatibility seams between kernel write envelopes, sync payloads,
  authoritative replay, client reconcile, and retained projections
- redirects to the package-local docs that own current runtime behavior

It does not own HTTP retries, Worker lifecycle, Durable Object storage, or
historical design notes.

## Current ownership

- `@io/graph-kernel` owns authoritative write-envelope contracts,
  canonicalization, and snapshot-diff helpers.
- `@io/graph-sync` owns sync scopes, payload contracts, fallback vocabulary,
  cursor helpers, validation, and the transport-neutral total-sync session.
- `@io/graph-authority` owns authoritative apply, retained-history replay,
  total payload creation, and incremental delivery from one authoritative
  store.
- `@io/graph-client` owns pending local write replay, `"pushing"` status, and
  the client reconcile layer built on top of sync-core.
- `@io/graph-projection` owns named module scope contracts, retained
  projection compatibility metadata, provider registries, dependency keys, and
  invalidation event contracts.
- host runtime code owns HTTP routes, Worker composition, Durable Object
  storage, live routers, and retry policy.

## Stable contracts

### Requested scope versus delivered scope

Requested scope and delivered scope are intentionally different contracts.

Requested scope is what the caller asks for:

- graph scope: `{ kind: "graph" }`
- module scope request: `{ kind: "module", moduleId, scopeId }`

Delivered scope is what the authority actually serves:

- graph scope stays `{ kind: "graph" }`
- module scope adds:
  - `definitionHash`
  - `policyFilterVersion`

Important rule:

- callers request by module and scope id
- authorities deliver a stronger identity that freezes scope-definition and
  policy compatibility for later incremental apply

`@io/graph-projection` owns the named module scope definitions and request or
delivered scope helpers. `@io/graph-sync` owns the payload shape that carries
those scopes.

### Payload shapes

The shared sync-core contract stays bounded:

- total payloads for bootstrap or recovery
- incremental payloads for successful replay after `after`
- incremental fallback payloads for explicit recovery-only cases

Stable rules:

- an empty incremental result without `fallbackReason` is still a successful
  pull
- a fallback result keeps `transactions: []` and is not a successful apply
- graph-scoped totals are expected to be `complete`
- module-scoped totals may be `incomplete` because the scope intentionally
  omits unrelated data

### Fallback and recovery rules

Graph scope uses only:

- `unknown-cursor`
- `gap`
- `reset`

Module scope may also use:

- `scope-changed`
- `policy-changed`

Important rule:

- fallback is a recovery signal, not an implicit empty incremental success
- incremental apply must stay on the active delivered scope identity
- changing `moduleId`, `scopeId`, `definitionHash`, or `policyFilterVersion`
  requires recovery, not a silent scope swap or widen

`@io/graph-sync` owns the fallback vocabulary. `@io/graph-projection` owns the
module-scope definitions and registrations that explain when a scope should
report definition or policy drift.

### Authoritative replay contract

`GraphWriteTransaction.id` is the shared idempotency key from kernel through
authority and sync.

Stable rules:

- reusing a transaction id with identical canonical operations replays the
  accepted authoritative result
- reusing that id for different operations is invalid
- `replayed: true` appears only on the direct replay acknowledgement returned
  by authority apply
- retained history and incremental delivery keep the original accepted result
  with `replayed: false`
- retained-history windows may be unbounded or count-based, and callers older
  than the retained base cursor must recover with total sync

`@io/graph-authority` owns authoritative replay generation.
`@io/graph-sync` owns validation and apply behavior for the shared payloads.

### Session layering

The session split is deliberate:

- `@io/graph-sync` owns total payload apply, incremental apply, delivered
  state, and recent sync activities
- `@io/graph-client` layers local pending-write replay and client-only
  `"pushing"` state on top of that total-sync session
- `@io/graph-authority` owns incremental generation from retained authoritative
  history

Do not move client-local pending queue or push retry behavior into
`@io/graph-sync`.
Do not move authoritative replay generation into `@io/graph-client`.

### Retained projections and invalidation

Retained projections are rebuildable read models, not authoritative source of
truth.

Cross-package rules:

- `@io/graph-projection` owns retained compatibility metadata keyed by
  `{ projectionId, definitionHash }`
- missing retained state and incompatible retained state are distinct outcomes
- dependency keys are conservative freshness signals; false positives are
  acceptable but false negatives are not
- invalidation events are freshness or routing signals, not authoritative
  change logs

Storage tables, rebuild execution, and live delivery queues stay in host
runtime code or workflow-local code above the shared projection package.

### Transport boundary

HTTP, Worker, CLI, and live-router behavior stay out of the shared sync-core
packages.

That means:

- URL encoding or decoding belongs with transport helpers
- Durable Object persistence belongs with the app-owned authority storage path
- live invalidation registration and queue draining belong with host runtime
  code
- retry policy, backoff, and auth bridging stay consumer-owned

## Where current details live

- `./contracts.md`: payloads, scope identity, diagnostics, and shared state
- `./cursor.md`: cursor parsing and fallback classification
- `./transactions.md`: sync-owned transaction materialization and apply helpers
- `./validation.md`: total, incremental, and write-result validation rules
- `./total-sync-session.md`: transport-neutral total session behavior
- `../../graph-authority/doc/write-session.md`: authoritative apply, replay,
  retained history, and total or incremental payload creation
- `../../graph-client/doc/synced-client.md`: pending-write replay, flush, and
  client reconcile
- `../../graph-projection/doc/module-read-scopes.md`: named module scope
  definitions and registrations
- `../../graph-projection/doc/projections-and-retained-state.md`: retained
  projection compatibility and provider registries
- `../../graph-projection/doc/dependency-keys-and-invalidation.md`:
  dependency keys and invalidation events

## Related docs

- `../../graph-query/doc/query-stack.md`: query runtime, installed surfaces,
  and stale container recovery
- `../../graph-kernel/doc/runtime-stack.md`: durable engine boundaries
- `../../../doc/branch/03-sync-query-and-projections.md`: broader sync and
  projection design direction

Keep this doc narrow. Current-state package behavior belongs in the package
docs listed above.
