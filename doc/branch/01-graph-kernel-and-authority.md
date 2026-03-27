# Graph Kernel And Authority Canonical Contract

## Overview

### Mission

Stabilize the graph kernel and authoritative runtime so every other branch can
build on one durable data, validation, and transaction model.

### Why This Is A Separate Branch

Every other workstream depends on the kernel contracts. If ids, facts,
transactions, authoritative persistence, or secret-handle semantics keep
moving, all downstream branches will thrash.

### In Scope

- stable ids, schema authoring, and schema bootstrap
- append-oriented fact model and retraction semantics
- local and authoritative validation lifecycle
- authoritative write, transaction, and session model
- cursor continuity and replay contracts
- persisted authority runtime
- SQLite-backed Durable Object persistence for the current single-graph proof
- secret-handle and secret side-storage split

### Out Of Scope

- scope-based sync planner
- Better Auth integration
- module installation
- graph-native workflow productization
- end-user web UX

### Durable Contracts Owned

- `Edge` or fact model
- field-authority metadata and write-scope semantics
- transaction, cursor, and sync envelopes
- authoritative write session and persisted-authority APIs
- persistence backend boundary
- secret handle versus plaintext boundary

### Likely Repo Boundaries

- `lib/app/src/graph/`
- `lib/app/src/graph/runtime/`
- authority and storage runtime packages that split out from the current graph
  runtime
- the current Durable Object authority path in `lib/app/src/web/lib/`

### Dependencies

- no new platform dependencies beyond the current repo proof

### Downstream Consumers

- Branch 2 needs authoritative policy enforcement hooks
- Branch 3 needs stable transaction and cursor semantics
- Branches 4, 5, and 6 need stable graph types and write contracts
- Branch 7 needs a stable client-facing graph runtime

### First Shippable Milestone

This milestone is already shipped: blob-style snapshot rewrites are gone and
the single-graph proof now uses commit-oriented SQLite-backed authority
persistence while keeping the current developer flow working.

### Done Means

The current baseline proves:

- accepted writes persist as ordered rows rather than full snapshot rewrites
- restarts preserve graph state, cursor continuity, and secret side storage
- current total and incremental sync behavior still works
- the contract is documented well enough for downstream branches to target

### First Demo

Create, update, retract, restart the authority, and prove the graph and secret
fields reload correctly without replay drift.

### What This Unlocks

- scoped sync and projection work in Branch 3
- module install and migration runtime in Branch 4
- blob-backed entity families in Branch 5
- graph-native workflow entities in Branch 6

### Source Anchors

