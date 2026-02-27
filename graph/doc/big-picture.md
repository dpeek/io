# Big Picture: TS-First Graph Platform

## A) One-paragraph product vision

This evolves into a TypeScript-native data platform where application state, relationships, schema, and workflow metadata all live in one identity-stable graph model that runs in browser and server, syncs incrementally, and powers both app logic and UI generation. Developers get strongly typed APIs, local-first responsiveness, and a clear server authority model for security-sensitive logic, while teams gain a unified system for data modeling, querying, permissions, and tooling (Explorer/devtools) without stitching together ORM + cache + ad hoc sync + form frameworks.

## B) Differentiators / opportunity analysis

### Why this approach is different

Most stacks split concerns across separate abstractions: SQL/ORM for persistence, client cache for UI state, bespoke websockets for live updates, forms/validation libraries for editors, and separate auth logic. A TS-native graph with partial sync can collapse these boundaries into shared primitives while still enforcing server authority where needed.

### Killer capabilities (concrete)

- **Identity-stable everything**: nodes/edges/values can be addressed directly, enabling per-field subscriptions and fine-grained React updates with minimal re-render churn.
- **Schema as data + runtime types**: schema is traversable graph data and compile-time TS types; tooling can introspect and generate editors, migrations, and docs from the same source.
- **One mutation model across tiers**: the same patch/operation model works for local optimistic writes, server validation, persistence, and replication.
- **Partial sync with query continuity**: queries can execute locally on partial graphs with explicit completeness metadata, then refine as more data arrives.
- **Server-only fields and capabilities**: sensitive attributes exist in the same logical entity model but are unreadable/unavailable in client materialization by policy.
- **Typed graph UI kit**: scalar-aware viewers/editors and schema-driven forms become a platform primitive, not app-by-app glue code.
- **Replayable, inspectable history**: append-oriented change tracking enables diffing, audit trails, and time-travel debugging in Graph Explorer.
- **Composable access control**: ACL decisions can combine graph relationships (owner/member/role) with field-level policies and action scopes.
- **Portable runtime**: in-memory first for fast DX, then persisted/log-backed server runtime without rewriting app code.

### Relative to common alternatives

- **vs SQL/ORM**: better native handling of deeply connected data and live subscriptions; weaker ad hoc analytical querying initially unless a SQL bridge is added.
- **vs document DBs**: less denormalization pain and stronger cross-entity constraints; somewhat higher conceptual load around graph traversal/indexing.
- **vs CRDT stores**: simpler deterministic server authority model for business invariants/secrets; less peer-to-peer merge flexibility by default.
- **vs event sourcing**: easier current-state reads and typed entity APIs; can still keep an append log for history.
- **vs graph DB products**: tighter TS ergonomics and app-runtime integration; initially fewer built-in query optimizations.
- **vs reactive client caches**: cache and source-of-truth model converge, reducing impedance mismatch between local state and backend state.

## C) Minimal primitives

Design goal: standardize the smallest set of durable primitives and keep higher-level frameworks optional.

### 1) Identity model (`NodeId`, `EdgeId`, `ValueId`)

- **Responsibilities**: uniquely address entities, relationships, and (optionally) scalar value instances for stable subscriptions and diffs.
- **Constraints**: globally unique within graph scope; deterministic IDs optional but must be namespaced to avoid collisions.
- **Composes with**: mutations, subscriptions, ACL, serialization, sync cursors.
- **Stable now**: opaque ID type and uniqueness contract.
- **Can evolve**: ID generation strategy (random to deterministic/content-derived for selected domains).

### 2) Graph fact model (`Edge { id, s, p, o }` + retraction semantics)

- **Responsibilities**: represent all persisted assertions uniformly.
- **Constraints**: append-oriented semantics; retraction is explicit tombstoning, not destructive overwrite.
- **Composes with**: history/audit, sync, materialized query indexes.
- **Stable now**: triple shape + retract behavior contract.
- **Can evolve**: metadata envelope (`ts`, `actor`, `tx`, `source`) and storage encoding.

