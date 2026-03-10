# IO Graph Stream

## What This Stream Is About

This stream is about turning the graph stack into a coherent application model,
not just a UI experiment.

The repo has already shipped:

- typed refs
- type modules
- generic web field rendering
- nested, collection, and relationship proofs
- typed filter resolution and a query/filter proof

The next step is to harden the graph model so it becomes the obvious default
application surface for IO.

## Current Focus

The main priorities in this stream are:

### 1. Finalize the new type and field APIs

The migration to the new type-module and field-authoring model should become the
default, not an optional side path.

That means:

- finish moving remaining built-in types and fields to the new APIs
- reduce compatibility seams
- make the authoring model clear enough that new work naturally uses it

### 2. Add validations and richer built-in types

We need a durable validation model rather than ad hoc checks.

This should cover:

- where validation lives in type modules and field definitions
- when validation runs
- how validation interacts with local mutation, server-authoritative checks, and
  future sync
- what built-in scalar or field helpers should exist by default

This needs careful design because validation will eventually sit between:

- user edits
- typed queries
- optimistic local state
- sync reconciliation

### 3. Define the simple user-facing graph API

The client API should feel dead simple:

- get a typed client for the graph
- issue typed queries
- receive promises that resolve to the exact requested shape

This is the beginning of the real data API, not just UI bindings.

### 4. Start the sync model

We should begin with a simple total-sync story, but design it in a way that can
grow into partial and incremental sync later.

The important questions are:

- what the client contract looks like for initial sync
- how query results and completeness are represented
- how local subscriptions and sync delivery fit together
- how we evolve from total sync to partial sync without replacing the whole API

### 5. Keep expanding the explorer

The explorer should become the main graph devtool.

It should make it possible to inspect and edit:

- graph data
- schema definitions
- type and predicate metadata
- eventually query and sync state

The goal is visibility and editability across the whole model, not just
entities.

## Where To Look

Core graph runtime:

- `graph/src/graph/schema.ts`
- `graph/src/graph/client.ts`
- `graph/src/graph/store.ts`
- `graph/src/graph/sync.ts`
- `graph/src/graph/bootstrap.ts`
- `graph/src/graph/app.ts`
- `graph/src/graph/core.ts`
- `graph/src/graph/type-module.ts`

Web and explorer surfaces:

- `graph/src/web/bindings.ts`
- `graph/src/web/resolver.tsx`
- `graph/src/web/generic-fields.tsx`
- `graph/src/web/filter.tsx`
- `graph/src/web/generic-filter-editors.tsx`
- `graph/src/web/company-proof.tsx`
- `graph/src/web/relationship-proof.tsx`
- `graph/src/web/explorer.tsx`

Architecture and roadmap docs:

- `graph/doc/big-picture.md`
- `graph/doc/overview.md`
- `graph/doc/sync.md`
- `graph/doc/typed-refs.md`
- `graph/doc/type-modules.md`
- `graph/doc/web-bindings.md`
- `graph/doc/schema-driven-ui.md`
- `graph/doc/schema-driven-ui-implementation-plan.md`
- `graph/doc/schema-driven-ui-backlog.md`

## Long-Term Goal

Long term, the graph stack should be the foundation for a TS-native data
platform where:

- schema, data, UI semantics, and query/filter capabilities live in one model
- clients get a dead simple typed API
- sync starts simple and evolves to incremental and partial replication
- explorer/devtools make the full system inspectable
- validation and mutation semantics are coherent across local and remote flows

The target is not just a nicer schema DSL. The target is one graph-native app
runtime that can replace a pile of separate form, cache, sync, and admin
tooling.

## Good Changes In This Stream

Good work in this stream usually improves one of these:

- clarity of the core authoring model
- simplicity of the typed client API
- confidence in validation behavior
- realism of the sync story
- usefulness of the explorer as a graph devtool

If a change adds more generic abstraction but does not make the user API,
validation story, or explorer clearer, it is probably too early.
