# Graph Query

## Purpose

Define how the platform will support serialized queries as a stable product and
runtime contract.

This doc covers:

- the canonical serialized query model for transport and planner input
- the durable graph-owned model for saved queries and saved views
- where queries are used across web, workflow, MCP, and future module surfaces
- how query containers and renderer bindings work in the frontend
- how query execution interacts with scoped sync, pagination, and live
  invalidation

It is intentionally broader than the current workflow read proof. The repo
already ships one workflow-specific serialized read envelope, but this doc
defines the reusable platform model that later surfaces should converge on.

## Current State

The repo currently has three different read/query shapes:

- local typed entity queries via `TypeQuerySpec` in
  `../../src/graph/runtime/client-core.ts`
- one workflow-specific serialized read transport via
  `../../src/web/lib/workflow-transport.ts`
- the Branch 3 target `ReadQuery` contract described in
  `../branch/03-sync-query-and-projections.md`

What exists today:

- local typed queries are plain object inputs to the in-process type client
- `POST /api/workflow-read` already serializes workflow board and commit-queue
  queries as JSON request bodies
- authority-owned workflow reads rebuild from authoritative graph state and
  expose `projectionCursor`, `projectedAt`, pagination, and fail-closed
  `projection-stale` semantics

What does not exist yet:

- one reusable serialized query contract across graph, web, MCP, and modules
- durable graph-owned saved-query entities
- a generic query container and renderer binding model
- a web query editor that can build, preview, save, and embed queries

## Goals

- make query serialization a stable contract rather than one route-local shape
- keep queries declarative, bounded, and policy-aware
- let the same query be used transiently over transport or durably as graph
  data
- separate query definition from query rendering so one query can back
  multiple containers
- make query results fail closed under projection rebuild, policy changes, and
  scope changes
- let web UI build queries through an intuitive editor instead of a raw JSON
  textarea

## Non-Goals

- arbitrary graph traversal or user-authored distributed scans
- user-authored executable renderer code stored in the graph
- silent fallback from a bounded query to an unbounded whole-graph scan
- treating query results as authoritative source of truth

## Core Principles

### One query, three representations

The platform should treat queries as the same logical object rendered in three
different forms:

1. authored form:
   the user- or module-authored query definition with parameter references and
   UI metadata
2. serialized form:
   the JSON-safe wire format used over HTTP, WebSocket messages, cache keys,
   and previews
3. normalized form:
   the planner-owned internal representation with resolved ids, defaults,
   validation, dependency keys, and canonical ordering

These forms must round-trip cleanly, but they do not need to be byte-for-byte
identical.

### JSON for transport, graph refs for durable product objects

The platform should not choose one storage style for every layer.

The intended split is:

- transport and client cache keys use JSON envelopes
- durable saved queries and saved views use graph entities and references for
  graph-owned things such as scopes, indexes, fields, modules, and renderers
- planner execution always runs on a normalized internal object

This gives the platform:

- stable wire transport
- durable reference integrity for saved product objects
- canonical hashing and validation for execution

### Stable ids over display keys

Serialized queries may expose human-readable labels in the editor, but durable
and normalized query definitions must identify graph-owned surfaces through
stable ids or named registered runtime ids.

Examples:

- `scopeId`
- `projectionId`
- `indexId`
- `fieldId`
- `rendererId`
- `moduleId`

Display labels remain UI concerns and may change without breaking saved
queries.

### Query definition is separate from renderer binding

The platform should not bake rendering behavior into the query itself.

Instead:

- `QueryDefinition` describes what data to fetch
- `QueryContainerSpec` describes how to page, refresh, and present it
- `RendererBinding` selects an installed item renderer or table/board layout

This lets one saved query power:

- a table in one route
- a card list in another route
- a compact “pick one item” panel in a dialog

## Query Model

### Canonical query families

The generic Branch 3 query surface should stay aligned with the current
read-plane model:

```ts
type ReadQuery =
  | {
      kind: "entity";
      entityId: string;
      selection?: QuerySelection;
    }
  | {
      kind: "neighborhood";
      rootId: string;
      predicateIds?: readonly string[];
      depth?: number;
      selection?: QuerySelection;
    }
  | {
      kind: "collection";
      indexId: string;
      filter?: QueryFilter;
      order?: readonly QueryOrderClause[];
      window?: QueryWindow;
    }
  | {
      kind: "scope";
      scopeId?: string;
      definition?: SerializedScopeDefinition;
      window?: QueryWindow;
    };
```