### 3) Schema/type/scalar model

- **Responsibilities**: define entity types, predicates, cardinality, scalar codecs, enums, and validation constraints.
- **Constraints**: schema nodes are graph-addressable; scalar encode/decode must be deterministic and versioned.
- **Composes with**: query planning, form generation, ACL rules, migration tooling.
- **Stable now**: type/scalar/enum categories, cardinality semantics, `range` concept.
- **Can evolve**: richer constraints (unique, foreign-key-like assertions, computed fields).

### 4) Mutation primitive (`Patch` / `Op`)

- **Responsibilities**: express changes as deterministic, replayable operations (`assert`, `retract`, `set-one`, `add-many`, etc.).
- **Constraints**: every accepted mutation must produce a canonical operation list; operation ordering deterministic inside transaction.
- **Composes with**: optimistic UI, conflict detection, event log, undo/redo, server actions.
- **Stable now**: canonical op envelope + transaction boundary.
- **Can evolve**: derived operations (upsert helpers), compression, batched transport forms.

### 5) Versioning/change tracking (`Version`, `TxId`, `Cursor`)

- **Responsibilities**: support incremental sync, subscriptions, and optimistic concurrency checks.
- **Constraints**: monotonic per-graph or per-partition ordering; idempotent replay.
- **Composes with**: sync protocol, live queries, observability.
- **Stable now**: cursor monotonicity and replay semantics.
- **Can evolve**: sharded clocks/vector metadata for multi-writer scaling.

### 6) Query primitive (`QuerySpec`)

- **Responsibilities**: define read intents in transportable form (filters, traversals, projections, limits, sort).
- **Constraints**: serializable; explicit handling of partial data (`complete`, `incomplete`, `stale` flags).
- **Composes with**: local engine, server engine, subscription invalidation, index planner.
- **Stable now**: query envelope shape + result metadata contract.
- **Can evolve**: richer operators, datalog-like rule layer, SQL adapter.

### 7) Subscription primitive (`SubscriptionSpec`)

- **Responsibilities**: stream changes for nodes/fields/queries with minimal invalidation scope.
- **Constraints**: deterministic fan-out semantics; backpressure-aware delivery.
- **Composes with**: React hooks, sync transport, devtools timeline.
- **Stable now**: subscription target types (node, predicate, query) and delivery payload (`changedIds`, `newCursor`).
- **Can evolve**: priority classes, server-side coalescing, offline replay windows.

### 8) Auth + ACL primitives (`Principal`, `Capability`, `Policy`, `VisibilityClass`)

- **Responsibilities**: decide who can read/write which graph slices and fields.
- **Constraints**: deny-by-default for sensitive fields; server enforcement authoritative.
- **Composes with**: query execution, mutation validation, secrets subsystem.
- **Stable now**: policy evaluation inputs/outputs and visibility classes.
- **Can evolve**: policy language sophistication and caching/distributed enforcement.

### 9) Serialization + wire protocol primitive

- **Responsibilities**: encode ops, snapshots, query results, and schema references across client/server boundaries.
- **Constraints**: forward-compatible versioning; explicit feature negotiation.
- **Composes with**: persistence, sync, debugging tools.
- **Stable now**: envelope framing + version fields.
- **Can evolve**: binary encoding, compression, selective field dictionaries.

### 10) Secret value primitive (`SecretRef`)

- **Responsibilities**: represent sensitive data in graph without exposing raw values to untrusted runtimes.
- **Constraints**: client sees opaque references or redacted tokens only; unseal operation server-only and audited.
- **Composes with**: ACL, server actions, key management.
- **Stable now**: opaque reference semantics and redaction contract.
- **Can evolve**: key hierarchy and escrow/rotation workflows.

## D) System architecture map

### 1) Core storage engine (runtime graph kernel)

