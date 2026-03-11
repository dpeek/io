# Graph Store — Current Overview

This package is an ID-first graph runtime with key-first schema authoring.

It stores triples (`s`, `p`, `o`) in an append-only store, while schema authors write readable keys like `core:node` and `app:company`.

## Core Principles

- Runtime storage and linking use stable opaque IDs.
- Schema authoring uses readable canonical keys.
- Keys are resolved to IDs at namespace compile time.
- Schema itself is represented as graph data (types + predicates are nodes too).

## Store Model

Source: `graph/src/graph/store.ts`

- A triple is `{ s, p, o }` plus an edge id.
- `assert(...)` appends; `retract(...)` marks edges retracted.
- `facts(...)` returns current non-retracted edges.
- Node ids and edge ids come from the same generator
  (`graph/src/graph/id.ts`, NanoID-based), so edges can be reified as
  subjects.

## Schema Authoring API

Sources:

- `graph/src/graph/schema.ts`
- `graph/src/graph/type-module.ts`
- `graph/doc/validation.md`

- `defineScalar(...)` defines scalar codecs.
- `defineType(...)` defines entity types and field trees.
- `scalarOrEnumTypeModule.field(...)` authors scalar and enum predicates from typed modules.
- `defineReferenceField(...)` authors entity/reference predicates without dropping back to raw edge objects.
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
- Prefer `*.field(...)` or `defineReferenceField(...)` over inline `{ range, cardinality }` objects.

## Core Schema

Source: `graph/src/graph/core.ts`

Core currently defines:

- Scalars: `core:string`, `core:number`, `core:date`, `core:boolean`, `core:url`
- Entity types: `core:node`, `core:type`, `core:predicate`

Notable semantics:

- `core:node:type` range is `core:type`
- Predicate nodes are typed as `core:predicate`
- Schema type/scalar definition nodes are typed as `core:type`

## Namespace ID Maps

Sources:

- `graph/src/graph/core.json`
- `app/src/graph/app.json`
- CLI: `graph/src/graph/ids-cli.ts`

Each namespace keeps its own `key -> id` map next to the schema file.

Current CLI workflow:

- `bun run ids check <schema-file.ts>`
- `bun run ids sync <schema-file.ts> [--prune-orphans]`
- `bun run ids rename <schema-file.ts> <oldKey> <newKey>`

Alias history is intentionally not stored; rename is a direct map-key move.

## Bootstrap

Source: `graph/src/graph/bootstrap.ts`

Bootstrap asserts schema graph metadata into the store:

- Type/scalar defs: key, name, and `node:type = core:type`
- Field tree nodes: key
- Predicate defs: key, name, range, cardinality, and `node:type = core:predicate`

## Typed Client

Sources:

- `graph/src/graph/client.ts`
- `graph/doc/validation.md`

`createTypeClient(store, appNamespace)` exposes typed CRUD handles per entity type:

- `create`, `get`, `update`, `delete`, `list`, `node(id)`
- `query({ select, where? })`
- Scalar encode/decode comes from scalar definitions.
- Validation ownership is split by intent:
  - scalar and enum definitions own reusable value semantics
  - field definitions own predicate-specific rules
  - runtime graph invariants stay centralized in `validateGraphStore(...)`
- Validation runs after lifecycle normalization, simulates the post-apply graph
  on a cloned store, and only then writes to the real store.
- Local preflight callers can inspect `GraphValidationResult` through
  entity-handle `validateCreate` / `validateUpdate` / `validateDelete` helpers
  plus predicate-ref `validateSet` / `validateClear` / `validateAdd` /
  `validateRemove` / `validateReplace`; commit helpers still throw
  `GraphValidationError` with the same structured issues.
- Generic field editors consume that same predicate-ref `validate*` surface
  before they call the mutating helpers, so explorer inline errors come from
  one shared validation result shape instead of exception-only control flow.
- Typed update/delete handles now reject missing nodes and wrong-type nodes at
  the same local validation boundary, so a `company` handle cannot mutate a
  `person` node or silently delete a missing id.
