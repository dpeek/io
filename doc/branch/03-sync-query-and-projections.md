# Branch 3 Canonical: Sync, Query, And Projections

## Overview

### Mission

Turn the current whole-graph sync proof into a scope-based read runtime with
bounded queries, materialized projections, and live invalidation routing.

### Why This Is A Separate Branch

This branch carries the main correctness and scaling risk after the kernel.
Scoped sync, indexed reads, and query planning are their own platform surface,
not an implementation detail inside the web app.

### In Scope

- scope definitions and scope cursors
- principal-aware completeness semantics
- bounded query model
- materialized collection indexes
- projection runtime and rebuild rules
- live scope registration and invalidation routing
- cursor-advanced or scoped-pull live update model

### Out Of Scope

- arbitrary distributed graph scans
- full cross-graph federation planner
- module UI implementation
- auth session ownership

### Durable Contracts Owned

- scope definition model
- scope cursor and fallback semantics
- query surface contracts
- projection and index runtime contracts
- invalidation event shape

### Likely Repo Boundaries

- graph sync contracts
- future authority scope planner and projection runtime
- subscription routing layer
- synced client extensions in web

### Dependencies

- Branch 1 for transaction, cursor, and authority state contracts
- Branch 2 for policy-filtered scope semantics

### Downstream Consumers

- Branch 5 needs projection and retrieval hooks for ingestion outputs
- Branch 6 needs scoped context-bundle retrieval
- Branch 7 needs capability-aware live product views

### First Shippable Milestone

Ship one narrow scoped sync class. The current sync-contract proof freezes that
class as a module slice, plus one materialized collection index and one live
invalidation proof.

### Done Means

- the client can bootstrap a named scope instead of the whole graph
- the scope carries explicit completeness and cursor state
- live updates can advance the scope without forcing a whole-graph reload
- one collection query reads from a documented projection rather than raw
  traversal

### First Demo

Open one scoped view in the browser, mutate data from another session, and
prove the first client receives a scoped update or cursor-advanced re-pull
without full resync.

### What This Unlocks

- sharding without uncontrolled fan-out
- module-specific read surfaces in Branch 4
- performant workflow inboxes in Branch 6
- product-grade web surfaces in Branch 7

### Source Anchors

- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/09-vision-platform-architecture.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`

## 1. Purpose

This branch owns the platform read plane that sits on top of Branch 1's
authoritative graph writes and Branch 2's policy model.

It exists as a separate branch because read correctness, cache completeness,
query bounds, and live invalidation behavior are platform contracts in their
own right. They cannot remain implicit inside the web app or inside one
authority implementation if the product is expected to scale to scoped sync,
projection-backed reads, and sharded authorities.

The branch must deliver three platform outcomes:

- clients bootstrap and maintain named authorized scopes instead of whole-graph
  replicas
- collection and queue-style reads resolve through documented bounded plans or
  materialized projections
- live updates route through scope registrations and dependency-key
  invalidations without forcing whole-graph reloads

## 2. Scope

### In scope

- scope definitions for bootstrap, incremental pull, and live registration
- principal-aware completeness semantics and policy-version coupling
- bounded query planning rules
- materialized projection and collection-index contracts
- projection rebuild and checkpoint rules
- dependency-key compilation for live invalidation routing
- client-side scope cache and fallback semantics built on the existing sync
  runtime

### Out of scope

- authoritative fact writes, transaction ordering, and base cursor generation
- auth session ownership and login infrastructure
- arbitrary distributed graph scans
- UI composition and module-specific product UX
- open-ended remote federation planning
- secret storage and unseal execution

### Upstream assumptions

- Branch 1 provides stable transaction, snapshot, cursor, and shard authority
  contracts
- Branch 2 provides stable principal ids, predicate visibility rules,
  capability checks, and a policy-filter version that read planning can depend
  on
- whole-graph sync remains available as a proof and recovery surface while this
  branch graduates scoped sync

## 3. Core Model

Branch 3 owns the following read-model concepts.

### Scope definition

A scope is the unit of authorized replication, completeness, and live
registration.

```ts
type ScopeKind =
  | "graph"
  | "module"
  | "entity-neighborhood"
  | "collection"
  | "work-queue"
  | "context-bundle"
  | "share-projection";