- **What it does**: executes canonical ops against in-memory graph state, maintains identity maps and base indexes.
- **Owns data**: current fact set, edge tombstones, in-memory indexes, schema cache.
- **Configuration**: ID generator strategy, index presets, validation strictness.
- **APIs**: `apply(txOps)`, `query(spec)`, `subscribe(spec)`, `snapshot()`, `load(snapshot|ops)`.

### 2) Persistence layer

- **What it does**: durability for ops and snapshots; recovery and compaction.
- **Owns data**: append log segments, snapshot files, compaction metadata, retention policies.
- **Configuration**: backend adapter (SQLite/Postgres/LMDB/object storage), snapshot cadence, retention window.
- **APIs**: `append(txRecord)`, `readFrom(cursor)`, `writeSnapshot(version)`, `restoreLatest()`.
- **Opinionated v1**: append log + periodic snapshot is the fastest path; supports audit and sync replay.

### 3) Sync protocol (client/server partial replication)

- **What it does**: negotiates schema/version, transmits ops and query-backed replication sets, delivers live updates.
- **Owns data**: per-client sync cursors, active subscriptions, replication scopes.
- **Configuration**: transport (HTTP pull + WebSocket/SSE live), batching thresholds, auth session binding.
- **APIs**: `sync.pull(scope, sinceCursor)`, `sync.push(localTxs)`, `sync.subscribe(spec)`, `sync.ack(cursor)`.
- **Correctness model**:
  - Result metadata includes `completeness` (`complete | incomplete`) and `freshness` (`current | stale`).
  - Missing-edge uncertainty is explicit, never silently treated as false.
  - Progressive refinement events re-emit query deltas as scope expands.

### 4) Query engine + indexing

- **What it does**: executes `QuerySpec` on local or server graph and uses indexes for latency targets.
- **Owns data**: index structures (by `p`, by `(p,o)`, by type, secondary scalar indexes), query plans.
- **Configuration**: enabled operators, index budget, planner heuristics.
- **APIs**: `prepare(spec)`, `execute(spec, ctx)`, `explain(spec)`, `registerIndex(def)`.
- **Query language strategy**:
  - v1: typed TS DSL compiling to JSON `QuerySpec` (safe, serializable).
  - optional: SQL-like read adapter and rule-layer (datalog-ish) later.

### 5) AuthN/AuthZ + ACL subsystem

- **What it does**: authenticates principals and enforces read/write policies at node/predicate/field/action levels.
- **Owns data**: principal records, role bindings, policy graphs, session claims.
- **Configuration**: identity provider adapters, policy evaluation mode, audit verbosity.
- **APIs**: `authorizeRead(principal, querySpec)`, `authorizeWrite(principal, txOps)`, `filterResult(...)`.
- **Boundary**: runs server-side authoritatively; client may cache hints but cannot grant itself access.

### 6) Secrets subsystem (server-only)

- **What it does**: secure secret storage, encryption/unsealing, rotation, and redaction handling.
- **Owns data**: encrypted blobs, key IDs, access audit logs, secret metadata (`owner`, `scope`, `rotationAt`).
- **Configuration**: key provider (local dev key, cloud KMS/HSM later), envelope algorithm, rotation policy.
- **APIs**: `secrets.put(scope, value) -> SecretRef`, `secrets.get(ref, principal, purpose)`, `secrets.rotate(...)`.
- **Threat model coverage**:
  - Client compromise: clients never receive plaintext unless explicitly allowed and short-lived.
  - Server compromise: blast radius reduced with envelope keys + least-privileged unseal paths.
  - Insider access: audited unseal API + policy checks + optional dual-control for high-risk secrets.
  - Exfiltration/accidental logging: automatic redaction wrappers in logs/traces, deny raw secret serialization.
- **Encryption model**:
  - In transit: TLS everywhere, mTLS optional for service-to-service.
  - At rest: envelope encryption (DEK per secret or per workspace class) encrypted by KEK.
  - Field-level: sensitive fields store `SecretRef` instead of plaintext.
