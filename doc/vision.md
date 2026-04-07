---
name: IO product vision
description: "Long-form repo-wide product vision for the personal graph platform direction."
last_updated: 2026-04-07
---

# IO Product Vision

## Purpose

This document is the initial technical vision for turning the current `io`
workspace into a deployable product: an open source personal graph platform
that runs on Cloudflare, gives each user their own graph, allows graphs to
link to each other under explicit policy, and lets agents operate directly on
that graph instead of depending on third-party work trackers.

It is intentionally ambitious. It should give ChatGPT deep research enough
structure to evaluate the architecture, identify platform risks, and turn the
ideas into a phased execution plan.

## Starting Point

This repo is not starting from zero.

Current code already proves several important pieces:

- a reusable graph engine with stable ids, append-oriented facts, schema
  authoring, typed refs, validation, and sync
- authoritative persistence and replay contracts with total and incremental
  sync payloads
- predicate-level authority metadata such as `visibility` and `write` policy
- a Worker-backed web surface with a Durable Object authority wrapper
- root-safe type modules with view, workflow, and command descriptors
- an agent runtime that already understands workflow loading, module-scoped
  context, scheduling, and operator-facing TUI streams

The product vision should extend those existing contracts rather than replace
them with an unrelated design.

## Product Thesis

The long-term product is a self-hostable personal graph platform.

Each user deploys their own graph to Cloudflare. That graph becomes the durable
home for the information in their life and work:

- notes and documents
- uploaded files and images
- contacts and organizations
- calendar entries and meetings
- emails and threads
- tasks, projects, and workflows
- secrets, credentials, and integrations
- agent memory, execution traces, and generated artifacts

The graph is not only storage. It is also:

- the schema system
- the sync model
- the authorization model
- the UI composition model
- the ingestion model
- the workflow model
- the agent operating model

That is the core bet: one logical graph model should power data, UX, and agent
behavior together.

## What Makes This Product Different

Most systems force users to split their life across:

- disconnected SaaS tools
- opaque sync adapters
- application-specific databases
- agent context that disappears between runs

The proposed product instead gives the user:

- one durable personal graph they own
- one extensible schema space they can grow over time
- one agent-facing memory and workflow layer
- one consistent privacy model down to the predicate level
- one installable module system for bringing in new data types and UIs

In other words, it should feel less like "another notes app" and more like
"your own programmable knowledge substrate."

## Core Product Requirements

### 1. Personal ownership

The project should be open source and deployable by an individual or team to
their own Cloudflare account.

That implies:

- no mandatory hosted control plane for core graph access
- reproducible infrastructure setup
- local development that mirrors deployed behavior closely
- import/export and backup surfaces that are not hostage to one vendor

### 2. One logical graph per user, many physical shards

A personal graph should feel singular to the user even if it is physically
distributed across many Durable Objects and storage backends.

### 3. Predicate-level privacy

Privacy and sharing cannot stop at the entity or table level.

The durable policy unit should be the predicate, with room for more granular
rules later if needed.

### 4. Installable modules

Users should be able to install a module and immediately get:

- schema
- validation
- UI views and editors
- workflows and commands
- ingestion and sync adapters
- styling and operator affordances
- agent-facing task and context hooks

### 5. Agent-native workflow

The system should eventually own its own work model instead of treating Linear
as permanent infrastructure.

### 6. Small, focused code and durable agent context

The repo and the product should both optimize for agent execution:

- small files
- explicit boundaries
- durable metadata
- retrievable task context
- graph-backed execution history

## Product Shape

At a high level, the product becomes four systems that share one graph model.

### Graph runtime

The durable data model, sync model, validation model, and authorization model.

### Module runtime

The installable package system for schema slices, UI, commands, and ingestion.

### Operator surfaces

The web and TUI experiences for browsing, editing, syncing, administering, and
debugging graphs.

### Agent runtime

The graph-native planner, executor, memory layer, and workflow engine.

## Architecture Direction

## 1. Cloudflare deployment model

