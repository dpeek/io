# Vision Product Model

This document covers the product-layer systems from [`../vision.md`](../vision.md):
modules, taxonomy, workflow, agent memory, UI, sync, and ingestion.

## Module System

Modules are treated as the central install unit. A module is not only schema;
it is a product slice.

Each module should be able to declare:

- types and predicates
- validation rules
- object views
- workflows
- commands
- query and index requirements
- ingestion connectors
- sync adapters
- blob handlers
- styles and UI components
- permissions it requires
- migrations between module versions

### Install experience

The target install flow is:

1. user installs a module
2. schema and migrations apply
3. required indexes are created
4. UI routes, views, and commands appear
5. ingest or sync connectors can be configured
6. agents can use the module’s commands and workflows immediately

### Packaging principles

The current repo direction should continue:

- keep root-safe durable contracts separate from host-specific adapters
- keep type-local authoring close to the schema
- keep modules small and composable

One likely module layout is:

- `schema/`
- `views/`
- `workflows/`
- `commands/`
- `ingest/`
- `indexes/`
- `web/`
- `agent/`
- `migrations/`
- `module.json`

### Trust model

Modules should not automatically get full graph access. They should declare
their capabilities up front:

- install-time requested permissions
- predicates touched
- external services used
- background jobs created
- blob classes used

### Discovery and installation

The vision suggests three discovery modes:

- built-in modules shipped with the default deployment
- curated remote modules
- local or Git-backed modules for private and experimental deployments

Each manifest should describe at least:

- stable module id and version
- compatibility range for graph and runtime contracts
- provided namespaces, types, predicates, and views
- required indexes and background jobs
- required Cloudflare bindings or external services
- required auth capabilities and install-time permissions
- migrations and rollback expectations
- setup instructions or wizard metadata

## Core Module Families And Taxonomy

The taxonomy is intentionally layered to avoid turning the graph into one giant
ontology.

### Core

Small, durable, cross-module vocabulary:

- identity and stable ids
- type membership and labels
- names, titles, descriptions, and timestamps
- provenance and external ids
- attachments and blob references
- capability and privacy references

### Foundation modules

Reusable shared domains:

- person/contact
- organization/workspace
- file/blob
- document/content
- message/thread
- calendar/event
- task/work item
- tag/topic
- secret/integration credential

### Optional domain modules

Specialized vertical slices:

- CRM-specific workflow
- email triage methods
- recruiting pipelines
- personal health logs
- finance or household tracking

Governance rules:

- keep `core:` small
- promote to shared taxonomy only when reuse is real
- prefer explicit module-local predicates over premature global vocabulary
- use mapping, aliasing, or projection tools instead of forcing one universal
  ontology too early

### Initial module roadmap

The out-of-the-box product should likely include installable families for:

- personal knowledge: notes, documents, highlights, tags, topics
- files and media: uploads, images, OCR, previews, thumbnails
- people and communication: contacts, organizations, email accounts, emails,
  threads, attachments
- time: calendars, events, tasks, reminders
- work: projects, repositories, branches, commits, sessions, artifacts
- integrations: env vars, API credentials, sync connectors, importers

## Agent-Native Workflow

The current issue-driven Linear integration is treated as a bootstrap, not the
final model. The preferred replacement is a git-native workflow model rather
than a tracker clone.

The long-term workflow types likely include:

- project
- repository
- branch
- commit
- session
- artifact
- decision
- context document
- module
- environment

The vision gives two reasons for this shift:

- workflow becomes part of the product rather than an external dependency
- the graph continuously tests itself because work, artifacts, and agent state
  live inside the same platform

## Agent Memory And Context Retrieval

Agents should not start every task cold. They should be able to retrieve:

- relevant module docs
- prior decisions
- recent related changes
- open questions
- linked artifacts
- execution history
- code ownership and boundaries

The likely model is:

- code and docs stay in the repo
- the graph stores structured metadata, references, summaries, and execution
  traces
- agents query the graph for the minimal task-specific bundle they need
- resulting artifacts and decisions are written back into the graph

## UI Direction

The product should expose a schema-driven operator interface, but it should not
collapse into a generic auto-generated CRUD shell.

Modules should be able to ship:

- object views
- editing surfaces
- workflows
- dashboards
- inspectors
- sync and authority tools

The UI stack should have three layers:

- generic graph and devtools surfaces
- module-provided functional UX
- agent and operator workflow surfaces

The graph explorer remains important, but as a power tool rather than the only
product interface.

## Sync Model

The current total plus incremental sync contracts are treated as a strong base.
The product needs to extend them with:

- shard-aware cursors
- query-scoped sync
- module-scoped sync
- principal-filtered sync
- remote graph sync and import flows
- offline and optimistic local views where appropriate

One rule remains unchanged: the client only syncs the slice it is allowed to
hold.

### Partial incremental sync

Whole-graph sync is only a proof surface. The scalable model is scope-based
sync.

A scope might represent:

- one entity neighborhood
- one module slice
- one saved view or query
- one inbox or work queue
- one outbound sharing projection
- one agent context bundle

Each scope needs:

- a definition or definition hash
- principal-aware visibility rules
- completeness state
- a per-scope cursor or watermark
- invalidation and fallback behavior
- local cache merge rules

### Push sync and live scopes

Live push should be routed through explicit scope registration rather than by
teaching shards about arbitrary browser queries directly.

The likely architecture is:

- the client registers active sync scopes or live queries with a subscription
  layer
- each scope compiles to dependency keys such as shards, predicates, indexes,
  or materialized views
- shards publish invalidations or scoped change events when accepted writes
  affect those dependency keys
- the subscription layer fans those events out to interested clients

The open design question is when to send full deltas versus invalidations versus
"cursor advanced, pull again" signals.

## Ingestion Model

A serious personal graph product needs continuous ingestion. Example inputs
include PDFs, images, contacts exports, email accounts, calendars, folders,
repos, and webhooks.

The likely pipeline is:

1. accept raw input
2. store raw blobs durably
3. enqueue extraction and indexing work
4. normalize into graph entities and edges
5. attach provenance and sync state
6. surface conflicts or review tasks when confidence is low

This aligns with Queue-backed asynchronous processing and graph-native workflow
tasks.