- `doc/02-current-state-architecture.md`
- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/09-vision-platform-architecture.md`
- `doc/11-vision-execution-model.md`

## 1. Purpose

This branch owns the durable graph kernel and the single-graph authoritative
runtime that every other platform branch builds on.

It exists separately because the rest of the platform cannot move safely until
the following contracts stop drifting:

- stable schema ids and bootstrap behavior
- append-oriented fact and retraction semantics
- authoritative transaction ordering and idempotency
- cursor continuity and replay rules
- authoritative persistence and restart recovery
- the split between replicated graph metadata and authority-only secret
  plaintext

Platform outcomes this branch must deliver:

- one canonical graph data model shared by client and authority runtimes
- one authoritative write contract for accepted mutations
- one restart-safe persistence model for the current single-graph proof
- one sync baseline that downstream branches can target before scoped sync,
  sharding, or federation exist

Stability target for this branch:

- `stable`: ids, facts, field-authority metadata, write-scope semantics,
  transaction envelopes, write sessions, total sync, incremental sync,
  persisted-authority APIs, the `core:secretHandle` plus
  `defineSecretField(...)` contract, and the secret-handle/plaintext split
- `provisional`: consumer-owned command envelopes and dispatch in the current
  web authority proof, single-graph Worker HTTP routes, the SQLite table
  layout, and the cross-branch meaning of optional provider metadata columns on
  `io_secret_value`
- `future`: scoped sync, directory/shard topology, principal-aware policy,
  reveal flows, external KMS integration, and principal-aware enforcement of
  `revealCapability` / `rotateCapability`

## 2. Scope

In scope:

- graph ids for schema-owned keys, runtime-created nodes, and edges
- schema bootstrap from TypeScript definitions into graph facts
- schema-level field authority metadata
- the store contract for assert, retract, snapshot, replace, and predicate-slot
  subscriptions
- the authoritative transaction model and retained write history
- total and incremental sync payload contracts for whole-graph replication
- persisted authority storage boundaries
- the current SQLite-backed Durable Object authority proof
- secret-backed field handling through secret handles plus authority-only side
  storage

Out of scope:

- generic authoritative command envelope or graph-owned dispatch registry
- principal, membership, role, and capability resolution
- Better Auth integration
- scoped sync, query planning, materialized projections, and subscription
  routing
- module install, migration, and permission UX
- blob ingestion and background job orchestration
- graph-native workflow productization
- polished end-user web UX
- directory/shard routing and cross-shard query behavior

Assumptions inherited from upstream repo docs:

- schema remains authored in TypeScript and resolved to stable ids before use
- current product proof is one logical graph with one authoritative runtime
- downstream branches may depend on these contracts but must not couple
  directly to internal SQL rows or Worker route details unless marked stable

### Published command boundary

Branch 1 publishes the lowering boundary for authoritative commands. It does
not publish a generic graph-owned command envelope, registry, or dispatcher.

- Stable here: `GraphFieldAuthority`, write-scope semantics,
  `GraphWriteTransaction`, `AuthoritativeGraphWriteResult`, sync payloads,
  persisted-authority APIs, and the secret-handle versus plaintext split
- Consumer-owned for now: command ids and payloads, dispatch tables, transport
  routes such as `POST /api/commands`, and adapter-specific command results
- Required lowering rule: any server-owned command must lower to the Branch 1
  write boundary before durable commit, using the published write scopes and
  persisted-authority APIs rather than inventing a parallel authority protocol

## 3. Core Model

### Owned concepts

`Id`

- opaque string identifier used for nodes, predicates, types, enums, field-tree
  nodes, and edges
- runtime-created ids use `createGraphId()` and are globally unique within one
  store instance
- schema-authored ids are stable across restarts through the key-to-id map

`SchemaKey`

- human-readable durable key such as `core:node`, `core:predicate`, or
  `workflow:envVar`
- never used as the runtime identity once resolved; runtime contracts use ids

`IdMap`

- authoritative mapping from schema keys to stable ids
- source of truth for schema identity continuity across bootstrap, sync, and
  persistence

`Edge`

- canonical fact record: `{ id, s, p, o }`
- `s` is subject id, `p` is predicate id, `o` is object id or scalar payload
- edges are append-oriented records; they are never mutated in place

`StoreSnapshot`

- full materialized store state: current edge rows plus the list of retracted
  edge ids
- canonical total-sync and persistence snapshot shape

`Retraction`

- lifecycle marker on an edge id
- retraction removes a fact from `facts(...)` but keeps the edge in durable
  history and snapshots

`GraphWriteTransaction`

- caller-supplied write envelope: `{ id, ops[] }`
- `id` is the idempotency key
- `ops` is an ordered list of `assert` and `retract` operations

`AuthoritativeGraphWriteResult`

- accepted authoritative transaction record:
  `{ txId, cursor, replayed, writeScope, transaction }`
- `cursor` is the authoritative ordering token
- `replayed` is `true` only when the authority recognizes a duplicate tx id
  with identical contents
- retained history and incremental pull delivery keep the original accepted
  result with `replayed: false`

`AuthoritativeGraphWriteHistory`

- retained suffix of accepted authoritative results
- carries `cursorPrefix`, `baseSequence`, and retained `results`
- `baseSequence` marks the oldest retained sequence after pruning

`SyncPayload`

- either a total graph snapshot or an incremental transaction sequence
- current branch only supports `scope: { kind: "graph" }`

`GraphFieldAuthority`

- field-level policy metadata owned by this branch:
  `visibility`, `write`, and optional sealed-secret metadata
- current write levels are `client-tx`, `server-command`, and `authority-only`
- current visibility levels are `replicated` and `authority-only`
- shared runtime helpers publish these exact value sets and the defaulted
  metadata accessors; downstream branches should depend on that surface rather
  than re-encoding field-authority rules in route or adapter code

`SecretHandle`

- graph-visible node representing the existence and safe metadata of a secret
- plaintext does not live in graph facts or sync payloads
- current safe metadata includes name, version, and last rotation time

`PersistedAuthoritativeGraphState`

- restartable authority state composed of a snapshot plus retained write
  history
- JSON is the test and non-DO adapter format; SQLite rows are the current web
  authority runtime format

### Canonical interfaces

```ts
type Id = string;
type AuthoritativeGraphCursor = string;