Rules:

- `entity` and `neighborhood` are the only families that may be satisfied
  directly from authoritative or already-synced graph state without a
  projection
- `collection` must resolve through a declared projection or documented bounded
  plan
- `scope` is the serialized read form for named scope bootstrap or refresh,
  not a backdoor raw traversal primitive

### Query selection

Selection must remain explicit and serializable.

The platform should support:

- entity-style field selection for direct entity and neighborhood reads
- projection-row selection for collection queries where the index exposes
  selectable fields
- renderer-specific presentation selection as a separate concern, not mixed
  into the query

The first generic serialized query spec does not need a full GraphQL-like
selection language. It needs:

- enough selection to avoid over-fetching obvious large payloads
- deterministic serialization
- validation against registered field catalogs

### Query values and parameter references

Saved queries must support reusable parameters.

```ts
type QueryLiteral =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

type QueryValue = { kind: "literal"; value: QueryLiteral } | { kind: "param"; name: string };
```

Parameter definitions are durable metadata owned by the query definition:

```ts
type QueryParameterDefinition = {
  name: string;
  label: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "enum"
    | "entity-ref"
    | "string-list"
    | "entity-ref-list";
  required?: boolean;
  defaultValue?: QueryLiteral;
};
```

Rules:

- parameter names are stable per query definition
- transport requests may override parameter values, but cannot introduce
  undeclared parameters silently
- unresolved required parameters fail validation before execution
- editor labels and descriptions are metadata only; execution depends on name
  and type

### Filter model

Collection queries need a structured filter language rather than an opaque
`Record<string, unknown>`.

```ts
type QueryFilter =
  | { op: "and"; clauses: readonly QueryFilter[] }
  | { op: "or"; clauses: readonly QueryFilter[] }
  | { op: "not"; clause: QueryFilter }
  | { op: "eq"; fieldId: string; value: QueryValue }
  | { op: "neq"; fieldId: string; value: QueryValue }
  | { op: "in"; fieldId: string; values: readonly QueryValue[] }
  | { op: "exists"; fieldId: string; value: boolean }
  | { op: "contains"; fieldId: string; value: QueryValue }
  | { op: "starts-with"; fieldId: string; value: QueryValue }
  | { op: "gt"; fieldId: string; value: QueryValue }
  | { op: "gte"; fieldId: string; value: QueryValue }
  | { op: "lt"; fieldId: string; value: QueryValue }
  | { op: "lte"; fieldId: string; value: QueryValue };
```

`fieldId` means a stable field identifier exposed by the queryable surface. It
does not have to map one-to-one to a raw graph predicate:

- for entity/neighborhood queries it may correspond to a predicate id
- for projection-backed collection queries it may correspond to a projected
  field or synthetic sortable key

The planner must reject unsupported operators for a field instead of attempting
best-effort coercion.

### Ordering and windowing

```ts
type QueryOrderClause = {
  fieldId: string;
  direction: "asc" | "desc";
};

type QueryWindow = {
  after?: string;
  limit: number;
};
```

Rules:

- order clauses must match declared sortable fields for the chosen index or
  query surface
- pagination cursors are opaque to callers
- pagination cursors are tied to the normalized query, principal, and
  projection state used to produce them

## Serialized Transport Model

### Canonical transport envelope

The reusable transport form should be JSON and versioned.

```ts
type SerializedQueryRequest = {
  version: 1;
  query: ReadQuery;
  params?: Record<string, QueryLiteral>;
};

type SerializedQueryResponse =
  | {
      ok: true;
      result: QueryResultPage;
    }
  | {
      ok: false;
      error: string;
      code?: string;
    };
```

This is the transport pattern to generalize from the current workflow-specific
`POST /api/workflow-read` proof.

### Why transport stays JSON

Transport should stay JSON because:

- Worker, browser, MCP, WebSocket, and HTTP all already speak JSON cleanly
- query requests need to be easy to log, hash, cache, and replay in tests
- query previews in the editor need a cheap serialized form
- transport callers should not need graph-entity mutation just to ask a read
  question

### What transport must not carry

Transport envelopes must not carry:

- executable renderer code
- arbitrary host callbacks
- unresolved display labels as durable identity
- hidden policy data that the caller could not already see

