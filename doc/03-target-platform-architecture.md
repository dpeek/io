# Target-State Platform Architecture

This document captures the intended end-state platform model for the current
architecture split.

## Core Platform Primitives

The roadmap reduces the target system to four major runtime families that share
one graph model: graph runtime, module runtime, operator surfaces, and agent
runtime.

It then refines that into eight platform primitives:

1. Graph facts: append-oriented authoritative edge log plus current fact state
2. Schema and taxonomy: stable ids, type and predicate definitions, field
   metadata, and validation rules
3. Authority and policy: predicate-level visibility, write modes, and
   principal-aware capability checks
4. Sync scopes: principal-scoped query, module, entity-bundle, and shareable
   sync units with completeness semantics
5. Indexes and projections: rebuildable derived read models
6. Modules: installable slices bundling schema, UI, commands, workflows,
   indexes, ingest, and migrations
7. Workflow runtime state: graph-native projects, branches, commits, sessions,
   artifacts, and decisions
8. Blob and ingest substrate: R2-backed objects plus queue-driven extraction and
   normalization

## Domain Model

The recommended taxonomy keeps `core:` small, moves reusable domain slices into
foundation modules, and keeps specialized vertical semantics module-local until
they have proven reuse.

Recommended layers:

- Core: identity, labels, timestamps, provenance, attachment refs, privacy and
  capability refs
- Foundation modules: person, organization, file/blob, document, message,
  calendar, task, tag/topic, and secret/integration credential
- Optional domain modules: CRM, recruiting, finance, health, and other vertical
  slices

For the platform itself, graph-native workflow adds first-class types such as
project, repository, branch, commit, session, artifact, decision, context
document, module, and environment.

## Data Flow

The target data flow is:

```text
[Web / TUI / Agent / Ingest Connector]
|
v
[Worker API + Auth]
|
+-------+--------+
|                |
v                v
[Directory DO]   [Subscription Router]
|
query plan / shard map / module manifest / caps
|
+----+----+-------------------+
|    |    |                   |
v    v    v                   v
[Shard DO] [Shard DO] ...     [Shard DO]
|            |                   |
+---- authoritative tx ---------+
|
v
[Derived Index / Projection Jobs]
|
+--------+---------+
|                  |
v                  v
[R2]           [Queue Consumers]
```

This aligns with a directory/shard split, Queue-backed async processing, and a
separate blob tier.

## Sync, Caching, Offline, and Partial Replication

Whole-graph sync is treated as a proof surface. The target contract is scope-
based sync where a scope carries:

- principal
- `scopeKind`
- `scopeDefinitionHash`
- completeness
- cursor or watermark
- `policyFilterVersion`

Scopes may represent:

- entity neighborhoods
- module slices
- saved views or queries
- inbox or work queues
- outbound share projections
- agent context bundles

Recommended behavior:

- clients cache only authorized scope slices
- all scope results carry explicit completeness
- incremental pull works by scope cursor
- fallback is scope-specific rather than whole-graph
- live push is routed through a subscription router
- shard invalidations are keyed by dependency keys
- most clients receive "scope cursor advanced, re-pull" or bounded scoped
  deltas, not arbitrary raw query events

The roadmap explicitly favors cursor-advanced plus scoped pull for most live
updates, using direct deltas only for bounded materialized scopes.

## Auth, Identity, and Secrets

The target boundary is:

- Better Auth owns sessions, provider accounts, passkeys and passwords,
  verification tokens, and plugins
- the graph owns durable principals and relationships such as users, people,
  memberships, roles, capabilities, grants, and agent permissions

Recommended architecture:

- Better Auth runs against a dedicated auth store
- auth events are mirrored into graph principal entities asynchronously but
  quickly
- session claims include graph principal id plus a capability snapshot or
  version
- final authorization remains graph-policy aware at query and command time

Secrets are handled as:

- secret handles and safe metadata in the graph
- sealed secret payloads in shard or authority storage
- module commands requesting secret use only through declared permissions and
  audited server paths

## Extensibility Model

A module is the installable product slice. Each module should declare:

- types and predicates
- validation
- views and editors
- workflows
- commands
- index and query requirements
- ingest and sync adapters
- blob handlers
- styles and components
- permissions
- migrations

The roadmap suggests one canonical manifest shape:

```text
module.json
id
version
runtimeCompatibility
namespaces
predicates
commands
workflows
views
indexes
ingest
blobClasses
permissions
externalServices
migrations
rollback
setup
```

Installation should validate compatibility, apply schema and migrations, create
required indexes and projections, register routes and handlers, request needed
bindings and credentials, and emit capability and observability events.

## Observability and Operations

The target system needs first-class traces around:

- authoritative transaction commits
- sync scope generation
- fallback and reset reasons
- shard fan-out
- index build lag
- queue depth and age
- module install and migration status
- remote share and federation access
- agent run, session, and artifact lifecycle

This is partly driven by the roadmap’s observation that current observability is
still weak relative to the target system’s operational complexity.