- Delete prechecks validate the simulated post-delete graph before facts are
  retracted, so dangling references never enter local state.
- Client typing remains key-based (from schema keys) even though runtime queries by resolved IDs.
- Predicate fields can define lifecycle callbacks:
  - `onCreate(ctx)` can synthesize/set a value before create assertions.
  - `onUpdate(ctx)` can synthesize/set a value before update assertions.
  - Callback context includes `event`, `nodeId`, `now`, `incoming`, `previous`, and `changedPredicateKeys`.
  - Returning `undefined` means "do not override input for this field".
  - `core:node` now provides timestamp defaults:
    - `createdAt` sets to `now` on create only if not provided.
    - `updatedAt` sets to `now` on create and on updates that touch non-timestamp fields.

### Typed Query Shape

The first user-facing query API is intentionally small:

```ts
const company = await graph.company.query({
  where: { id: companyId },
  select: {
    id: true,
    name: true,
    address: {
      locality: true,
    },
  },
});
```

- `select` controls the exact result shape. Unselected fields do not appear in the result type.
- Scalar and enum predicates use `true` and return decoded values.
- Entity reference predicates support either:
  - `true` to return raw referenced ids
  - `{ select: ... }` to project the nested entity shape
- `where: { id }` returns one result or `undefined`.
- `where: { ids }` returns an array in the requested id order, omitting missing ids.
- Omitting `where` returns all local entities of that type.

### Missing Data And Errors

- Query completeness is not embedded in each query result in v1. Typed queries read the local store, and sync completeness/freshness live in `sync.getState()`.
- Optional predicates resolve to `undefined` when selected and absent.
- Required selected predicates reject if the local store is missing the required fact for an entity.
- Nested entity selections reject if the reference points at an entity that is not present locally.

## Sync

Sources:

- `graph/src/graph/sync.ts`
- `graph/src/graph/store.ts`
- `graph/doc/sync.md`

The first shipped sync contract is a total graph snapshot applied into the local
store.

- `createSyncedTypeClient(namespace, { pull })` exposes a typed client plus a
  pre-bound `sync.sync()` entry point
- `createTotalSyncSession(store, { preserveSnapshot, validate })` remains the
  lower-level store integration surface; `createTotalSyncController(...)` and
  `createSyncedTypeClient(...)` both build on that same session-level apply
  boundary
- lower-level total-sync integrations can reuse the same authoritative
  validation boundary with
  `createAuthoritativeTotalSyncValidator(namespace)` or inspect
  `validateAuthoritativeTotalSyncPayload(payload, namespace, { preserveSnapshot })`
  directly
- incoming snapshots are validated before they replace local state
- `sync.sync()`, `apply(...)`, and `pull(...)` return the materialized payload
  that actually passed validation and replaced local state
- sync payloads carry explicit `mode`, `scope`, `cursor`, `completeness`, and
  `freshness` metadata
- typed queries still read local store state; v1 completeness is tracked in sync
  state because the synced scope is the whole graph
- predicate-slot subscriptions survive total resync and only notify when the
  logical slot value changes

## Runtime + Explorer

Sources:

- `app/src/graph/runtime.ts` example graph sync bootstrap and sample data.
- `app/src/server.ts` explorer API/UI for browsing schema + nodes.

Explorer intentionally surfaces human-readable keys where helpful (`key` when available, fallback to id), but all internal querying uses resolved IDs.

### Explorer Dev Access

- Start (and keep running) with `bun run --cwd app dev`.
- `app` `dev` uses `portless graph bun run --hot-reload --watch ./src/server.ts`.
- Explorer is available at `https://graph.localhost`.
- Agent workflows should call `https://graph.localhost` (and its `/api/*` routes) instead of launching a separate local server process.

## Known Constraints

- Prefer `rangeOf(typeRef)` over passing type objects directly as `range` in `defineType(...)` input.
  - Direct object refs can still degrade TypeScript inference in some paths.
  - `rangeOf(...)` gives object-ref ergonomics with stable type inference.
- Built-in scalar and enum families in `graph/src/type/*.ts` should expose a
  type module so new field work starts from `.field(...)`.