type Edge = {
  readonly id: Id;
  readonly s: Id;
  readonly p: Id;
  readonly o: Id;
};

type StoreSnapshot = {
  readonly edges: readonly Edge[];
  readonly retracted: readonly Id[];
};

type GraphWriteOperation =
  | { readonly op: "assert"; readonly edge: Edge }
  | { readonly op: "retract"; readonly edgeId: Id };

type GraphWriteTransaction = {
  readonly id: string;
  readonly ops: readonly GraphWriteOperation[];
};

type AuthoritativeGraphWriteResult = {
  readonly txId: string;
  readonly cursor: AuthoritativeGraphCursor;
  readonly replayed: boolean;
  readonly writeScope: "client-tx" | "server-command" | "authority-only";
  readonly transaction: GraphWriteTransaction;
};

type AuthoritativeGraphWriteHistory = {
  readonly cursorPrefix: string;
  readonly baseSequence: number;
  readonly results: readonly AuthoritativeGraphWriteResult[];
};

type GraphFieldAuthority = {
  visibility?: "replicated" | "authority-only";
  write?: "client-tx" | "server-command" | "authority-only";
  secret?: {
    kind: "sealed-handle";
    metadataVisibility?: "replicated" | "authority-only";
    revealCapability?: string;
    rotateCapability?: string;
  };
};
```

Branch 1 intentionally does not publish a shared `GraphAuthorityCommand` type
or dispatch interface. Consumer-owned command layers must lower to
`GraphWriteTransaction` plus any adapter-local side effects behind the
published write-scope boundary.

`revealCapability` and `rotateCapability` are Branch 1 schema metadata only.
This branch publishes their presence on secret-backed fields, but it does not
publish a reveal API, provider protocol, or principal-aware enforcement model.

### Lifecycle states

Facts:

1. asserted
2. current
3. retracted

Transactions:

1. proposed by caller
2. structurally prepared
3. validated against write policy and graph invariants
4. accepted and assigned a cursor
5. replayed idempotently or rejected
6. retained in write history until pruned behind `baseSequence`

Secret-backed fields:

1. absent
2. handle created with safe metadata
3. plaintext stored in authority-only storage
4. handle metadata rotated when plaintext changes
5. replicated reference may later retract while the authority-only side row
   stays retained until later lifecycle work defines cleanup

### Relationships

- schema keys map to stable ids through `IdMap`
- schema bootstrap emits graph facts describing types, predicates, enums, and
  field trees
- transactions mutate snapshots by asserting or retracting edges
- write results become incremental sync records
- secret-backed predicates point at `core:secretHandle` nodes in replicated
  graph state while plaintext lives in side storage

## 4. Public Contract Surface

### `IdMap` and namespace resolution

- Name: `createIdMap(...)`, `applyIdMap(...)`, `extractSchemaKeys(...)`
- Purpose: assign and preserve stable runtime ids for schema-authored keys
- Caller: graph bootstrap and schema-owning packages
- Callee: graph identity layer
- Inputs: schema namespace and optional prior id map
- Outputs: stable id map and namespace with resolved ids
- Failure shape: missing ids in strict mode, duplicate ids, or malformed map
- Stability: `stable`

### Schema bootstrap

- Name: `bootstrap(store, namespace)`
- Purpose: materialize schema definitions into graph facts without duplicating
  already-present facts
- Caller: authority and client bootstrap paths
- Callee: graph bootstrap layer
- Inputs: store and resolved namespace
- Outputs: schema facts in the store
- Failure shape: unknown cardinality or inconsistent resolved schema
- Stability: `stable`

### Store runtime

- Name: `Store`
- Purpose: append-oriented fact storage plus snapshot and retraction semantics
- Caller: graph clients, authoritative runtime, validation, sync
- Callee: graph kernel
- Inputs: asserted edges, retracted edge ids, snapshot replacement requests,
  predicate-slot subscriptions
- Outputs: current facts, full snapshots, monotonic store version changes
- Failure shape: assert with reused edge id but different contents
- Stability: `stable`

### Authoritative write session

- Name: `AuthoritativeGraphWriteSession`
- Purpose: validate, order, retain, and replay authoritative graph writes
- Caller: persisted authority runtimes and future authority backends
- Callee: graph sync authority layer
- Inputs: `GraphWriteTransaction` plus optional `writeScope`
- Outputs: `AuthoritativeGraphWriteResult`, retained history, incremental
  change lookup after a cursor
- Failure shape: `GraphValidationError`, reset when the cursor falls outside
  retained history, id conflict when a tx id is reused for different contents
- Stability: `stable`

### Whole-graph sync payloads

- Name: `TotalSyncPayload`, `IncrementalSyncPayload`, `IncrementalSyncFallback`
- Purpose: replicate authoritative graph state to clients
- Caller: synced clients, HTTP transport adapters, tests
- Callee: graph sync layer
- Inputs: current snapshot or retained authoritative results, optional `after`
  cursor
- Outputs: total snapshot or ordered incremental writes for `scope.kind =
"graph"`; empty incremental `transactions` without `fallback` are successful
  no-op or cursor-advanced pulls rather than recovery signals
- Failure shape: fallback reasons `unknown-cursor`, `gap`, or `reset`
- Cursor stability: callers must treat cursor strings as opaque tokens and rely
  only on equality, ordering from the authority, and fallback behavior
- Stability: `stable`

### Persisted authority boundary

- Name: `PersistedAuthoritativeGraphStorage`
- Purpose: separate durable commit mechanics from in-memory authority logic
- Caller: authority runtimes
- Callee: storage adapter implementations
- Inputs: `load()`, per-tx `commit(...)`, and full `persist(...)`
- Outputs: hydrated snapshot and retained history, or committed durable state
- Contract note: the shared boundary is snapshot-plus-history only; SQL rows,
  Durable Object transactions, and secret side-storage remain adapter details
- Failure shape: storage exceptions trigger in-memory rollback or full rewrite
  on next persist
- Stability: `stable`

### Web authority secret mutation

- Name: `executeCommand({ kind: "write-secret-field", input })`,
  `writeSecretField(...)`, and canonical `POST /api/commands`
- Purpose: current consumer-owned web proof for creating or rotating a
  secret-backed field through an explicit authority command; `workflow:envVar` is
  the primary shipped consumer, but the command is not env-var-specific
- Caller: web operator surfaces
- Callee: web authority runtime
- Inputs: `entityId`, `predicateId`, and plaintext
- Outputs: created/rotated result with `secretId` and `secretVersion`
- Contract note: the stable dependency is the lowering boundary to
  `writeScope: "server-command"`, `GraphWriteTransaction`, and the
  persisted-authority commit path; the command envelope, dispatcher, route
  shape, and result payload are web-owned for now
- Current behavior note: submitting the same plaintext keeps the existing
  `secretHandle.version`; the proof may still normalize the handle name
- Failure shape: `400` for invalid input or non-secret predicate, `404` for
  unknown entity or predicate, storage failure on durable commit
- Stability: `provisional`

### Web authority transport proof

- Name: `GET /api/sync`, `POST /api/tx`, `POST /api/commands`
- Purpose: expose the branch-owned sync and write contracts over HTTP for the
  current Worker proof
- Caller: browser synced client
- Callee: web authority runtime
- Inputs: optional `after` cursor, `GraphWriteTransaction`, or supported web
  authority command envelopes
- Outputs: sync payloads, authoritative write results, or provisional web-owned
  command results
- Contract note: `GET /api/sync` and `POST /api/tx` are transport proofs for
  Branch 1-owned contracts. `POST /api/commands` is a consumer-owned adapter
  route that lowers supported commands into those contracts rather than a
  published graph command protocol
- Failure shape: `400` for invalid JSON or graph validation failures
- Stability: `provisional`

### Durable Object SQL schema

- Name: `io_graph_meta`, `io_graph_tx`, `io_graph_tx_op`, `io_graph_edge`,
  `io_secret_value`
- Purpose: current durable storage model for the single-graph authority proof
- Caller: Durable Object authority storage adapter only
- Callee: SQLite-backed Durable Object storage
- Inputs: graph commits, persistence rewrites, secret side writes
- Outputs: restartable authoritative state
- Failure shape: transaction abort on constraint error or unknown durable edge
  retraction
- Stability: `provisional`

## 5. Runtime Architecture

Current runtime components:

- `graph` kernel: pure store, schema, validation, sync contracts, and persisted
  authority abstractions
- persisted authority wrapper: loads durable state, applies authoritative
  transactions, and rolls back on failed durable commits
- web authority runtime: composes graph modules, seeds example data, and adds
  the secret-field command
- Durable Object authority: current single serialized authority process with
  SQLite-backed storage

Process boundaries:

- browser clients hold only replicated graph state and never hold authority-only
  secret plaintext
- Worker request handlers are transport adapters, not the source of graph
  semantics
- the Durable Object is the current authoritative serialization boundary for
  graph writes

Authoritative versus derived state:

- authoritative: graph facts, retractions, transaction ordering, retained write
  history, secret plaintext side storage
- derived: in-memory indexes inside `Store`, filtered replicated sync payloads,
  and SQL indexes that accelerate reads without changing the fact model

Local versus remote responsibilities:

- local client: bootstrap schema, hold cached replicated graph state, perform
  local structural validation, queue optimistic transactions
- authority: enforce write policy, validate full graph invariants, assign
  cursors, persist durable state, and project only replicated predicates into
  sync

Future architecture note:

- directory/shard topology is explicitly out of scope for this branch contract
  beyond preserving a model that can later shard by subject home

## 6. Storage Model

This branch owns persistent state.

### Canonical authoritative records

`io_graph_meta`

- one row per authority instance
- stores schema version, cursor prefix, head sequence, head cursor, retained
  history floor, and seed/update timestamps

`io_graph_tx`

- one row per accepted authoritative transaction
- stores sequence number, tx id, cursor, and commit timestamp

`io_graph_tx_op`

- ordered operation log for each retained transaction
- stores assert/retract operations by `(tx_seq, op_index)`

`io_graph_edge`

- one row per asserted edge id
- stores subject, predicate, object, asserting sequence, and optional
  retracting sequence/op index

`io_secret_value`

- authority-only side table keyed by `secret_id`
- stores plaintext, version, timestamps, and optional provider metadata columns
- current Branch 1 contract does not assign stable cross-branch semantics to
  `provider`, `fingerprint`, or `external_key_id`; they remain adapter-owned
  placeholders for later provider and KMS work

### Current authoritative state rules

- current graph state is the set of `io_graph_edge` rows interpreted with
  retractions
- retained history is the suffix of committed transactions after
  `history_retained_from_seq`
- secret plaintext is authoritative only in `io_secret_value`; it is never
  rebuilt from graph facts

### Retained history versus current state

- current state must survive even when old retained transactions are pruned
- retained history is an optimization for incremental sync, not the sole source
  of truth for current graph facts

### Derived versus authoritative state

- authoritative: graph rows, tx rows, secret rows
- derived: SQL indexes on `(s, p)`, `(p, o)`, and `retracted_tx_seq`, plus any
  in-memory maps reconstructed at runtime

### Rebuild rules

- load rebuilds a snapshot from `io_graph_edge`
- retained history is accepted only if sequences and cursors are contiguous and
  match the snapshot head
- if retained history is unusable, the authority rewrites persistence from the
  current snapshot as a new baseline rather than partially trusting corrupt
  history
- JSON persistence remains acceptable for tests and non-Durable-Object
  environments

### Migration expectations

- SQL schema versioning is owned here
- additive SQL migrations are acceptable for the single-graph proof
- downstream branches must not depend directly on internal table columns
- future sharding may replace this exact table placement, so table names and
  row layout are not yet a public cross-branch dependency

## 7. Integration Points

### Branch 2: Identity, Policy, And Sharing

- Dependency direction: Branch 2 depends on Branch 1
- Imported contracts: `GraphFieldAuthority`, write scopes, visibility filtering,
  authoritative command lowering boundary
- Exported contracts: field visibility/write metadata and authoritative write
  hooks
- Mockable or provisional: principal resolution and capability enforcement
- Must be stable first: tx replay, replicated-vs-authority-only filtering, and
  `server-command` write semantics

### Branch 3: Sync, Query, And Projections

- Dependency direction: Branch 3 depends on Branch 1
- Imported contracts: total/incremental sync payloads, cursor rules, retained
  history semantics, fact model
- Exported contracts: whole-graph sync baseline
- Mockable or provisional: current `scope.kind = "graph"` transport adapter
- Must be stable first: cursor continuity, fallback semantics, idempotent tx
  replay, and retraction semantics

### Branch 4: Module Runtime And Installation

- Dependency direction: Branch 4 depends on Branch 1
- Imported contracts: namespace ids, bootstrap, field metadata, validation, and
  authority hooks
- Exported contracts: module-authored schema must lower to Branch 1 ids and
  facts
- Mockable or provisional: install-time permission UX
- Must be stable first: `IdMap`, schema bootstrap, and field-authority metadata

### Branch 5: Blob Ingestion And Media

- Dependency direction: Branch 5 depends on Branch 1
- Imported contracts: fact model, tx model, secret-handle split for credentials,
  and durable commit boundary
- Exported contracts: blob metadata rows must be ordinary graph facts
- Mockable or provisional: blob transport and queue wiring
- Must be stable first: append-oriented writes and authority-side secret
  handling

### Branch 6: Workflow And Agent Runtime

- Dependency direction: Branch 6 depends on Branch 1
- Imported contracts: graph-native entity persistence, tx replay, cursor
  semantics, and authority command lowering boundary
- Exported contracts: workflow entities are ordinary graph state above this
  branch
- Mockable or provisional: workflow planner and artifact execution model
- Must be stable first: authoritative write/session model and restart-safe
  persistence

### Branch 7: Web And Operator Surfaces

- Dependency direction: Branch 7 depends on Branch 1
- Imported contracts: synced client behavior, `/api/sync` and `/api/tx` proof
  routes, the provisional web secret-field command proof, replicated predicate
  filtering
- Exported contracts: none back into Branch 1 beyond transport composition
- Mockable or provisional: exact HTTP routes and shell UX
- Must be stable first: payload shapes, validation behavior, and secret
  metadata sync semantics

## 8. Main Flows

### 1. Schema bootstrap

- Initiator: authority startup or client bootstrap
- Components involved: `IdMap`, resolved namespace, `bootstrap(...)`, `Store`
- Contract boundaries crossed: schema authoring to runtime facts
- Authoritative write point: bootstrap facts added to the local store, then
  persisted by the authority runtime
- Failure or fallback behavior: invalid schema resolution aborts startup rather
  than creating partial schema state

### 2. Ordinary authoritative write

1. Initiator: synced client or server caller submits `GraphWriteTransaction`
2. Components involved: transport adapter, authoritative write session,
   validation, persisted authority storage
3. Contract boundaries crossed: caller tx -> authority validation -> durable
   commit -> authoritative write result
4. Authoritative write point: successful `storage.commit(...)`
5. Failure or fallback behavior: invalid tx is rejected with validation errors;
   durable commit failure rolls back store snapshot and retained history

### 3. Idempotent replay

1. Initiator: caller resubmits a prior tx id
2. Components involved: authoritative write session
3. Contract boundaries crossed: tx id lookup against retained records
4. Authoritative write point: none if replayed; prior accepted result is reused
5. Failure or fallback behavior: same id with different contents is rejected as
   a tx id conflict

### 4. Incremental sync after a cursor

1. Initiator: client calls sync with `after`
2. Components involved: retained write history, replicated-field filter,
   sync payload builder
3. Contract boundaries crossed: authoritative history -> replicated incremental
   payload
4. Authoritative write point: none; read-only projection
5. Failure or fallback behavior: if `after` is outside retained history or from
   a different cursor epoch, return fallback `unknown-cursor`, `gap`, or
   `reset`

### 5. Secret-backed field write

1. Initiator: operator client posts `entityId`, `predicateId`, and plaintext
2. Components involved: consumer-owned web authority command adapter, graph
   mutation planner, authoritative tx apply, `io_secret_value` side write
3. Contract boundaries crossed: consumer-owned command envelope -> Branch 1
   graph tx plus secret side storage
4. Authoritative write point: same durable storage transaction that writes the
   graph commit and secret plaintext
5. Failure or fallback behavior: invalid entity/predicate/plaintext rejects the
   command; storage failure restores prior graph and in-memory secret state

### 6. Restart hydration

1. Initiator: authority process or Durable Object restart
2. Components involved: persisted storage adapter, snapshot hydration, retained
   history validation, authority session reconstruction
3. Contract boundaries crossed: durable rows -> in-memory store and write
   session
4. Authoritative write point: optional full rewrite if retained history is
   inconsistent
5. Failure or fallback behavior: rewrite from snapshot baseline rather than
   serving partial or corrupt retained history

## 9. Invariants And Failure Handling

### Invariants

- schema key to id mapping is stable once published
- edge ids are globally unique and immutable
- retractions only target existing durable edge ids
- transaction ids are idempotency keys and must not describe different writes
- authoritative cursors are monotonic within one cursor prefix
- retained write history is gap-free between `baseSequence + 1` and head
- total and incremental sync expose only predicates whose visibility is
  `replicated`
- writes must honor field write policy relative to the supplied write scope
- secret plaintext never appears in graph snapshots, sync payloads, or
  replicated stores
- durable commit failure must not leave accepted in-memory graph state ahead of
  durable state

### Failure modes

Invalid transaction:

- what fails: tx shape, tx content, write policy, or graph validation
- what must not corrupt: current store snapshot, retained history, cursor
- retry or fallback: caller fixes the payload and retries
- observability needed: tx id, first validation issue, caller surface

Cursor outside retained history:

- what fails: incremental replay
- what must not corrupt: authoritative state or client cache
- retry or fallback: return fallback result and require a total sync
- observability needed: requested cursor, head cursor, base sequence, fallback
  reason

Durable commit failure:

- what fails: storage commit or secret side write
- what must not corrupt: in-memory authoritative snapshot and retained history
- retry or fallback: rollback in-memory state; caller may retry the tx
- observability needed: tx id, storage operation, rollback outcome

Hydration inconsistency:

- what fails: retained history reconstruction from durable state
- what must not corrupt: current graph facts reconstructed from durable rows
- retry or fallback: rewrite persistence from the current snapshot baseline
- observability needed: mismatch type, retained window, resulting new baseline

Unknown retract target:

- what fails: durable application of a retract op against SQL rows
- what must not corrupt: transaction ordering and edge table consistency
- retry or fallback: abort the storage transaction and surface an error
- observability needed: edge id, tx id, sequence

## 10. Security And Policy Considerations

- Field visibility is enforced at the predicate level. Current branch semantics
  are about replicated versus authority-only data, not yet principal-aware
  sharing.
- Field write policy is enforced before authoritative apply. Ordinary client
  transactions cannot mutate `server-command` or `authority-only` fields.
- Secret-backed fields use a sealed-handle model. The graph carries only safe
  secret metadata and relationships.
- Plaintext secret values stay in authority-only storage and are committed only
  through explicit server-side command paths.
- Clients may know a secret exists and observe safe metadata such as version and
  last rotation time, but they may not infer plaintext from sync.
- Branch 1 does not publish a reveal flow. `revealCapability` and
  `rotateCapability` exist as schema metadata only, and principal-aware
  enforcement belongs to Branch 2. This branch only guarantees the authority
  boundary and plaintext split.
- Adapter-specific provider metadata may be durably retained with a secret row,
  but the semantics of that metadata and any external KMS integration remain
  provisional.
- The current Worker routes are trusted internal adapters. They must remain
  wrapped by auth/session policy once Branch 2 lands, but that policy is not
  owned here.

## 11. Implementation Slices

### Slice 1: Freeze kernel contracts

- Goal: lock the ids, facts, retractions, tx envelopes, sync payloads, and
  field-authority metadata
- Prerequisite contracts: current `graph` runtime files already exist
- What it proves: downstream branches can code against stable graph primitives
- What it deliberately postpones: scoped sync, sharding, and principal-aware
  policy

### Slice 2: Commit-oriented persisted authority (shipped baseline)

- Goal: keep `PersistedAuthoritativeGraphStorage` stable while making SQLite the
  primary authority backend
- Prerequisite contracts: authoritative write session and retained history
- What it proves: restart-safe persistence without blob-style snapshot rewrites
- What it deliberately postpones: multi-shard routing and projection runtimes
- Status: shipped in the current single-graph proof; next work is hardening
  retention, recovery, and contract boundaries on top of that baseline

### Slice 3: Secret-handle authority flow

- Goal: standardize secret-backed writes as explicit consumer-owned authority
  commands backed by `core:secretHandle`
- Prerequisite contracts: field-authority metadata and server-command writes
- What it proves: replicated-safe secret metadata with authority-only plaintext
- What it deliberately postpones: reveal flows, external KMS integration, and
  cross-module secret UX

### Slice 4: Recovery and retention hardening

- Goal: make cursor continuity, replay, retained history pruning, and reset
  behavior mechanically reliable
- Prerequisite contracts: durable tx rows and snapshot hydration
- What it proves: long-lived clients can reason about cursor failure modes
- What it deliberately postpones: scope-local cursors and distributed ordering

## 12. Open Questions

Resolved for Branch 1: cursor strings are opaque outside the shared runtime;
only ordering, equality, and fallback behavior are stable for downstream
callers.

Resolved for Branch 1: generic authoritative command envelopes, dispatch
registries, and transport shapes stay consumer-owned for now. This branch owns
field-authority metadata, write-scope semantics, transaction envelopes, sync
payloads, and persisted-authority APIs as the stable lowering boundary those
commands target.

- How much of the current SQLite row layout should remain an implementation
  detail once the authority runtime splits into directory and shard packages?
- Should retained history pruning be purely count-based, or should it gain a
  time-based minimum retention policy for long-lived offline clients?
- When Branch 2 adds principals, does `writeScope` remain a simple tiered
  internal control, or should it become a richer execution context object?

## 13. Recommended First Code Targets

- `lib/app/src/graph/runtime/identity.ts`, `lib/graph-module-core/src/core/bootstrap.ts`, and
  `lib/graph-bootstrap/src/index.ts` to lock stable schema-id and bootstrap
  behavior in code comments and tests
- `lib/graph-sync/src/contracts.ts`, `lib/graph-authority/src/session.ts`, and
  `lib/graph-authority/src/replication.ts` to freeze tx, cursor, replay, and
  replicated-field semantics
- `lib/graph-authority/src/persisted-authority.ts` to keep the durable storage
  boundary small and explicit
- `lib/app/src/web/lib/graph-authority-do.ts` to harden the SQLite-backed single-graph
  authority proof
- `lib/app/src/web/lib/authority.ts` to keep secret-handle mutation logic aligned with
  the branch contract