type ScopeMaterialization = "authoritative" | "projection" | "ad-hoc";

interface ScopeDefinition {
  kind: ScopeKind;
  scopeId: string;
  principalId: string;
  definitionHash: string;
  policyFilterVersion: string;
  materialization: ScopeMaterialization;
  roots?: readonly string[];
  moduleIds?: readonly string[];
  projectionId?: string;
  query?: ReadQuery;
}
```

Responsibilities:

- name the logical slice a client is allowed to hold
- bind the slice to one principal and one policy interpretation
- give the planner enough structure to prove the read is bounded
- define whether results come from authoritative facts, a projection, or an ad
  hoc bounded plan

Lifecycle:

- `declared`: identified by caller or module manifest
- `planned`: compiled to planner inputs and dependency keys
- `hydrated`: bootstrapped into a client or server cache with explicit
  completeness
- `active`: optionally registered for live invalidation
- `stale` or `fallback-required`: no longer incrementally trustworthy

### Scope state

```ts
type ScopeCompleteness = "complete" | "incomplete";
type ScopeFreshness = "current" | "stale";
type ScopeFallbackReason =
  | "unknown-cursor"
  | "gap"
  | "reset"
  | "scope-changed"
  | "policy-changed"
  | "projection-unavailable";

interface ScopeState {
  scopeId: string;
  principalId: string;
  definitionHash: string;
  policyFilterVersion: string;
  cursor?: string;
  completeness: ScopeCompleteness;
  freshness: ScopeFreshness;
  fallback?: ScopeFallbackReason;
}
```

Responsibilities:

- record whether the local cache is a complete answer for the declared scope
- bind incremental state to one scope definition and one policy interpretation
- force explicit fallback instead of silent widening or silent repair

### Read query

Branch 3 owns the bounded read surface.

```ts
type ReadQuery =
  | { kind: "entity"; id: string }
  | {
      kind: "neighborhood";
      rootId: string;
      predicates?: readonly string[];
      depth?: number;
    }
  | {
      kind: "collection";
      indexId: string;
      filter?: Record<string, unknown>;
      order?: { field: string; direction: "asc" | "desc" };
      window?: { after?: string; limit: number };
    }
  | {
      kind: "scope";
      scopeId?: string;
      definition?: Omit<ScopeDefinition, "query">;
    };
```

Rules:

- `entity` and `neighborhood` queries may hit authoritative shard-local state
- `collection` queries must resolve through a known projection or a documented
  bounded plan
- `scope` queries bootstrap or refresh one named scope, not an arbitrary graph
  traversal

### Projection

A projection is rebuildable derived state maintained for bounded reads.

```ts
type ProjectionKind = "collection-index" | "time-range-index" | "context-bundle" | "outbound-share";

interface ProjectionSpec {
  projectionId: string;
  kind: ProjectionKind;
  definitionHash: string;
  sourceScopeKinds: readonly ScopeKind[];
  dependencyKeys: readonly string[];
  rebuildStrategy: "full" | "checkpointed";
  visibilityMode: "policy-filtered" | "share-surface";
}