## Durable Graph Model

### Durable query objects

When a query becomes part of the product model, it should be stored as graph
data rather than only as an opaque JSON blob.

The durable model should separate:

- `SavedQuery`: the reusable query definition
- `SavedView`: a saved query plus renderer and container preferences
- `QueryContainer`: one placement of a query inside a route, dashboard, or
  module surface

Conceptually:

```ts
type SavedQuery = {
  id: string;
  name: string;
  description?: string;
  queryKind: ReadQuery["kind"];
  sourceRefIds: readonly string[];
  fieldRefIds: readonly string[];
  parameterDefs: readonly QueryParameterDefinition[];
  definitionHash: string;
};

type SavedView = {
  id: string;
  queryId: string;
  rendererId: string;
  rendererParams?: Record<string, QueryLiteral>;
  containerDefaults?: QueryContainerDefaults;
};
```

The exact entity family can change, but the ownership rules should not:

- graph-owned references such as scope, index, field, module, and renderer are
  durable refs, not only inline strings in a JSON blob
- parameter defaults and UI chrome preferences may still be stored as
  structured scalar payloads
- the platform may derive a normalized JSON form and hash for execution and
  caching, but that derived form is not the only durable representation

### Why durable queries should use graph refs

Using graph-owned refs for saved queries gives the platform:

- reference integrity when an index, renderer, or scope is removed
- explicit migration and validation hooks during module install or upgrade
- query discoverability and editability through the graph itself
- incremental sync for saved queries as ordinary product objects

### Derived normalized query record

The platform may still materialize a derived normalized record for fast
execution:

```ts
type NormalizedSavedQueryRecord = {
  queryId: string;
  definitionHash: string;
  normalizedQueryJson: string;
  dependencyKeys: readonly string[];
  updatedAt: string;
};
```

This record is derived and rebuildable from the authoritative saved-query
graph objects plus the installed query catalog.

## Query Catalog And Module Integration

Modules should register queryable surfaces explicitly.

The query catalog is the installed metadata the editor and planner both depend
on. A queryable surface should describe:

- what query family it supports
- which fields are filterable, sortable, and selectable
- which parameter types are valid
- which renderer ids are compatible
- whether the result is local-evaluable, projection-backed, or scope-backed
- which dependency keys and projection ids it may compile to

Conceptually:

```ts
type QuerySurfaceSpec = {
  surfaceId: string;
  moduleId: string;
  queryKind: ReadQuery["kind"];
  sourceKind: "authoritative" | "projection" | "scope";
  projectionId?: string;
  filterFields: readonly QueryFieldSpec[];
  orderFields: readonly QueryFieldSpec[];
  selectionFields?: readonly QueryFieldSpec[];
  compatibleRendererIds: readonly string[];
};
```

This catalog is the contract the web query editor uses instead of hard-coded
per-surface UI logic.

## Query Result Model

### Result page

The generic query result shape should align with current projection-backed
workflow reads while remaining usable for direct entity/neighborhood reads.

```ts
type QueryResultPage = {
  kind: ReadQuery["kind"];
  items: readonly QueryResultItem[];
  nextCursor?: string;
  freshness: {
    projectedAt?: string;
    projectionCursor?: string;
    scopeCursor?: string;
    completeness: "complete" | "incomplete";
    freshness: "current" | "stale";
  };
};

type QueryResultItem = {
  key: string;
  entityId?: string;
  payload: Record<string, unknown>;
};
```

Rules:

- `items[].key` is stable within a result page and suitable for renderer list
  identity
- `entityId` is optional because some collection rows represent projected or
  synthetic row identities rather than one graph entity
- `payload` is already policy-filtered and renderer-safe for the selected
  query surface

### Result kinds and renderers

Not every query result is an infinite list of entities.

The platform should support at least:

- entity detail result
- neighborhood entity list result
- ordered collection row result
- scope result that resolves to collection rows or scoped entities depending on
  the underlying scope class

The container layer, not the query definition, decides whether that result is
shown as:

- table
- card list
- compact picker
- board or grouped list
- detail panel

## Query Container And Renderer Model

### Query container

A query container is the frontend object that combines:

- which query to execute
- which parameter values to bind
- how to page and refresh
- which renderer or layout to use
- what empty, loading, and error chrome to show