- **Key management path**:
  - v1 local/dev: file-backed KEK (rotatable) with strict warnings.
  - v1 hosted: workspace KEK in managed KMS; optional per-user wrapping for personal secrets.
  - vNext: HSM-backed KEK and hardware-attested unseal workers.
- **Developer ergonomics**:
  - Explicit `secret.scalar()` type in schema marks server-only/redacted behavior.
  - Typed APIs prevent accidental read on client: `SecretRef` is non-decodable in browser package.
  - Built-in lint rule rejects logging `SecretRef.resolve()` outputs.

### 7) Server runtime for business logic (actions/rules/workflows)

- **What it does**: executes authoritative business logic around mutations and events.
- **Owns data**: action registry, workflow state, retry queues, idempotency keys.
- **Configuration**: action permissions, retry policy, timeout budget, workflow backend.
- **APIs**: `defineAction`, `dispatchCommand`, `onEvent`, `runWorkflow`.
- **Programming model (recommended blend)**:
  - Client performs optimistic local mutation with tentative `TxId`.
  - Server action validates ACL + invariants + secret access + side effects.
  - Server commits canonical tx; client reconciles by cursor/tx mapping.
  - Background workflows handle long-running tasks with idempotent checkpoints.
- **Conflict handling**:
  - optimistic concurrency via expected version predicates.
  - retries for transient failures.
  - deterministic merge policy per predicate (LWW/set-union/custom reducer).

### 8) React bindings + scalar UI kit + forms

- **What it does**: exposes hooks/selectors for granular subscriptions and schema-driven rendering/editing.
- **Owns data**: subscription cache, component-level derivations, scalar editor registry.
- **Configuration**: suspense/streaming mode, optimistic behavior, scalar component overrides.
- **APIs**: `useNode(id)`, `useField(id, predicate)`, `useQuery(spec)`, `renderField(schemaField, value)`.
- **Scalar/type system strategy**:
  - built-ins: string, number, boolean, date, url, json, bytes, secret-ref, enum.
  - custom scalars: codec + validator + editor/viewer component contract.
- **Schema/form generation**:
  - auto-generate forms from field metadata and constraints.
  - app can override per field/type with custom components.
  - validation runs in three phases: client-precheck, server-authoritative, post-commit normalization.
- **Granular subscriptions**:
  - key on `(nodeId, predicateId)` and query dependency sets.
  - React updates only affected leaf components.

### 9) Tooling/devtools

- **What it does**: developer visibility and safety for schema/data/sync evolution.
- **Owns data**: debug snapshots, query explain outputs, migration history, local traces.
- **Configuration**: redaction defaults, retention, debug verbosity.
- **APIs/tools**: Graph Explorer, diff view, tx timeline, subscription inspector, schema migration CLI.
- **Graph Explorer path**:
  - v1 inspect graph/schema/query results.
  - v1.5 diff and time travel replay.
  - v2 policy/secret access simulation.

### 10) Observability + safety rails

- **What it does**: operational insight and guardrails against dangerous behavior.
- **Owns data**: metrics, traces, structured logs, anomaly signals.
- **Configuration**: SLO thresholds, sampling, redact policy.
- **APIs**: OpenTelemetry hooks, metrics endpoint, audit event stream.
- **Safety rails**:
  - strict redaction middleware.
  - mutation rate limits and payload caps.
  - policy-denied telemetry and alerting.

## E) Key design forks (with tradeoffs)

### 1) Durability model: event log vs snapshot-first

- **Option A: append log + snapshots (recommended)**  
  Pros: replay/audit/sync friendly, straightforward OCC; Cons: compaction complexity.
- **Option B: snapshot-first with delta journals**  
  Pros: simpler point reads; Cons: weaker audit and harder incremental replication.

### 2) Concurrency/merge model