interface ProjectionCheckpoint {
  projectionId: string;
  sourceCursorByShard: Readonly<Record<string, string>>;
  rebuiltAt: string;
}
```

Responsibilities:

- convert expensive or repeated graph traversals into stable read surfaces
- preserve enough checkpoint data to rebuild after restart or migration
- expose a deterministic contract for module manifests and downstream branches

Lifecycle:

- `declared`
- `building`
- `ready`
- `stale`
- `rebuilding`
- `failed`

### Dependency key

A dependency key is the invalidation unit used between authorities,
projections, and the subscription router.

Examples:

- `shard:<id>`
- `predicate:<predicateId>`
- `projection:<projectionId>`
- `scope:<scopeId>`

Dependency keys must be conservative. False positives are acceptable. False
negatives are not.

### Live scope registration

```ts
interface LiveScopeRegistration {
  registrationId: string;
  sessionId: string;
  principalId: string;
  scopeId: string;
  definitionHash: string;
  dependencyKeys: readonly string[];
  expiresAt: string;
}
```

Responsibilities:

- represent one client session's interest in one active scope
- let the subscription layer fan out invalidations without understanding raw
  browser queries
- expire safely without affecting authoritative state

## 4. Public Contract Surface

### Surface summary

| Name                                          | Purpose                                                                      | Caller                                    | Callee                             | Inputs                                                       | Outputs                                                 | Failure shape                                                                             | Stability     |
| --------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------- |
| `SyncPayload` with `scope: { kind: "graph" }` | Whole-graph bootstrap and incremental sync proof                             | current web client, tests, MCP            | current authority runtime          | cursor or none                                               | total or incremental payload                            | `unknown-cursor`, `gap`, `reset`                                                          | `stable`      |
| `ScopedSyncPayload`                           | Bootstrap or refresh one named scope                                         | browser client, MCP, module runtime       | scope planner plus authority       | `ScopeDefinition` or `scopeId`, principal, cursor            | scope snapshot or scoped transactions plus completeness | current fallback reasons plus `scope-changed`, `policy-changed`, `projection-unavailable` | `provisional` |
| `ReadQuery`                                   | Bounded read surface for entity, neighborhood, collection, or scope reads    | module runtime, web, workflow, MCP        | read planner                       | query spec plus principal context                            | typed entity data, projection rows, or scope payload    | validation error or planner rejection                                                     | `provisional` |
| `ProjectionSpec` registration                 | Declares rebuildable derived read surfaces                                   | module manifests, built-in runtime        | projection runtime                 | projection definition and dependency mapping                 | registered spec and rebuild metadata                    | registration rejection, build failure                                                     | `provisional` |
| `InvalidationEvent`                           | Notifies subscriptions and projection workers about affected dependency keys | shard authority, projection runtime       | subscription router, rebuild queue | dependency keys, source cursor, optional scoped delta handle | fan-out event or queued rebuild work                    | drop, retry, dedupe                                                                       | `provisional` |
| `LiveScopeRegistration`                       | Registers an active scope for live updates                                   | browser client or websocket/session layer | subscription router                | scope identity, dependency keys, expiry                      | registration token and expiry                           | reject, expire, or re-register required                                                   | `provisional` |
| `FederatedQuery`                              | Read across explicit remote shared surfaces                                  | future share consumers                    | future federation planner          | capability id and named remote surface                       | remote projection rows or imported snapshot             | capability denied, remote unavailable, cost rejection                                     | `future`      |

### Canonical scoped sync contract

Branch 3 extends the current sync payload shape instead of replacing it.

```ts
type SyncScope =
  | { kind: "graph" }
  | {
      kind: Exclude<ScopeKind, "graph">;
      scopeId: string;
      principalId: string;
      definitionHash: string;
      policyFilterVersion: string;
    };

type ScopedTotalSyncPayload = {
  mode: "total";
  scope: SyncScope;
  snapshot: unknown;
  cursor: string;
  completeness: ScopeCompleteness;
  freshness: ScopeFreshness;
};