```ts
type QueryContainerSpec = {
  containerId: string;
  query: { kind: "saved"; queryId: string } | { kind: "inline"; request: SerializedQueryRequest };
  renderer: RendererBinding;
  pagination?: {
    mode: "paged" | "infinite";
    pageSize: number;
  };
  refresh?: {
    mode: "manual" | "poll" | "push";
    pollIntervalMs?: number;
  };
};

type RendererBinding = {
  rendererId: string;
  rendererParams?: Record<string, QueryLiteral>;
};
```

Rules:

- the same saved query may be used by many containers
- renderer selection is validated against the query surface catalog
- inline queries are valid for drafts, previews, temporary dialogs, and URL
  state
- saved-query containers are the durable product-grade path

### Renderer contract

Renderers are installed module or host components keyed by stable ids.

They are not stored as executable code inside the graph.

A renderer receives:

- one `QueryResultItem`
- container layout context
- selection state and item actions
- optional entity ref if the item maps to a visible entity already present in
  local synced scope state

The container owns:

- fetching and refresh lifecycle
- pagination controls
- loading, error, and empty states
- live registration and invalidation behavior

The renderer owns:

- how one item or row is visually presented
- optional item-level affordances such as open, select, archive, or inspect

### Where query containers will be used

The platform should support query containers in:

- web operator inboxes and workflow boards
- module-owned dashboard and collection surfaces
- search results and saved-view routes
- side panels, pickers, and relation browsers
- agent and MCP surfaces that need stable serialized read requests

## Frontend Query Editor

### Editor goals

The web query editor must be intuitive for non-programmers while still precise
enough for advanced users.

It should make it easy to:

- start from a blank query or module-provided template
- choose a source surface such as a saved scope or collection index
- add filters, sort clauses, selection fields, and parameters
- preview the result in a real query container
- save as a reusable query or saved view
- inspect the normalized JSON representation when needed

### Editor structure

The first query editor should be form-first, not JSON-first.

Recommended editing flow:

1. source picker:
   choose a registered query surface, saved scope, or saved query template
2. filter builder:
   add clauses through typed field-aware controls
3. sort and pagination:
   choose sort fields and default page size
4. parameters:
   promote literals to reusable parameters and set defaults
5. renderer:
   pick a compatible renderer or container preset
6. preview:
   execute the live query under the current principal and show real results
7. save:
   save the query or save the query plus renderer/container binding as a view

### Field-aware controls

The editor should use the query catalog to render intuitive controls:

- enum and closed-option fields:
  combobox or multiselect
- entity refs:
  searchable entity picker with labels and icons
- dates:
  relative and absolute date pickers
- booleans:
  toggle or yes/no segmented control
- text:
  operator picker plus input
- numeric fields:
  range or comparison builder

The editor must display human labels but bind stable field ids internally.

### Advanced mode

Power users still need a low-level inspection path.

The editor should include an advanced disclosure that shows:

- current serialized JSON request
- normalized query hash
- validation errors and unsupported clauses
- live preview status and freshness metadata

Advanced mode is an inspection and controlled edit surface. It is not the
primary authoring path.

### Save behavior

The editor should support two save modes:

- save query:
  create or update a reusable `SavedQuery`
- save view:
  create or update a `SavedView` or container binding that includes renderer
  and default pagination/refresh behavior

The editor should warn when:

- a saved query changed remotely since the draft loaded
- parameter defaults no longer satisfy new validation rules
- the selected renderer is no longer compatible with the query surface

## URL State And Route Integration

Web routes should support both transient and durable query state.

Recommended routing behavior:

- durable routes should prefer `queryId` or `viewId` in URL state
- temporary query-builder previews may store a serialized inline query in
  search params or local draft state
- large or complex inline queries should not be forced into long fragile URLs;
  the route may use draft-local state and only put a short draft id or query id
  in the URL

Rules:

- route state is not the canonical durable source for saved product queries
- durable query definitions live in graph objects
- search params may override parameter values, sort, or page cursor for a saved
  query instance

## Sync, Pagination, And Live Invalidation

### Query definitions versus query results

The platform must distinguish between syncing the query definition and syncing
the query result.

- saved queries and saved views are ordinary graph data and may sync through
  scoped graph sync like any other entity
- query results are derived and should not be treated as authoritative graph
  state
- collection-query pages and projection rows are re-derived from scopes or
  projections, not merged into the base graph store as ordinary facts

