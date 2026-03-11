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

### 2. Harden the validation lifecycle and built-in types

The first durable validation model is now landed.

That contract is:

- reusable value semantics live with scalar and enum definitions
- predicate-specific rules live with field definitions
- runtime graph invariants stay centralized in the client/store validation path
- local create/update/delete plus typed predicate mutations all preflight before
  touching the real store
- authoritative total-sync payloads validate at the apply boundary before local
  replacement
- callers, explorer surfaces, and future sync flows all consume the same
  structured validation result shape

Read:

- `graph/doc/validation.md`
- `graph/doc/sync.md`
- `graph/src/graph/client.ts`
- `graph/src/graph/sync.ts`

Follow-on work in this area should build on that shared lifecycle rather than
adding new ad hoc checks. The main remaining work is richer built-in scalar and
field helpers plus future async/server-only validation layers on top of the
same result surface.

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
- `graph/src/graph/core.ts`
- `graph/src/graph/type-module.ts`

App and web proof surfaces:

- `app/src/graph/app.ts`
- `app/src/web/bindings.ts`
- `app/src/web/resolver.tsx`
- `app/src/web/generic-fields.tsx`
- `app/src/web/filter.tsx`
- `app/src/web/generic-filter-editors.tsx`
- `app/src/web/company-proof.tsx`
- `app/src/web/relationship-proof.tsx`
- `app/src/web/explorer.tsx`

Architecture and roadmap docs:

- `graph/doc/big-picture.md`
- `graph/doc/overview.md`
- `graph/doc/validation.md`
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