type ScopedIncrementalSyncPayload = {
  mode: "incremental";
  scope: SyncScope;
  after: string;
  transactions: readonly AuthoritativeGraphWriteResult[];
  cursor: string;
  completeness: ScopeCompleteness;
  freshness: ScopeFreshness;
  fallback?: ScopeFallbackReason;
};
```

Contract rules:

- the client must treat `scope.definitionHash` and
  `scope.policyFilterVersion` as part of cursor validity
- `completeness` is always explicit; the client may not infer completeness from
  payload shape alone
- incremental scope delivery may carry authoritative transactions or a bounded
  scoped delta, but it must always remain replayable against the local scope
  cache
- ad hoc scopes may use the same payload envelope but stay pull-only until the
  dependency model is proven

### Canonical invalidation event

```ts
interface InvalidationEvent {
  eventId: string;
  graphId: string;
  sourceCursor: string;
  dependencyKeys: readonly string[];
  affectedProjectionIds?: readonly string[];
  affectedScopeIds?: readonly string[];
  delivery:
    | { kind: "cursor-advanced" }
    | { kind: "scoped-delta"; scopeId: string; deltaToken: string };
}
```

Contract rules:

- the default live behavior is `cursor-advanced`, followed by client re-pull
- `scoped-delta` is reserved for materialized scopes with deterministic local
  merge rules
- invalidations must never require the client to inspect unauthorized raw facts

Current coded proof:

- `workflow` review registrations compile to one conservative dependency
  set:
  `scope:workflow:review`,
  `projection:workflow:project-branch-board`, and
  `projection:workflow:branch-commit-queue`
- accepted writes that touch the current workflow review types publish one
  `cursor-advanced` invalidation over that same dependency set
- callers drain those invalidations from the current ephemeral router state,
  then re-pull the same workflow-review scope instead of widening to a
  whole-graph refresh
- router loss or registration expiry only affects freshness; callers recover by
  re-registering from the current scoped cursor plus scoped pull
- unrelated writes publish nothing; direct scoped deltas remain out of scope

## 5. Runtime Architecture

Branch 3 introduces four runtime components.

### Scope planner

Lives beside the current single authority runtime first, and later in the
directory or read-planner layer.

Responsibilities:

- validate that a requested scope is one of the supported scope classes
- bind the scope to a principal and current `policyFilterVersion`
- choose authoritative shard reads versus projection-backed reads
- compile the scope to dependency keys for live registration

### Projection runtime

Lives as an authority-adjacent worker or queue-driven background runtime.
The current extracted shared contract boundary for projection metadata,
dependency keys, module read scopes, invalidation types, and retained
projection compatibility lives in `@io/graph-projection`; workflow-specific
projection manifests and host-specific storage adapters stay outside it.

Responsibilities:

- build and rebuild declared projections from authoritative facts and blob
  metadata
- checkpoint rebuild progress by shard cursor
- publish invalidations when projection rows change

### Subscription router

Lives outside the core graph package.

Responsibilities:

- accept live scope registrations
- index registrations by dependency key
- fan out `InvalidationEvent`s to interested sessions
- treat registrations as ephemeral and safe to lose

### Client scope cache

Extends the current synced client model.

Responsibilities:

- keep a local cache per active scope rather than one implicit whole-graph view
- preserve completeness, freshness, cursor, and fallback state per scope
- route local typed reads over the cached scope slice

### Boundaries

- authoritative graph facts remain owned by Branch 1 authorities
- policy decisions remain owned by Branch 2 and are imported into planning and
  projection filtering
- projection rows and scope checkpoints are derived state owned by this branch
- browser runtimes never become authoritative for scope completeness or policy

## 6. Storage Model

Branch 3 does not own authoritative fact storage. It owns derived read state.

### Canonical derived records

`ProjectionSpecRecord`

- `projectionId`
- `kind`
- `definitionHash`
- `visibilityMode`
- `sourceScopeKinds`
- `dependencyKeys`
- `createdAt`

`ProjectionCheckpointRecord`

- `projectionId`
- `sourceCursorByShard`
- `rebuiltAt`
- `status`
- `lastError`

`ProjectionRowRecord`

- `projectionId`
- `rowKey`
- `sortKey`
- `entityId`
- `payload`
- `policyFilterVersion`
- `updatedAt`

`ScopeCheckpointRecord`

- `scopeId`
- `principalId`
- `definitionHash`
- `policyFilterVersion`
- `cursor`
- `completeness`
- `refreshedAt`

`LiveScopeRegistrationRecord`

- `registrationId`
- `sessionId`
- `scopeId`
- `dependencyKeys`
- `expiresAt`

### Authoritative versus derived state

- authoritative: facts, retractions, transaction history, secret handles, and
  shard cursors
- derived but retained: projection specs, checkpoints, and projection rows
- derived and optionally retained: scope checkpoints
- ephemeral: live registrations and fan-out bookkeeping

### Rebuild rules

- every projection row must be reproducible from authoritative facts, blob
  metadata, and the declared projection spec
- projection rebuild may discard all prior rows for a projection and recompute
  from checkpoints or from zero
- scope checkpoints may be discarded without data loss; clients can always
  recover from a total scope pull

### Migration expectations

- schema changes to projections must version `definitionHash`
- incompatible projection changes trigger rebuild, not data migration of old
  row payloads
- storage layout may evolve, but the external contracts around
  `projectionId`, `definitionHash`, cursors, and fallback behavior must remain
  stable once published

## 7. Integration Points

### Branch 1: Graph Kernel And Authority

- dependency direction: Branch 3 depends on Branch 1
- imported contracts: transaction envelopes, snapshot shape, monotonic cursors,
  shard or authority read entrypoints, and write acceptance events
- exported contracts: scope metadata requirements on read APIs, dependency-key
  publication expectations, projection checkpoint inputs
- mockable or provisional: single-authority planner and in-process projection
  runtime
- must be stable first: cursor continuity and authoritative replay semantics

### Branch 2: Identity, Policy, And Sharing

- dependency direction: Branch 3 depends on Branch 2
- imported contracts: principal ids, predicate visibility, capability grants,
  policy filter evaluation, share-surface rules
- exported contracts: policy-filtered scope completeness, policy-version-aware
  fallback, share-projection read surface requirements
- mockable or provisional: simple owner-only scopes
- must be stable first: planner-visible policy evaluation boundary and
  `policyFilterVersion`

### Branch 4: Module Runtime And Installation

- dependency direction: Branch 4 depends on Branch 3
- imported by Branch 4: `ProjectionSpec` registration, `ReadQuery`,
  module-declared scope classes, live invalidation registration hooks
- exported back to Branch 3: module manifest declarations for indexes,
  views, and supported scope kinds
- mockable or provisional: handwritten built-in projection declarations before
  manifest format stabilizes
- must be stable before installability is safe: projection declaration schema

### Branch 5: Blob Ingestion And Media

- dependency direction: Branch 5 depends on Branch 3
- imported by Branch 5: projection rebuild hooks for ingest outputs, collection
  queries over media/document indexes
- exported back to Branch 3: blob-derived entity and metadata conventions that
  projections can index
- mockable or provisional: one built-in media projection
- must be stable first: checkpoint and rebuild behavior around async ingest

### Branch 6: Workflow And Agent Runtime

- dependency direction: Branch 6 depends on Branch 3
- imported by Branch 6: work-queue scopes, context-bundle projections, live
  invalidations for workflow inboxes
- exported back to Branch 3: workflow-specific scope classes and projection
  requirements
- mockable or provisional: one queue projection and one context bundle
- must be stable first: bounded queue query and context-bundle semantics

### Branch 7: Web And Operator Surfaces

- dependency direction: Branch 7 depends on Branch 3
- imported by Branch 7: scoped bootstrap, scoped pull, live registration,
  projection-backed collection reads, completeness and fallback UI states
- exported back to Branch 3: UX pressure on scope lifecycle, cache behavior,
  and debuggability
- mockable or provisional: polling-only live updates
- must be stable first: scope state model exposed to clients

## 8. Main Flows

1. Bootstrap one named scope.
   Initiator: browser, MCP session, or module runtime.
   Components involved: client scope cache, scope planner, Branch 2 policy
   filter, Branch 1 authority, optional projection runtime.
   Contract boundaries crossed: `ScopeDefinition` to planner, scoped sync
   payload back to client.
   Authoritative write point: none; this is a read flow.
   Failure or fallback: unsupported scope class or missing projection returns a
   planner failure, not an unbounded graph scan.

2. Advance a scope incrementally after a remote write.
   Initiator: client pull using its last scope cursor.
   Components involved: client scope cache, authority history, scope planner.
   Contract boundaries crossed: scoped incremental sync request and response.
   Authoritative write point: Branch 1 accepted transaction history.
   Failure or fallback: `unknown-cursor`, `gap`, `reset`, `scope-changed`, or
   `policy-changed` force a scope total refresh.

3. Resolve a collection query through a projection.
   Initiator: module runtime, workflow runtime, or web surface.
   Components involved: read planner, projection runtime storage, typed client
   projector.
   Contract boundaries crossed: `ReadQuery` with `kind: "collection"` to
   projection-backed result set.
   Authoritative write point: projection rows are derived only; authoritative
   writes stay in Branch 1.
   Failure or fallback: if the projection is stale or unavailable, the planner
   may reject the query or degrade only to a documented bounded plan.

4. Register a live scope and route invalidations.
   Initiator: client after initial scope hydration.
   Components involved: subscription router, scope planner, authority event
   publisher, optional projection workers.
   Contract boundaries crossed: `LiveScopeRegistration` in, `InvalidationEvent`
   out.
   Authoritative write point: none for registration durability; registrations
   are ephemeral.
   Failure or fallback: if the registration expires or the router restarts, the
   client re-registers and re-pulls its active scopes.

5. Rebuild a projection after code or policy change.
   Initiator: deployment, manifest install, or operator action.
   Components involved: projection runtime, checkpoint store, authoritative
   facts, Branch 2 policy filter.
   Contract boundaries crossed: `ProjectionSpec` registration, rebuild job, and
   invalidation publication.
   Authoritative write point: projection checkpoint and row storage only.
   Failure or fallback: rebuild failure must not corrupt authoritative facts; a
   failed projection remains unavailable until rebuilt or rolled back.

## 9. Invariants And Failure Handling

### Invariants

- a scope cursor is only valid together with its `scopeId`, `definitionHash`,
  `principalId`, and `policyFilterVersion`
- a scope marked `complete` is a complete answer for that principal and scope
  definition, not a best-effort cache
- no read contract may widen itself from a named scope to the full graph as a
  recovery shortcut
- every collection query must map to a known projection or a documented bounded
  plan
- projection rows never become authoritative source of truth
- projection rebuild from authoritative state must be possible after row loss
- invalidation dependency keys are conservative and must not miss affected
  scopes
- live registration loss may degrade freshness but must not corrupt data or
  visibility

### Important failure modes

`unknown-cursor`, `gap`, or `reset`

- what fails: incremental replay continuity
- what must not corrupt: local cached scope contents and authoritative history
- retry or fallback: force total scoped refresh
- observability needed: fallback reason, cursor pair, scope id

`scope-changed` or `policy-changed`

- what fails: previous completeness guarantee
- what must not corrupt: local cache may remain readable only until replaced,
  but it may not be treated as current
- retry or fallback: total scoped refresh under the new definition or policy
- observability needed: old/new hashes and policy version

`projection-unavailable` or projection rebuild failure

- what fails: collection query service level
- what must not corrupt: authoritative facts, unrelated projections, and scope
  cursor continuity
- retry or fallback: rebuild or reject query; do not silently raw-scan across
  shards
- observability needed: projection id, checkpoint, last rebuild error

Dropped or late invalidation events

- what fails: live freshness, not correctness
- what must not corrupt: scope completeness and cursor validity
- retry or fallback: periodic scoped pull and re-registration
- observability needed: delivery lag, missed-heartbeat rate, router restarts

## 10. Security And Policy Considerations

- scope planning must run after principal resolution and before any query or
  projection result leaves authority-owned storage
- projections may only materialize fields that are safe for the target
  visibility mode; hidden predicates and secret plaintext never appear in
  browser-visible projection rows
- `policyFilterVersion` is part of read correctness, not just observability; a
  policy change can invalidate scope and projection assumptions
- live registrations must not reveal unauthorized scope contents to other
  sessions; only opaque scope ids, dependency keys, and session routing data
  should enter the router
- a client is allowed to know that its scope became stale; it is not allowed to
  inspect the raw authoritative changes that caused that staleness if those
  changes are not in its visible slice
- share projections remain the only safe future contract for cross-graph reads;
  raw remote predicate traversal stays out of scope

## 11. Implementation Slices

### Slice 1: Named scoped sync over the current single authority

- goal: extend the current `graph` sync contract to support one named scope
  class; the current proof freezes that class as a module slice
- prerequisite contracts: Branch 1 cursor continuity, Branch 2 owner-only or
  simple capability filtering
- what it proves: a client can bootstrap and refresh one non-graph scope with
  explicit completeness
- current shipped proof:
  `workflow` review scope over `/api/sync`, with delivered
  `definitionHash`, `policyFilterVersion`, and scoped cursor identity
- recovery contract: scoped incremental fallback is explicit
  (`scope-changed` or `policy-changed`) and recovery stays a new total sync,
  with whole-graph bootstrap kept as the current browser proof path
- what it postpones: sharding, generic planners, federated reads

### Slice 2: One projection-backed collection query

- goal: add one materialized collection index and route one collection query
  through it
- prerequisite contracts: scope definition, projection spec, checkpoint model
- what it proves: collection reads no longer depend on raw traversal
- what it postpones: full query planner and secondary projection families

Current shipped workflow proof:

- `workflow` now proves one projection-backed read surface through
  `ProjectBranchScope` and `CommitQueueScope`
- each workflow read rebuilds from authoritative workflow, repository, and
  session state, reports `projectedAt` plus `projectionCursor`, and keeps
  pagination fail-closed with `projection-stale`
- retained projection rows and checkpoints now persist beside the authority so
  restart can hydrate the workflow read proof from derived durable state when
  the retained version is compatible
- retained state remains derived-only. Missing or incompatible retained
  workflow projection state must rebuild from authoritative graph facts instead
  of widening scope or treating the retained rows as source of truth
- callers recover from `projection-stale` by discarding the pagination cursor
  and rereading from the first page of the rebuilt projection

### Slice 3: Live scope registration plus cursor-advanced invalidation

- goal: register one active scope and send `cursor-advanced` invalidations from
  accepted writes
- prerequisite contracts: dependency-key compilation and scoped cursor state
- what it proves: live updates do not require whole-graph polling
- what it postpones: direct scoped deltas for arbitrary scopes

### Slice 4: Queue-driven projection rebuild and shard-aware planning

- goal: move projection maintenance off the hot write path and prepare for
  directory plus shard topology
- prerequisite contracts: stable checkpoint and invalidation event shapes
- what it proves: the read plane survives restart, lag, and rebuild scenarios
- what it postpones: remote federation and cross-graph query planning

## 12. Open Questions

- What exact shape should `policyFilterVersion` take so it is cheap to compare
  but still invalidates stale scope assumptions correctly?
- Which scope classes should be allowed to emit direct deltas instead of only
  `cursor-advanced` invalidations?
- Should projection rows be per-principal, per-capability, or globally
  materialized with row-level post-filtering for the first implementation?
- Where should scope checkpoints live in the pre-sharding single-authority
  phase: client-only, authority-retained, or both?
- How fine-grained do dependency keys need to be before invalidation fan-out
  becomes too noisy?
- Which ad hoc queries, if any, should be eligible for live registration
  instead of remaining pull-only?

## 13. Recommended First Code Targets

- `lib/graph-sync/src/contracts.ts` and `doc/graph/sync.md`:
  extend `SyncScope`, completeness, and fallback semantics beyond whole-graph
- `lib/graph-client/src/http.ts` and `src/web/lib/server-routes.ts`: add
  scoped bootstrap and scoped incremental pull transport shapes
- `lib/graph-client/src/graph.ts`, `lib/graph-client/src/core.ts`, and
  `lib/graph-client/src/query.ts`: keep typed local entity and neighborhood
  reads, but separate them from projection-backed collection queries
- `src/web/lib/graph-authority-do.ts`: publish dependency-key invalidations and
  retain derived projection/checkpoint state beside the authority
- `src/graph/runtime/` new surfaces for scope planning and projection runtime,
  with tests modeled after the existing sync and authority suites