- **Option A: server-authoritative transaction log (recommended for v1)**  
  Pros: predictable invariants and ACL; Cons: less offline conflict flexibility.
- **Option B: CRDT-first multi-master**  
  Pros: superior peer/offline convergence; Cons: difficult invariant enforcement and secret workflows.
- **Option C: LWW baseline with field-specific merge plugins**  
  Pros: pragmatic incremental complexity; Cons: semantic surprises unless clearly documented.

### 3) Query DSL style

- **Option A: TS fluent DSL -> serializable AST (recommended)**  
  Pros: best TS DX and compile-time safety; Cons: query portability to non-TS clients requires AST contract.
- **Option B: SQL-like subset**  
  Pros: familiar mental model; Cons: weaker graph traversal ergonomics.
- **Option C: datalog-ish rule language**  
  Pros: expressive recursive queries; Cons: steeper learning curve and planner complexity.

### 4) Schema evolution strategy

- **Option A: explicit migration scripts + compatibility checks (recommended)**  
  Pros: controlled rollouts, testable; Cons: more ceremony.
- **Option B: implicit lazy migration on read/write**  
  Pros: less upfront friction; Cons: drift and hidden runtime costs.

### 5) Encryption key strategy

- **Option A: workspace KEK + per-secret DEK (recommended)**  
  Pros: good isolation and rotation practicality; Cons: KMS dependency for hosted production.
- **Option B: per-user KEK hierarchy**  
  Pros: stronger user isolation; Cons: access/recovery complexity for shared resources.
- **Option C: single environment KEK**  
  Pros: simplest; Cons: poor blast-radius characteristics.

### 6) Sync mode

- **Option A: pull checkpoints + live subscription channel (recommended)**  
  Pros: resilient reconnects, simple backfill; Cons: dual-path complexity.
- **Option B: live-only stream**  
  Pros: low-latency mental model; Cons: difficult catch-up/recovery semantics.

### 7) Partial-sync correctness semantics

- **Option A: explicit tri-state result quality (`complete/incomplete`, `fresh/stale`) (recommended)**  
  Pros: honest semantics for local queries; Cons: requires developer education.
- **Option B: hide incompleteness**  
  Pros: simpler API surface; Cons: silent correctness bugs.

## F) Research plan

### 1) SecretRef end-to-end spike

- **Hypothesis**: server-only `SecretRef` can provide safe DX without excessive friction.
- **Build**: schema `secret` scalar, encrypted storage adapter, redacted client projection, audited unseal API.
- **Measure**: zero plaintext in logs/traces, <10% overhead on read path, API usability feedback.
- **Learn**: practical key hierarchy and ergonomics footguns.

### 2) Query DSL + AST compiler

- **Hypothesis**: TS-first DSL can remain serializable and expressive for 80% of app queries.
- **Build**: minimal fluent API -> `QuerySpec` AST + local interpreter.
- **Measure**: number of common query patterns expressible without escape hatches.
- **Learn**: missing operators and complexity pressure points.

### 3) Partial sync correctness harness

- **Hypothesis**: explicit completeness metadata prevents logic bugs in offline/partial scenarios.
- **Build**: simulator that drops graph regions and replays sync refinements.
- **Measure**: mismatch rate between local results and eventual full-server truth; developer comprehension tests.
- **Learn**: best default semantics for query APIs/hooks.

### 4) Granular React subscriptions benchmark

- **Hypothesis**: `(node,predicate)` subscriptions materially reduce rerenders vs entity-level subscriptions.
- **Build**: benchmark app with large editable graph and controlled mutation workloads.
- **Measure**: commit count, paint time, input latency under load.
- **Learn**: optimal subscription granularity and cache invalidation design.

### 5) Server action + optimistic reconcile loop

- **Hypothesis**: command/action model can keep UX instant while preserving server invariants.
- **Build**: optimistic tx pipeline with server validation and reconciliation mapping.
- **Measure**: perceived latency, conflict rate, reconciliation failure classes.
- **Learn**: necessary ergonomics for testing and debugging eventual consistency.