The deployable unit should be one Worker application plus supporting Cloudflare
resources.

Likely building blocks:

- Workers for HTTP APIs, web delivery, auth hooks, and orchestration
- Durable Objects for authoritative graph partitions and low-latency serialized
  coordination
- R2 for large blobs such as file uploads, documents, and image originals
- Queues for asynchronous ingestion, indexing, import, and fan-out work

This doc avoids hard-coding current platform limits. Deep research should
verify the exact Durable Object, SQLite-backed storage, CPU, request, and
storage limits that apply at the time of execution.

## 2. Durable Object topology

The current repo uses one global graph authority Durable Object as a proof.
That is a good starting point, but not a viable final topology for large
personal graphs.

The likely product shape is a graph directory object plus many shard objects.

### Directory object

Responsibilities:

- graph bootstrap and metadata
- module manifest and installed versions
- shard map
- graph-level capabilities and trust relationships
- query planner entrypoint
- import/export coordination

The directory object should stay small. It is a control plane, not the hot data
plane.

### Shard objects

Responsibilities:

- authoritative storage for a subset of facts
- validation and transaction application for that shard
- local indexes for common predicates
- incremental history and cursor continuity for that shard

### Auxiliary objects

Likely needed later:

- blob ingest coordinators
- background job coordinators
- shared-link or federation coordinators
- module installation/migration coordinators

## 3. Sharding model

The critical scaling decision is how to preserve one logical graph while
spreading storage and compute across many serialized objects.

The default should be subject-home sharding:

- every entity gets a home shard
- facts whose subject is that entity live on that shard
- most single-entity reads and writes stay local
- typed refs still feel singular because the directory layer resolves the home
  shard transparently

This is the cleanest fit for the current append-oriented fact model.

Some data will not fit pure subject-home sharding forever. The design should
allow secondary structures:

- predicate indexes for reverse lookup
- materialized relationship edges for high-value traversals
- time-partitioned event shards for append-heavy logs
- blob metadata shards for large media collections

The system should avoid pretending arbitrary distributed joins are free.
Cross-shard query behavior must be explicit in the query model.

## 4. Query model

A full product cannot stop at local typed entity refs. It needs a query model
that remains efficient after sharding and sharing.

The likely shape is a layered query system:

### Local entity and neighborhood queries

Fast path for:

- fetch entity by id
- fetch fields for one subject
- traverse a small relationship neighborhood

These should hit one shard or a tiny bounded set of shards.

### Indexed collection queries

Examples:

- all contacts with a given tag
- events in a date range
- all emails in one thread

These should rely on shard-local or global materialized indexes, not raw graph
scans.

### Federated queries

Examples:

- fetch linked contact profiles from a trusted external graph
- resolve organization records shared by another person
- let an agent search across explicitly linked project graphs

These should be capability-bounded and plan-driven. The system should not
support arbitrary open-ended distributed graph traversal by default.

The practical rule should be:

- local graph queries may compose freely within the user’s graph
- cross-shard queries require indexes or bounded fan-out
- cross-graph queries require explicit capabilities, explicit entrypoints, and
  cost limits

## 5. Privacy model

The current repo already treats predicate visibility and write policy as graph
metadata. That should become the foundation for product privacy.

The field policy model needs to grow from:

- `visibility: replicated | authority-only`
- `write: client-tx | server-command | authority-only`

into a richer principal-aware policy system.

The product should likely support at least these visibility classes:

- owner-only
- graph-member
- explicitly shared
- public
- authority-only

And at least these write classes:

- local user edit
- authorized member edit
- module command only
- authority/ingest only

The important point is not the exact enum names. The important point is that
policy must attach to predicates and be enforced at:

- sync time
- query planning time
- command execution time
- module installation time
- remote graph linking time

### Auth and principal model

The product should likely use Better Auth as the authentication framework while
still treating graph principals and relationships as graph data.

The clean boundary is probably:

- Better Auth owns protocol-heavy auth concerns such as sessions, provider
  accounts, password/passkey flows, verification tokens, and auth plugins
