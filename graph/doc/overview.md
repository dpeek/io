# Graph Store — Current Overview

This package is an ID-first graph runtime with key-first schema authoring.

It stores triples (`s`, `p`, `o`) in an append-only store, while schema authors write readable keys like `core:node` and `app:company`.

## Core Principles

- Runtime storage and linking use stable opaque IDs.
- Schema authoring uses readable canonical keys.
- Keys are resolved to IDs at namespace compile time.
- Schema itself is represented as graph data (types + predicates are nodes too).

## Store Model

Source: `src/store.ts`

- A triple is `{ s, p, o }` plus an edge id.
- `assert(...)` appends; `retract(...)` marks edges retracted.
- `facts(...)` returns current non-retracted edges.
- Node ids and edge ids come from the same generator (`src/id.ts`, NanoID-based), so edges can be reified as subjects.

## Schema Authoring API

Source: `src/schema.ts`

- `defineScalar(...)` defines scalar codecs.
- `defineType(...)` defines entity types and field trees.
- `rangeOf(...)` normalizes a range ref to a key string while preserving TypeScript inference.
  - Supports `rangeOf("core:number")`
  - Supports `rangeOf(core.number)` and `rangeOf(company)`
- `defineNamespace(idMap, namespace)` resolves keys to IDs and returns a resolved namespace.

### Key vs ID Rules

- Keep `values.key` and field `key` as canonical, readable identifiers.
- After `defineNamespace(...)`, runtime IDs are present and used via:
  - `typeId(...)`
  - `edgeId(...)`
  - `fieldTreeId(...)`
- Field `range` is overwritten to resolved ID when possible.

## Core Schema

Source: `src/schema/core.ts`

Core currently defines:

- Scalars: `core:string`, `core:number`, `core:date`, `core:boolean`, `core:url`
- Entity types: `core:node`, `core:type`, `core:predicate`

Notable semantics:

- `core:node:type` range is `core:type`
- Predicate nodes are typed as `core:predicate`
- Schema type/scalar definition nodes are typed as `core:type`

## Namespace ID Maps

Sources:

- `src/schema/core.json`
- `src/schema/app.json`
- CLI: `src/ids-cli.ts`

Each namespace keeps its own `key -> id` map next to the schema file.

Current CLI workflow:

- `bun run ids check <schema-file.ts>`
- `bun run ids sync <schema-file.ts> [--prune-orphans]`
- `bun run ids rename <schema-file.ts> <oldKey> <newKey>`

Alias history is intentionally not stored; rename is a direct map-key move.

## Bootstrap

Source: `src/bootstrap.ts`

Bootstrap asserts schema graph metadata into the store:

- Type/scalar defs: key, name, and `node:type = core:type`
- Field tree nodes: key
- Predicate defs: key, name, range, cardinality, and `node:type = core:predicate`

## Typed Client

Source: `src/client.ts`

`createTypeClient(store, appNamespace)` exposes typed CRUD handles per entity type:

- `create`, `get`, `update`, `delete`, `list`, `node(id)`
- Scalar encode/decode comes from scalar definitions.
- Client typing remains key-based (from schema keys) even though runtime queries by resolved IDs.
- Predicate fields can define lifecycle callbacks:
  - `onCreate(ctx)` can synthesize/set a value before create assertions.
  - `onUpdate(ctx)` can synthesize/set a value before update assertions.
  - Callback context includes `event`, `nodeId`, `now`, `incoming`, `previous`, and `changedPredicateKeys`.
  - Returning `undefined` means "do not override input for this field".
  - `core:node` now provides timestamp defaults:
    - `createdAt` sets to `now` on create only if not provided.
    - `updatedAt` sets to `now` on create and on updates that touch non-timestamp fields.

## Runtime + Explorer

Sources:

- `src/runtime.ts` example graph bootstrapping and sample data.
- `web/server.ts` explorer API/UI for browsing schema + nodes.

Explorer intentionally surfaces human-readable keys where helpful (`key` when available, fallback to id), but all internal querying uses resolved IDs.

### Explorer Dev Access

- Start (and keep running) with `bun run dev`.
- `dev` uses `portless graph bun run --watch ./web/server.ts`.
- Explorer is available at `https://graph.localhost`.
- Agent workflows should call `https://graph.localhost` (and its `/api/*` routes) instead of launching a separate local server process.

## Known Constraints

- Prefer `rangeOf(typeRef)` over passing type objects directly as `range` in `defineType(...)` input.
  - Direct object refs can still degrade TypeScript inference in some paths.
  - `rangeOf(...)` gives object-ref ergonomics with stable type inference.
