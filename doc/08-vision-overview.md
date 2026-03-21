# Vision Overview

This document captures the product-facing thesis from
[`../vision.md`](../vision.md). It complements the roadmap docs by focusing on
what the product is supposed to become, not only how the migration should be
sequenced.

## Purpose

`io` is intended to become an open-source personal graph platform that runs on
Cloudflare, gives each user their own graph, supports explicit graph-to-graph
linking under policy, and lets agents operate directly on that graph rather
than on third-party work trackers.

The vision is deliberately ambitious. It is meant to anchor later research,
architecture review, and phased execution planning.

## Starting Point

The vision explicitly builds on the current repo rather than replacing it. The
existing code already proves:

- a reusable graph engine with stable ids, append-oriented facts, schema
  authoring, typed refs, validation, and sync
- authoritative persistence and replay contracts with total and incremental
  sync payloads
- predicate-level authority metadata such as `visibility` and `write` policy
- a Worker-backed web surface with a Durable Object authority wrapper
- root-safe type modules with view, workflow, and command descriptors
- an agent runtime that already understands workflow loading, module-scoped
  context, scheduling, and operator-facing TUI streams

## Product Thesis

The long-term product is a self-hostable personal graph platform. Each user
deploys their own graph to Cloudflare and uses that graph as the durable home
for:

- notes and documents
- uploaded files and images
- contacts and organizations
- calendar entries and meetings
- emails and threads
- tasks, projects, and workflows
- secrets, credentials, and integrations
- agent memory, execution traces, and generated artifacts

The graph is not only storage. It is also intended to be:

- the schema system
- the sync model
- the authorization model
- the UI composition model
- the ingestion model
- the workflow model
- the agent operating model

The central bet is that one logical graph model can power data, UX, and agent
behavior together.

## What Makes The Product Different

The vision positions `io` against the usual split across disconnected SaaS
tools, opaque sync adapters, app-specific databases, and ephemeral agent
context.

The alternative proposed here is:

- one durable personal graph the user owns
- one extensible schema space
- one agent-facing memory and workflow layer
- one consistent privacy model down to the predicate level
- one installable module system for new data types and UIs

The intended feel is closer to a programmable knowledge substrate than to a
single-purpose application.

## Core Product Requirements

### Personal ownership

The project should be open source and deployable by an individual or team to
their own Cloudflare account. That implies:

- no mandatory hosted control plane for core graph access
- reproducible infrastructure setup
- local development that mirrors deployed behavior
- import, export, and backup paths that are not hostage to one vendor

### One logical graph per user, many physical shards

The graph should feel singular to the user even when it is physically
distributed across multiple Durable Objects and storage backends.

### Predicate-level privacy

Privacy and sharing should not stop at the entity or table level. The durable
policy unit is the predicate, with room for more granular rules later.

### Installable modules

Installing a module should immediately bring:

- schema
- validation
- UI views and editors
- workflows and commands
- ingestion and sync adapters
- styling and operator affordances
- agent-facing task and context hooks

### Agent-native workflow

The system should eventually own its own work model rather than treating Linear
as permanent infrastructure.

### Small, focused code and durable agent context

Both the repo and the product should optimize for agent execution:

- small files
- explicit boundaries
- durable metadata
- retrievable task context
- graph-backed execution history

## Product Shape

The vision reduces the product into four systems that share one graph model:

### Graph runtime

The durable data model, sync model, validation model, and authorization model.

### Module runtime

The installable package system for schema slices, UI, commands, and ingestion.

### Operator surfaces

The web and TUI experiences for browsing, editing, syncing, administering, and
debugging graphs.

### Agent runtime

The graph-native planner, executor, memory layer, and workflow engine.