### First shipped execution behavior

The initial generic behavior should be conservative:

- `entity` and simple `neighborhood` queries may re-evaluate locally against
  the synced scope cache when the needed data is already present
- `collection` and projection-backed `scope` queries should refresh through the
  authority read surface rather than attempting arbitrary local result patching

This matches the current Branch 3 direction: cursor-advanced invalidation plus
re-pull for most live flows, with direct deltas reserved for later proven
materialized scopes.

### Pagination cursor rules

Pagination cursors must be tied to:

- normalized query hash
- principal or policy interpretation
- projection cursor or scope definition hash, when applicable

If any of those no longer match, the next-page request fails closed.

The generic query container should treat:

- `projection-stale`
- scope-definition mismatch
- policy-version mismatch

as “restart from first page or refresh from the current anchor,” not as a cue
to silently continue with a stale cursor.

### Container behavior on incremental sync

When the underlying synced scope changes, a query container should react based
on query family:

- local-evaluable entity or neighborhood query:
  recompute locally and rerender
- projection-backed collection or scope query:
  mark stale and reissue the query through the authority read surface

The first generic container should not attempt to splice arbitrary projected
rows into an existing paginated list after base incremental sync. That can be
added later for specific materialized scopes with deterministic merge rules.

### Live invalidation behavior

When live registration is active:

- the container registers interest in the active query scope or supporting
  scope dependencies
- invalidation arrives as `cursor-advanced` by default
- the container keeps the last result page readable but marked stale
- the container triggers scoped re-pull or query refresh
- if pagination cursors are no longer valid after refresh, the container resets
  to the first page and preserves UI explanation rather than silently showing
  partial state

### Visibility and viewport rules

The frontend should avoid live work for hidden containers when reasonable.

Recommended behavior:

- visible container:
  keep live registration active
- hidden tab or background panel:
  allow live registration to pause or degrade to cheap heartbeat-only mode
- remount or foreground:
  refresh and re-register before treating the result as current

## Caching And Query Identity

### Query instance key

The frontend query cache should key result pages by:

- query id or normalized inline query hash
- parameter hash
- principal id or policy filter version
- renderer-independent window settings

Renderer choice should not change the data cache key.

### Shared container caches

Many containers may share the same data cache:

- a table and card list over the same saved query
- multiple route panels showing the same parameterized saved view
- a preview pane in the query editor and the saved-view route it edits

Containers may keep different presentation state, but they should not refetch
identical query pages independently unless their refresh policies differ.

## Security And Policy

- query planning runs after principal resolution and before any result leaves
  authority-owned storage
- editor catalogs and renderer catalogs must be filtered by what the current
  principal is allowed to use or see
- saved queries do not grant access; execution still runs under request-time
  policy
- renderer bindings must not bypass row filtering by reaching into raw hidden
  predicates
- query serialization must not leak hidden predicate ids or unsupported fields
  through validation errors more broadly than the current principal can see

## Observability

The platform should expose at least:

- query validation failures by surface and operator
- query execution latency by surface and projection id
- pagination restart counts due to stale cursors
- live invalidation refresh counts
- query editor save failures and incompatible renderer bindings

## Platform Uses

Serialized queries are expected to be used in:

- web collection views and operator dashboards
- workflow board, queue, and inbox surfaces
- saved personal or module-defined views
- MCP and agent read requests where a caller needs a stable transport query
- future shared or embedded query surfaces exposed by installed modules

Not every consumer needs the full saved-view model:

- MCP may use only the serialized transport form
- web dashboards may use saved views and query containers
- internal runtime code may use only the normalized planner form

## Initial Rollout Guidance

1. keep the workflow read transport as the proving ground for serialized query
   envelopes
2. add a reusable generic query request envelope and planner-facing normalized
   form
3. add saved-query and saved-view entities with graph-owned refs
4. ship a web query container plus one form-first query editor
5. layer live registration and WebSocket invalidation onto active containers

## Relationship To Existing Docs

- `./workflow.md` remains the canonical contract for the first shipped
  workflow read surfaces
- `./sync.md` remains the canonical contract for scoped sync payloads and
  fallback behavior
- `../branch/03-sync-query-and-projections.md` remains the canonical branch
  contract for the read plane
- this doc defines how reusable serialized queries, saved views, and frontend
  query containers should fit on top of those contracts