### 6) Index strategy bake-off

- **Hypothesis**: a small default index set covers most v1 workloads.
- **Build**: benchmark `p`, `(p,o)`, type, and scalar secondary indexes across synthetic + real query traces.
- **Measure**: p50/p95 latency, memory overhead, index build cost.
- **Learn**: default index presets and tuning knobs.

### 7) Persistence backend comparison

- **Hypothesis**: SQLite-backed append log + snapshots is sufficient for early multi-app use.
- **Build**: pluggable persistence adapters (in-memory, SQLite, Postgres).
- **Measure**: recovery time, write throughput, operational complexity.
- **Learn**: when to recommend each backend profile.

### 8) ACL policy engine prototype

- **Hypothesis**: graph-aware ACL rules can be fast enough with memoization/index assists.
- **Build**: policy evaluator with relationship-based rules and field visibility classes.
- **Measure**: authorization latency under read-heavy workloads; policy explainability quality.
- **Learn**: required policy language primitives and caching strategy.

### 9) Schema-driven form generation pilot

- **Hypothesis**: generated forms + scalar editors cover most CRUD surfaces with minimal override code.
- **Build**: form generator for entity schemas with validation and custom component escape hatches.
- **Measure**: percentage of fields rendered without manual UI, defect rate in generated forms.
- **Learn**: metadata required in schema for truly useful generated UX.

### 10) Explorer/devtools timeline spike

- **Hypothesis**: tx timeline + diff + query explain materially accelerates debugging.
- **Build**: Explorer panels for tx stream, per-node history, query plan output.
- **Measure**: time-to-diagnose for seeded bugs vs baseline tooling.
- **Learn**: highest-value devtools features for v1 adoption.

## G) Path to v1 roadmap

### Stage 1: Prototype hardening (now -> near term)

Must exist:

- Canonical mutation/transaction envelope.
- Durable append log + snapshot recovery (single-node).
- QuerySpec v1 + basic indexes.
- Sync cursors and pull-based catch-up.
- SecretRef baseline with encryption-at-rest and redaction.
- React hooks for `useField` and optimistic mutation pipeline.
- Explorer: inspect schema/nodes/edges and tx stream.

Can wait:

- Complex workflow engine.
- Advanced policy language.
- Multi-region/distributed scale.

### Stage 2: Alpha for internal apps

Must exist:

- AuthN integration + enforceable ACL at read/write.
- Push + live subscription channel with reconnect semantics.
- Server actions framework with retries/idempotency.
- Partial-sync completeness metadata in client APIs.
- Schema migration tooling + compatibility checks.
- Observability baseline (metrics/tracing/audit logs with redaction).

Can wait:

- Datalog/rule query layer.
- Sophisticated multi-tenant key hierarchies beyond workspace scope.

### Stage 3: Beta for external developers

Must exist:

- Stable SDK surface for primitives (IDs, QuerySpec, Patch, SubscriptionSpec).
- Documentation and reference app templates.
- Pluggable persistence adapters with clear deployment profiles.
- Hardened secrets story (KMS-backed in hosted mode).
- Devtools pack: Explorer diff/time-travel, policy explain, sync inspector.
- Performance guardrails and SLO guidance.

Can wait:

- CRDT/multi-master mode.
- Fully managed cloud control plane.
- Advanced analytics/query federation.

## H) Open questions you need to answer

- What is your target **offline guarantee** for v1: read-only offline, optimistic write queue, or full offline-first with conflict UX?
- Do you want v1 to support **multi-tenant workspaces** from day one, or single-tenant deployments first?
- Is there a requirement for **non-TS clients** (Python/Go/mobile) in v1, which would push us toward a language-neutral query/mutation surface earlier?
- For secrets, is your primary near-term environment **self-hosted**, **managed hosted**, or both?