- the graph owns durable principal entities and relationships such as people,
  users, workspaces, memberships, roles, graph capabilities, sharing grants,
  agent permissions, and audit-linked identity references

That means "store the entities in the graph" should be true for durable
identity and authorization semantics, but not necessarily for every transient
session or verification record Better Auth needs internally.

The product should project Better Auth events into graph entities quickly and
consistently so the graph remains the application model for:

- who the user is
- which graph they own or can access
- which predicates and commands they may read or write
- which external graphs they trust or share with

The current Worker shell is already compatible with this direction because
Better Auth supports standard `Request`/`Response` handlers and documents
Cloudflare Workers support. Its docs also note Cloudflare Worker compatibility
flags for AsyncLocalStorage support and programmatic migrations for the built-in
Kysely adapter in serverless environments.

Deep research should define the exact storage boundary:

- whether Better Auth should run against a dedicated auth SQLite/D1 store and
  mirror into the graph
- whether a custom adapter over graph-adjacent storage is worth the complexity
- which identity records should be canonical in Better Auth versus canonical in
  the graph
- how roles, memberships, and graph capabilities map onto Better Auth sessions
  and plugins

Better Auth references:

- [Installation](https://better-auth.com/docs/installation)
- [Database concepts](https://better-auth.com/docs/concepts/database)
- [Hono integration](https://better-auth.com/docs/integrations/hono)

## 6. Graph linking and federation

This is the hardest and most distinctive part of the product.

The goal is not a globally shared graph with weak boundaries. The goal is many
user-owned graphs that can link under strict policy.

A useful mental model is "capability-based federation."

Each graph can:

- keep data private by default
- expose selected predicates or views to another graph
- grant query capabilities to another graph or principal
- receive imported projections from another graph
- maintain explicit provenance for all remote facts

The system should distinguish:

- local facts authored in the owner graph
- mirrored remote facts imported from another graph
- references to remote entities that remain remote
- derived facts computed from a mix of local and remote data

### Recommended federation pattern

Do not let remote graphs directly query arbitrary raw predicates.

Instead, expose one or more of:

- shared predicates with explicit policy
- shared named views
- shared workflows or commands
- shared indexes designed for federation

That gives the owner graph a narrow, auditable surface.

### Predicate-level sharing

Predicate-level sharing should mean:

- a predicate may be marked shareable
- the owner may grant a capability for that predicate to a target graph or role
- only the allowed value projection is exposed
- hidden sibling predicates remain hidden even when the entity itself is visible

This is stricter than normal table sharing and is a major part of the product
identity.

### Querying across graphs efficiently

Efficiency will depend on precomputed surfaces.

The likely answer is not "run arbitrary remote joins live."
The likely answer is:

- materialize authorized outbound projections
- index those projections for the permitted access patterns
- cache remote results locally with provenance metadata where appropriate
- make cross-graph queries explicit in the planner and UI

Deep research should treat this as a first-class design area, not as an
implementation detail.

## 7. Storage tiers

Not all data belongs in the same storage substrate.

### Graph facts and metadata

Durable Object storage and SQLite-backed state are a natural fit for:

- entities
- edges
- schema metadata
- indexes
- sync cursors
- module manifests
- workflow state
- agent execution records

### Large blobs

Large raw payloads should live outside the graph fact store.

Examples:

- uploaded files
- image originals and derivatives
- document binaries
- email attachments
- imported archives

The graph should store:

- blob identity
- ownership
- hashes
- MIME type
- dimensions or extracted metadata
- processing status
- access policy
- references to the object storage location

### Derived indexes

Some views should be materialized rather than recomputed:

- full-text indexes
- time-range indexes
- relationship indexes
- remote-share projections
- agent retrieval indexes

The exact backend needs research, but the architectural rule is clear:
derived indexes must be rebuildable from authoritative graph and blob state.

## 8. Module system

Modules are central to the product. A module is not just a schema bundle. It is
an installable product slice.

Each module should be able to declare:

- types and predicates
- validation rules
- object views
- workflows
- commands
- query/index requirements
- ingestion connectors
- sync adapters
- blob handlers
- styles and UI components
- permissions it requires
- migrations between module versions

### Module install experience

The target UX should be:

1. user installs a module
2. schema and migrations apply
3. required indexes are created
4. UI routes, views, and commands appear
5. ingest or sync connectors can be configured
6. agents can immediately use the module’s commands and workflows

### Module packaging principles

The current repo already has a strong direction here:

- keep root-safe durable contracts separate from host-specific adapters
- keep type-local authoring close to the schema
- keep modules small and composable

That direction should continue.

One likely packaging shape per module:

- `schema/`
- `views/`
- `workflows/`
- `commands/`
- `ingest/`
- `indexes/`
- `web/`
- `agent/`
- `migrations/`
- `module.json` or equivalent manifest

### Module trust model

Modules should not automatically get full access to the graph.

The system should treat them more like scoped capabilities:

- install-time requested permissions
- declared predicates touched
- declared external services used
- declared background jobs created
- declared blob classes used

This matters because modules are how the platform expands, and they will become
the largest attack surface if left implicit.

### Discovery and installation

Shipping schema with UI, types, commands, and ingestion only works if modules
are discoverable and installable with very low friction.

The product should probably support three discovery modes:

- built-in modules shipped with the default deployment
- installable remote modules from a curated registry
- local or Git-backed modules for private and experimental deployments

Each module manifest should likely describe at least:

- stable module id and version
- compatibility range for the graph/runtime contracts
- provided schema namespaces, types, predicates, and views
- required indexes and background jobs
- required Cloudflare bindings or external services
- required auth capabilities and install-time permissions
- migrations and rollback expectations
- setup instructions or wizard metadata

The install flow should feel like:

1. discover a module by domain, predicates, permissions, or data source
2. inspect what it adds and what it can access
3. install it in one action
4. apply migrations and indexes
5. enable routes, views, commands, and agent hooks
6. configure connectors or credentials if needed

Deep research should decide the actual package substrate:

- npm package
- Git repository
- signed bundle artifact
- registry metadata plus fetched code

The important requirement is that "schema + UI + types + workflows" arrives as
one coherent install unit rather than a manual wiring exercise.

## 9. Core module families

The platform also needs taxonomy discipline. Without it, a graph-first product
will drift into a pile of semantically overlapping predicates and ad hoc module
vocabularies.

### Predicate taxonomy and default schema

The taxonomy should probably have three layers:

#### Core

Small, durable, cross-module vocabulary that almost every graph needs.

Likely examples:

- identity and stable ids
- type membership and labels
- names, titles, descriptions, timestamps
- provenance and external ids
- attachments and blob references
- capability and privacy references

#### Foundation modules

Reusable shared domains that many higher-level modules depend on.

Likely examples:

- person/contact
- organization/workspace
- file/blob
- document/content
- message/thread
- calendar/event
- task/work item
- tag/topic
- secret/integration credential

#### Optional domain modules

Specialized vertical slices that should not be promoted into the shared core
unless they prove broadly reusable.

Examples:

- CRM-specific workflow
- email triage methods
- recruiting pipelines
- personal health logs
- finance or household tracking

The governance rule should be conservative:

- keep `core:` small
- promote to shared taxonomy only when multiple modules truly need the same
  semantics
- prefer explicit module-local predicates over premature global vocabulary
- provide mapping, aliasing, or projection tools instead of forcing one giant
  ontology too early

The out-of-the-box schema should likely include:

- auth and identity foundations
- file/blob and media foundations
- document and note foundations
- people, organizations, and relationship foundations
- calendar and time foundations
- work/task/workflow foundations
- secrets, credentials, and integration foundations
- provenance, sharing, and capability foundations

The initial module roadmap should likely include:

### Personal knowledge

- notes
- documents
- highlights
- tags
- topics

### Files and media

- file uploads
- images
- OCR/extracted text
- previews and thumbnails

### People and communication

- contacts
- organizations
- email accounts
- emails
- threads
- attachments

### Time

- calendars
- events
- tasks
- reminders

### Work

- projects
- streams
- features
- tasks
- runs
- artifacts

### Integrations

- env vars
- API credentials
- sync connectors
- importers

Each of these should be installable as a module family rather than hard-coded
into one monolith.

## 10. Agent-native workflow model

The current repo uses issue-driven automation and Linear integration as the
external work source. That is a useful bootstrap, but not the likely final
product.

The long-term direction should be a graph-native work model.

Core types might include:

- stream
- feature
- task
- run
- session
- artifact
- decision
- context document
- repository
- module
- environment

This does two important things:

### It makes workflow part of the product

The platform stops depending on another system for its core operating model.

### It makes the graph test itself

If the product’s own work, artifacts, commands, and agent state live in the
graph, then schema, UI, sync, permissioning, and agent tooling are constantly
validated against a real workflow.

That is a better proving ground than toy examples.

## 11. Agent memory and context retrieval

One of the main technical advantages of this direction is durable context.

Agents should not start every task cold. They should be able to retrieve:

- the relevant module docs
- prior decisions
- recent related changes
- open questions
- linked artifacts
- execution history
- code ownership and boundaries

The current repo already values module-scoped context assembly. The product
should generalize that into graph-backed retrieval.

A likely model:

- code and docs remain in the repo
- graph stores structured metadata, references, summaries, and execution traces
- agents query the graph for the minimal task-specific bundle they need
- resulting artifacts and decisions go back into the graph

## 12. UI direction

The platform should expose a schema-driven operator interface, but not one that
collapses into a generic auto-generated CRUD shell.

Modules should be able to ship:

- object views
- editing surfaces
- workflows
- dashboards
- inspectors
- sync and authority tools

The graph explorer remains important, but it becomes a power-tool surface, not
the only product UX.

The UI stack should probably have three layers:

- generic graph/devtools surfaces
- module-provided functional UX
- agent/operator workflow surfaces

## 13. Sync model

The current total plus incremental sync contracts are a strong base.

The product will likely need to extend them with:

- shard-aware cursors
- query-scoped sync
- module-scoped sync
- policy-filtered sync per principal
- remote graph sync/import flows
- offline/optimistic local views where appropriate

One likely rule should remain unchanged:

the client only ever syncs the slice it is allowed to hold.

That matters even more once graphs link to each other.

### Partial incremental sync must become a first-class contract

Current whole-graph sync is a good proof surface, but it is not the final
product shape.

The scalable model should be scope-based sync rather than "one cursor for the
entire graph view held by every client."

A sync scope might be:

- one entity neighborhood
- one module slice
- one saved view or query
- one inbox or work queue
- one outbound sharing projection
- one agent context bundle

Each scope needs its own semantics:

- scope definition or definition hash
- principal-aware visibility rules
- completeness state
- per-scope cursor or watermark
- invalidation and fallback behavior
- local cache merge rules

The authoritative runtime should be able to project accepted transactions onto
only the affected scopes. If a scope definition changes, an index is rebuilt,
or a shard boundary moves, the system should fall back for that scope instead
of forcing a full-graph resync.

Deep research should define:

- the scope model and planner contract
- how query-scoped incremental changes are derived efficiently
- how scopes compose into one coherent local graph/runtime
- how partial sync interacts with sharding, privacy, and cross-graph linking
- when to use materialized scopes versus live recomputation

### Push sync depends on live scope registration

The product also needs to explicitly model active client queries and
subscriptions.

If the web client has active views, then push sync cannot be treated as "all
shards somehow know which browser queries exist." That coupling would become too
expensive and too hard to reason about.

The likely architecture is:

- the client registers active sync scopes or live queries with a connection- or
  session-owned subscription layer
- each registered scope compiles to dependency keys such as shards, predicates,
  indexes, or materialized views it depends on
- shards publish invalidations or scoped change events when accepted writes
  affect those dependency keys
- the subscription layer fans those events out to the interested clients

In other words, shards should not track arbitrary browser queries directly.
They should emit structured invalidation signals into a smaller routing layer.

Deep research should decide:

- whether live push should deliver full scoped deltas, invalidation notices, or
  new cursors that force a scoped pull
- whether ad hoc client queries are promotable to temporary live scopes or must
  remain pull-only
- what the right topology is for the subscription layer: per-connection object,
  per-user object, per-scope object, or a hybrid
- how active scopes expire, revalidate, and recover across reconnects
- how to prevent one noisy shard or high-cardinality query from exploding
  fan-out costs
- how live push works for cross-graph and shared-scope subscriptions

## 14. Ingestion model

A serious personal graph product must be able to ingest continuously.

Examples:

- upload a PDF or image
- import a contacts export
- sync an email account
- sync a calendar
- watch a folder or repo
- receive webhook data from external tools

The ingestion pipeline should likely follow this pattern:

1. accept raw input
2. store raw blobs durably
3. enqueue extraction/index work
4. normalize into graph entities and edges
5. attach provenance and sync state
6. surface conflicts or review tasks when confidence is low

This fits well with Queue-backed asynchronous processing and graph-native
workflow tasks.

## 15. Monorepo and development model

The repo should keep the same "script repository" bias:

- one workspace
- small focused files
- explicit docs per area
- fast iteration
- agent-friendly structure

That is not just a code style preference. It is part of the product strategy.

If the system is meant to be built and operated with agents, then the codebase
must stay legible to agents:

- concise files
- stable module boundaries
- strongly named entrypoints
- durable docs close to the code
- graph-backed contextual metadata for active work

## 16. Suggested durable contracts

Deep research should pressure-test the following contract boundaries.

### In `graph`

- fact storage and ids
- schema authoring
- predicate authority metadata
- validation
- typed refs
- sync contracts
- query planner contracts
- module manifest contracts
- federation capability contracts

### In `web`

- browser bootstrap
- module UI loading
- authenticated sync APIs
- operator tooling
- graph explorer and devtools

### In `agent`

- workflow engine
- context retrieval
- execution tracking
- operator sessions
- graph-native planning and artifact storage

### In deployment/runtime

- Worker entrypoint
- Durable Object topology
- blob storage adapters
- queue consumers
- auth and capability enforcement

## 17. Major risks

Deep research should focus heavily on these risks.

### Cross-graph query complexity

This is the biggest architectural risk. Arbitrary graph traversal across many
private graphs will become slow, expensive, and hard to secure if the planner
surface is too open.

### Durable Object partitioning

The design must avoid one hot root object and must not assume one object can
hold an unlimited personal graph forever.

### Index explosion

Predicate-level privacy, module-defined indexes, and federated projections can
create too many derived indexes unless the system has strong conventions.

### Module safety

An installable platform becomes dangerous if module permissions, migrations, and
side effects are not explicit.

### Partial sync correctness

Partial sync is a correctness risk, not just a performance problem. If the
client cannot tell whether a local slice is complete, stale, or invalidated,
then query and agent behavior will quietly degrade.

### Push fan-out and subscription routing

If every active client query becomes a live subscription, the system can create
too much per-query state or too much invalidation fan-out unless scope
registration and dependency tracking are carefully bounded.

### Taxonomy fragmentation

If semantically identical concepts end up modeled by many incompatible
predicates, the graph becomes harder to query, share, and evolve.

### Auth boundary confusion

If Better Auth and the graph both try to be the canonical source for the same
identity and permission records, the platform will accumulate hard-to-debug
drift between session state, graph state, and sharing policy.

### Workflow migration

Moving from Linear-backed automation to graph-native workflow is strategically
correct, but it creates a temporary duplication problem until the native model
is good enough to trust.

## 18. Phased product plan

### Phase 1: strengthen the current single-graph proof

- keep one authoritative graph
- expand schema and module contracts
- harden predicate-level authority rules
- move more current proof data into graph-native modules
- continue improving web explorer and sync tooling

### Phase 2: introduce module installation and blob-backed types

- add module manifests and versioned installation
- add files, documents, and images as first-class modules
- add R2-backed blob references and processing jobs
- add import/export workflows

### Phase 3: replace external workflow dependencies

- model streams, features, tasks, runs, and artifacts directly in the graph
- let the agent runtime operate on those graph-native workflows
- use the system to build itself

### Phase 4: shard one logical graph across many authorities

- add directory plus shard topology
- add shard-aware sync and indexes
- add migration and observability tooling

### Phase 5: add graph linking and controlled federation

- add explicit share capabilities
- add federated projections
- add remote query planning
- add provenance-rich imported facts

### Phase 6: harden multi-user and multi-device operation

- principal-aware policy
- richer auth
- conflict and offline handling
- more complete operator tooling

## 19. Research questions for deep research

The next deep research pass should answer at least these questions:

1. What is the best Durable Object topology for one logical graph with many
   shards, given current Cloudflare storage and compute constraints?
2. How should shard-local and global indexes be designed so common graph and
   module queries stay fast without requiring broad fan-out?
3. What is the cleanest capability model for predicate-level privacy and
   cross-graph sharing?
4. Should remote graph access be exposed primarily as shared predicates, shared
   named views, or command/query endpoints?
5. What storage layers should hold authoritative facts, large blobs, full-text
   indexes, and asynchronous job state?
6. What module manifest shape best balances declarative installability with real
   power for UI, ingestion, and agent behavior?
7. How should the graph-native workflow model replace Linear without losing the
   release discipline and operator visibility the current system already has?
8. How should agent context retrieval be represented in the graph so it remains
   durable, minimal, and cheap to query at task start?
9. Which parts of the current repo should remain proof surfaces, and which
   should be promoted into stable public contracts first?
10. What is the right partial incremental sync contract for query-scoped,
    principal-scoped, and module-scoped sync without losing correctness?
11. How should modules be packaged, discovered, permissioned, versioned, and
    installed so schema, UI, types, commands, and ingestion arrive together?
12. What predicate taxonomy should be considered `core:`, what belongs in
    foundation modules, and what should remain module-local by default?
13. What is the correct architectural boundary between Better Auth and graph
    identity so the graph owns durable principals while Better Auth handles
    sessions, providers, and protocol-heavy auth flows cleanly?
14. How should active web client queries register as live scopes so shard-level
    writes can trigger bounded push sync without coupling shards directly to
    browser queries?
15. For live push, when should the system send full deltas versus invalidations
    versus "cursor advanced, pull this scope again" signals?

## 20. Current Cloudflare facts worth anchoring

The following are platform facts deep research should use as starting anchors,
based on the official Cloudflare docs available on March 18, 2026:

- Durable Objects are the right primitive for strongly coordinated,
  single-instance state, but scale comes from many objects rather than one
  massive singleton.
- Durable Objects support SQLite-backed storage, which makes them attractive
  for shard-local graph state and indexes.
- Cloudflare R2 is the natural storage tier for large unstructured blobs.
- Cloudflare Queues are the natural fit for buffering ingestion, batching, and
  background processing triggered from Workers.

Deep research should still verify current operational limits, pricing, and
recommended product combinations before locking the final topology.

Official references:

- [Cloudflare Durable Objects overview](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Cloudflare Durable Objects SQLite-backed storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Cloudflare R2 overview](https://developers.cloudflare.com/r2/)
- [Cloudflare Queues overview](https://developers.cloudflare.com/queues/)

## 21. Recommendation

Treat `io` as the beginning of an open source personal graph operating system:

- one logical graph per user
- many physical shards under the hood
- predicate-level privacy as a first-class rule
- capability-based graph linking rather than loose federation
- installable modules that bring schema, UI, ingestion, and agent behavior
- graph-native workflow and agent memory

If this works, the product is not just a graph database. It is a personal data,
workflow, and agent platform that people can actually own and extend.
