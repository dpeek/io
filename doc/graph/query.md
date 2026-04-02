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

It is intentionally broader than the current bounded multi-module proof. The
repo already ships one workflow-specific serialized read envelope plus one
generic shared-seam proof across workflow and core module scope surfaces, but
this doc defines the reusable platform model that later surfaces should
converge on.

## Current State

The repo currently has three different read/query shapes:

- local typed entity queries via `TypeQuerySpec` in
  `../../lib/graph-client/src/app.ts`
- one workflow-specific serialized read transport via
  `../../lib/app/src/web/lib/workflow-transport.ts`
- the Branch 3 target `ReadQuery` contract described in
  `../branch/03-sync-query-and-projections.md`

What exists today:

- local typed queries are plain object inputs to the in-process type client
- `POST /api/query` now carries the shared generic serialized query envelope
  over the reusable web transport path
- `POST /api/workflow-read` remains as the workflow-specific compatibility
  proof for the first board and commit-queue reads
- `../../lib/graph-client/src/serialized-query.ts` now exports the first shared
  generic serialized query request, response, and validation helpers for
  Branch 3 transport work
- `../../lib/graph-client/src/http.ts` now exports the shared
  `requestSerializedQuery(...)` helper so browser, MCP, and future callers can
  issue the generic envelope without depending on workflow-specific request
  shapes
- `../../lib/app/src/web/lib/authority.ts` now exposes one reusable
  `executeSerializedQuery(...)` seam that normalizes serialized requests and
  routes the supported families through one registered executor dispatch seam
- installed query-surface catalogs now include bounded workflow and core module
  scope surfaces plus the first reusable core saved-query library surface so
  the generic serialized-query registry is proven across more than one module
  without opening arbitrary scans
- `../../lib/app/src/web/lib/registered-serialized-query-executors.ts` now owns
  the activation-driven executor composition seam that derives shipped bounded
  registrations from the installed workflow and core surface catalogs, so
  authority no longer carries hard-coded workflow surface dispatch branches or
  fixed built-in executor spreads in the main path
- authority-owned workflow reads rebuild from authoritative graph state and
  expose `projectionCursor`, `projectedAt`, pagination, and fail-closed
  `projection-stale` semantics
- authority-owned module scope reads for both `workflow:review-scope` and the
  bounded `core:catalog` surface now execute through the same registered scope
  executor path and reject unsupported windowed pagination
- `@io/graph-module-core` now ships the built-in `core:savedQuery`,
  `core:savedQueryParameter`, and `core:savedView` object types plus typed
  helpers for creating, updating, and traversing those graph-native records
- `@io/graph-module-core` and `@io/graph-module-workflow` both publish their
  built-in module query-surface catalogs from the package root so installed
  registries can compose a bounded multi-module catalog without host-local
  shadow definitions

What does not exist yet:

- one reusable serialized query contract across graph, web, MCP, and modules
- persistence and web-editor cutover onto the built-in graph-owned saved-query
  objects
- a full productized generic query container runtime and editor UI
- a web query editor that can build, preview, save, and embed queries

## Built-In Ownership Today

The current built-in multi-module query-catalog story is:

- `@io/graph-module-core` owns the durable graph objects:
  `core:savedQuery`, `core:savedQueryParameter`, and `core:savedView`
- those core-owned saved-query records store the bound `moduleId`,
  `catalogId`, `catalogVersion`, `surfaceId`, and `surfaceVersion` so they can
  point at any installed module-authored surface
- `@io/graph-module-core` also exports `coreQuerySurfaceCatalog` from the
  package root for the bounded `scope:core:catalog` proof surface plus the
  reusable `core:saved-query-library` collection surface
- `@io/graph-module-workflow` exports `workflowQuerySurfaceCatalog` from the
  package root for the workflow-local projection-backed collection surfaces and
  the `workflow:review-scope` scope surface
- `lib/app/src/web/lib/query-surface-registry.ts` now resolves the shipped
  built-in workflow and core catalogs from built-in manifest activation records
  and each manifest's `runtime.querySurfaceCatalogs`, so installed registry
  composition follows the installed-module contribution seam and still fails
  closed when a built-in module goes inactive or drifts from its manifest

```ts
import { coreManifest } from "@io/graph-module-core";
import { workflowManifest } from "@io/graph-module-workflow";
```

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
    | "url"
    | "email"
    | "color"
    | "percent"
    | "duration"
    | "money"
    | "quantity"
    | "range"
    | "rate"
    | "string-list"
    | "number-list"
    | "boolean-list"
    | "date-list"
    | "enum-list"
    | "entity-ref-list"
    | "url-list"
    | "email-list"
    | "color-list"
    | "percent-list"
    | "duration-list"
    | "money-list"
    | "quantity-list"
    | "range-list"
    | "rate-list";
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
- string-backed scalar and structured families serialize through bounded string
  literals or string arrays rather than arbitrary JSON values
- numeric families such as `number` and `percent` serialize through bounded
  numbers or number arrays
- boolean families serialize through booleans or boolean arrays
- `json` stays outside the shared saved-query parameter contract until the
  platform defines bounded authoring and comparison semantics for it

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

This is now the shared transport shape used by `POST /api/query`, generalized
from the earlier workflow-specific `POST /api/workflow-read` proof.

The checked-in transport contract lives in
`../../lib/graph-client/src/serialized-query.ts` and is exported through
`@io/graph-client`.

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

### Current validation model

The shared request validator rejects malformed or unsupported envelopes before
execution.

Current enforced rules:

- `version` must be the shipped transport version
- `query.kind` must be one of `entity`, `neighborhood`, `collection`, or
  `scope`
- collection queries require a non-empty `indexId`
- scope queries must provide either `scopeId` or `definition`
- parameter values must stay JSON-safe and scalar-valued
- when parameter definitions are supplied, request params cannot introduce
  undeclared names, required params must resolve, and provided/default values
  must match the declared parameter type
- filter clauses reject empty boolean groups, empty `in` lists, unknown
  operators, missing field ids, and unknown parameter references
- order clauses reject empty lists, duplicate `fieldId` entries, and unknown
  sort directions
- windows require an integer `limit > 0`; cursors stay opaque but must be
  non-empty when provided

### Current normalization model

`@io/graph-client` now also publishes a planner-owned normalization helper in
`../../lib/graph-client/src/serialized-query.ts`:
`normalizeSerializedQueryRequest(...)`.

It builds one deterministic internal form from the validated transport request:

- declared parameter overrides are bound before execution
- referenced parameters must resolve from the request or a declared default
- collection filter `and` and `or` groups normalize into stable clause order
- collection `in` operands normalize into stable literal order with duplicate
  values removed
- scope-definition `moduleIds`, `roots`, and neighborhood `predicateIds`
  normalize into stable sorted sets
- pagination cursor state is separated from the normalized query body so the
  same logical query keeps one query hash across page requests

The normalized result also publishes stable hash metadata:

- `queryHash`:
  hash of the normalized query body without the page cursor
- `parameterHash`:
  hash of the effective bound parameters referenced by the query
- `executionContextHash`:
  hash of execution-relevant context such as principal, policy version, scope
  definition hash, or projection cursor
- `requestHash`:
  hash of the normalized query plus the current page cursor
- `identityHash`:
  hash derived from `queryHash`, `parameterHash`, and
  `executionContextHash`

That split gives later pagination, caching, and observability code one stable
query identity without conflating it with one specific page request.

The shipped `POST /api/query` collection path now uses that split directly:

- first-page responses return opaque generic pagination cursors rather than the
  underlying projection cursor format
- follow-up requests validate the cursor against the current normalized query
  identity before delegating to the bounded workflow projection reader
- query-identity or principal/policy mismatches fail closed before any silent
  continuation attempt; projection rebuild mismatches still surface from the
  underlying reader as `projection-stale`

Response validation uses the same fail-closed model:

- success payloads must provide a recognized result kind, an item array, and a
  freshness block with explicit `completeness` and `freshness`
- error payloads must provide a non-empty error string and may include a stable
  error `code`

## Durable Graph Model

### Durable query objects

When a query becomes part of the product model, it should be stored as graph
data rather than only as an opaque JSON blob.

The durable model should separate:

- `SavedQuery`: the reusable query definition
- `SavedView`: a saved query plus renderer and container preferences
- `QueryContainer`: one placement of a query inside a route, dashboard, or
  module surface

The shipped built-in core schema now uses three object types:

```ts
type SavedQuery = {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  queryKind: ReadQuery["kind"];
  surface?: {
    moduleId: string;
    catalogId: string;
    catalogVersion: string;
    surfaceId: string;
    surfaceVersion: string;
  };
  request: SerializedQueryRequest;
  definitionHash: string;
};

type SavedQueryParameter = {
  id: string;
  queryId: string;
  order: number;
  name: string;
  label: string;
  type: QueryParameterType;
  required?: boolean;
  defaultValue?: QueryLiteral;
};

type SavedView = {
  containerId: string;
  id: string;
  ownerId: string;
  queryId: string;
  rendererId: string;
  rendererDefinition?:
    | { kind: "list"; item: QueryListItemRendererDefinition }
    | { kind: "table"; columns: readonly QueryTableRendererColumnDefinition[] }
    | { kind: "card-grid"; card: QueryCardRendererDefinition };
  containerDefaults?: QueryContainerDefaults;
  queryParams?: Record<string, QueryLiteral>;
};
```

The exact field list may still grow, but the ownership rules should not:

- `SavedQuery` owns the durable query identity, normalized hash boundary, and
  module-surface compatibility metadata
- `SavedQueryParameter` keeps reusable parameter definitions as ordinary graph
  records linked back to one saved query instead of burying them in one opaque
  JSON blob
- `SavedView` owns the saved-query binding, renderer selection, parameter
  overrides, container identity, and container defaults
- the platform may still derive a normalized JSON form and hash for execution
  and caching, but that derived form is not the only durable representation

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

The first built-in authority-owned surfaces are now explicit in
`../../lib/graph-module-workflow/src/projection.ts` instead of being only
route-local knowledge:

- `workflow:project-branch-board`: projection-backed `collection`
- `workflow:branch-commit-queue`: projection-backed `collection`
- `scope:workflow:review`: scope-backed `scope`

The current registered executor set supports:

- `entity`: authoritative filtered entity reads
- `neighborhood`: authoritative bounded neighborhood reads
- the two workflow `collection` surfaces above
- the shipped workflow review `scope`
- the shipped core catalog `scope`

The first reusable core product surface is metadata-only for now:

- `core:saved-query-library`: projection-backed `collection` metadata for
  browsing core-owned saved queries by owner, query kind, name, and bound
  surface module with explicit list/table renderer compatibility

It lives in `../../lib/graph-module-core/src/query.ts` instead of workflow
because it is the shared library view over `core:savedQuery` product objects,
not a workflow-local route or projection.

Unsupported collection or scope shapes fail closed with explicit
`unsupported-query` responses; stale or mismatched registered surfaces fail
closed before dispatch; malformed requests fail with `invalid-query`; projection
cursor mismatches remain `projection-stale`.

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
  rendererDefinition?:
    | { kind: "list"; item: QueryListItemRendererDefinition }
    | { kind: "table"; columns: readonly QueryTableRendererColumnDefinition[] }
    | { kind: "card-grid"; card: QueryCardRendererDefinition };
};
```

The first shared web contract for this model now lives in
`../../lib/app/src/web/lib/query-container.ts` and is exported as
`@io/app/web/query-container`. It covers:

- `QueryContainerSpec` for saved and inline query bindings
- `RendererBinding`, `QueryRendererCapability`, and
  `QuerySurfaceRendererCompatibility` for explicit compatibility checks
- `validateQueryContainerSpec(...)` and
  `validateRendererBindingCompatibility(...)` so routes do not infer
  compatibility ad hoc
- `resolveQueryContainerState(...)` for the canonical loading, empty, error,
  ready, paginated, stale, and refreshing container states
- `createQueryContainerRuntime(...)` plus stable cache-key helpers so browser
  surfaces execute saved and inline queries through one controller path with
  shared page caching, per-container pagination state, explicit refresh, and
  fail-closed stale-cursor recovery
- the first shared browser renderer registry in
  `../../lib/app/src/web/components/query-renderers.tsx` with stable built-in ids
  `core:list`, `core:table`, and `core:card-grid`
- the first shared browser mount seams in
  `../../lib/app/src/web/components/query-container-surface.tsx` and
  `../../lib/app/src/web/components/query-route-mount.tsx` so routes can mount query
  containers through shared validation, loading, error, empty, and pagination
  chrome instead of route-local wiring

Rules:

- the same saved query may be used by many containers
- renderer selection is validated against the query surface catalog
- inline queries are valid for drafts, previews, temporary dialogs, and URL
  state
- saved-query containers are the durable product-grade path
- durable scaffolded collection surfaces should usually bind to a `SavedView`,
  which carries the saved-query reference plus renderer and container defaults
- data cache identity is renderer-independent and derived from the resolved
  query identity, execution context, and page settings
- page lifecycle remains container-local through `containerId` even when
  multiple containers share the same cached query pages

For the higher-level collection-surface model that should sit on top of this
query substrate, including the first scaffolded entity-table direction, see
`./surfaces-and-editing.md`.

### Renderer contract

Renderers are installed module or host components keyed by stable ids.

They are not stored as executable code inside the graph.

The first host-owned renderer set now uses stable ids:

- `core:list`
- `core:table`
- `core:card-grid`

A renderer receives:

- normalized query result items for the active page
- container pagination state plus whether another page is available
- loading ownership from the shared query container runtime rather than ad hoc
  fetch logic
- stale and refreshing state so host chrome and renderer layout stay aligned
- explicit declarative item, column, or card definitions

The container owns:

- fetching and refresh lifecycle
- pagination controls
- loading, error, empty, stale, and refreshing states
- live registration and invalidation behavior

The renderer owns:

- how one item or row is visually presented
- optional item-level affordances such as open, select, archive, or inspect

Current built-in table behavior:

- collection-surface bindings first prefer authored fields, then default-selected
  query-surface selections, then ordering and filter metadata before falling
  back to active payload keys
- the shared `core:table` renderer treats those inferred fields as the primary
  columns instead of prepending debug-first key/entity columns
- page-local row selection stays renderer-owned so later collection or
  selection-scoped command surfaces can layer on the same table path

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
- url, email, color, and structured string-backed kinds such as duration,
  money, quantity, range, and rate:
  text-first inputs that preserve the richer contract kind while still binding
  bounded string literals
- percent:
  numeric input with the richer contract kind preserved for saved-query and
  hydration compatibility

The editor must display human labels but bind stable field ids internally.

Compatibility rules for richer kinds:

- saved-query and saved-view compatibility still hinges on installed
  `catalogVersion` and `surfaceVersion`; richer field kinds do not loosen those
  boundaries
- editor hydration may map richer kinds into current text, number, boolean, or
  date controls, but it must preserve the original contract kind in the draft
  and fail closed on unknown kinds rather than guessing semantics
- list-backed richer parameter types must stay aligned with the underlying
  bounded literal family used by transport validation

Current first-surface support boundary:

- supported query-authoring field families are the single-value kinds:
  `enum`, `entity-ref`, `date`, `boolean`, `text`, `number`, `url`, `email`,
  `color`, `percent`, `duration`, `money`, `quantity`, `range`, and `rate`
- excluded query-authoring field families are the explicit list-valued kinds:
  `enum-list`, `entity-ref-list`, `date-list`, `boolean-list`, `text-list`,
  `number-list`, `url-list`, `email-list`, `color-list`, `percent-list`,
  `duration-list`, `money-list`, `quantity-list`, `range-list`, and
  `rate-list`
- excluded list-valued families fail closed in the editor, hydration, and
  saved-query compatibility checks instead of being coerced onto scalar
  comparisons; the first `/query` authoring surface does not yet define list
  membership or overlap semantics for field values
- list parameter definitions remain supported for `in` filters over supported
  single-value fields because those serialize through bounded literal arrays and
  do not imply list-valued field semantics

Current field-family mapping through the shared authoring path:

- `enum` and `entity-ref` stay on select-backed ref controls; scalar filters use
  `enum` and `entity-ref` parameter types, while `in` filters use the matching
  `enum-list` and `entity-ref-list` parameter types
- `date` stays on the date control and serializes to canonical ISO timestamp
  strings for both literals and parameter defaults
- `boolean` stays on the boolean control; `eq` and `neq` use the `boolean`
  parameter type, while `exists` intentionally serializes as a bare boolean
  flag instead of a query value envelope
- `text` and `number` stay on the current text and number controls with the
  matching `string`, `number`, `string-list`, and `number-list` parameter
  families
- `url` and `email` keep their richer contract kinds for equality and `in`
  filters, but `contains` and `starts-with` intentionally fall back to string
  semantics and therefore require `string` parameters rather than `url` or
  `email`
- `color`, `percent`, `duration`, `money`, `quantity`, `range`, and `rate`
  stay on the shared predicate-backed editor path, preserve the richer field
  kind in the draft and hydrated surface metadata, and serialize canonical
  string or numeric literals plus the matching scalar and `*-list` parameter
  families
- excluded `*-list` field families fail closed during surface validation, draft
  serialization, hydration, and saved-query compatibility checks instead of
  being coerced into scalar comparisons
- hydration only reopens collection or named scope requests, flattens `and`
  filters, and rejects `or`, `not`, mixed literal-plus-param `in` payloads, and
  excluded field families instead of guessing a form draft shape

Current proof status:

- `../../lib/graph-module-core/src/react-dom/query-editor.ts` now defines the
  shared form-first draft, query surface catalog, validation rules, and
  serialization bridge into the generic `SerializedQueryRequest` plus
  `QueryParameterDefinition[]`
- `../../lib/graph-module-core/src/react-dom/query-editor-authoring-coverage.test.ts`
  now enumerates every supported single-value field family, every matching
  supported `in` list-parameter family, the intentional `url` and `email`
  string-search exception, and every excluded list-valued field family so the
  current support boundary stays explicit instead of accidental
- `../../lib/graph-module-core/src/react-dom/query-editor-component.tsx` now
  reuses the shipped predicate-aware browser field editors for single-value
  filter operands and scalar parameter defaults through synthetic predicate
  adapters, while keeping bespoke list authoring only where no shared many-value
  editor exists yet
- `../../lib/graph-module-core/src/react-dom/query-editor-catalog.ts` now maps
  installed module query-surface registries into that shared editor catalog so
  browser consumers can stay on one reusable authoring surface
- `../../lib/graph-module-core/src/core/saved-query.ts` now defines the
  built-in graph-native `SavedQuery`, `SavedQueryParameter`, and `SavedView`
  schema plus typed helper functions for durable graph reads and writes
- `../../lib/app/src/web/lib/saved-query.ts` now defines the reusable saved-query
  and saved-view graph-backed repository plus normalized-derivation seams used
  by planner, editor, and container code, including graph-native definition
  reads/writes and normalized saved-record resolution against the installed
  query catalog
- `../../lib/graph-module-core/src/react-dom/query-editor-component.tsx` now
  mounts that draft model through typed source, filter, sort, pagination, and
  parameter sections
- `../../lib/app/src/web/lib/query-surface-registry.ts` now composes the
  built-in workflow-plus-core registry from built-in manifest activation state
  and publishes
  `installedModuleQueryEditorCatalog` for app/web consumers
- `../../lib/app/src/web/lib/query-route-state.ts` now defines the explicit
  `/query` route-search contract for draft previews, saved query or view
  reopen selection, parameter overrides, and route-addressable preview
  renderer/page-size state
- `../../lib/app/src/web/lib/query-workbench.ts` now focuses on draft preview
  serialization, browser-safe base64url route encoding, shared saved-source
  resolution with parameter overrides, and the shared preview-runtime helper
  that resolves saved queries before executing through `/api/query`
- the current `/query` route now uses that shared workbench path to:
  preview inline drafts in a real query container, mount a dedicated results
  panel beside the editor, reopen saved queries or saved views from route
  state, rehydrate the form editor from those saved definitions, update the
  active saved ids without losing query identity, carry preview
  renderer/page-size state through the route, apply parameter overrides, keep
  the initial workflow branch-board draft local-only until a required
  `projectId` filter is filled so first load does not hammer `/api/query` with
  unsupported requests, and
  fail closed when a saved query, saved view, route draft, or saved-route
  parameter override becomes invalid or stale, including current-catalog
  hydration failures when a previously saved surface definition, catalog
  version, or saved-view/query binding no longer matches the installed
  contracts
- `../../lib/app/src/web/components/query-page.tsx` now keeps `/query` behind
  the same graph-access gate and synced-runtime bootstrap model as the other
  graph-backed web routes, then binds the principal-scoped graph-backed
  saved-query/view library into the shared workbench so list-pane reopen and
  save flows no longer depend on a browser-local cache
- `../../lib/app/src/web/lib/authority.ts` now routes the principal-scoped
  only durable saved-query/view persistence path through graph-native
  saved-query and saved-view objects for non-route consumers, with proof
  coverage in
  `../../lib/app/src/web/lib/authority.test.ts` and
  `../../lib/app/src/web/lib/graph-authority-sql-saved-query.test.ts` for
  restart persistence, normalized re-derivation, installed-catalog validation,
  and stale-ref recovery, while
  `../../lib/app/src/web/components/query-page.test.tsx` now proves the `/query`
  route itself can list, save, remount, reopen, and update those graph-backed
  saved-query/view records end to end

Current consumption seams:

- editor consumers should use `@io/graph-module-core/react-dom` for the shared
  `QueryEditor` component or `@io/graph-module-core/react-dom/query-editor` for
  draft helpers, then `@io/app/web/saved-query` save helpers to produce durable
  saved-query and saved-view records
- planner and container consumers should resolve saved records through
  `@io/app/web/saved-query` resolution helpers or the matching
  `WebAppAuthority.resolveSavedQuery(...)` and
  `WebAppAuthority.resolveSavedView(...)` seams so normalized requests,
  parameter overrides, and catalog compatibility stay centralized
- generic serialized transport remains separate: callers that already have a
  validated serialized request should continue using `/api/query` or
  `executeSerializedQuery(...)` instead of wrapping that request inside a
  saved-query object

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
- parameter hash
- principal or policy interpretation
- projection cursor or scope definition hash, when applicable

If any of those no longer match, the next-page request fails closed.

The generic query container should treat:

- `projection-stale`
- scope-definition mismatch
- policy-version mismatch

as “restart from first page or refresh from the current anchor,” not as a cue
to silently continue with a stale cursor.

For the shipped generic route, that means callers should discard the old
cursor, rerun the active query from page 1, or refresh the active query before
trying to page again.

The current shared web runtime makes that explicit in two more cases:

- changing saved-query params or any other query-identity input creates a new
  cache identity and restarts from page 1
- changing principal or policy interpretation also creates a new cache
  identity, so the container does not try to reuse a page cursor from the old
  policy view

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

Under the current Branch 3 fail-closed model, that refresh path is always a
restart-or-requery path for generic query containers rather than a row-level
delta merge.

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

The shipped shared runtime now makes that split explicit:

- one data cache key per resolved query identity and execution context
- one page key per opaque pagination cursor under that data cache key
- one container instance key per `containerId` plus data cache key so repeated
  mounts can retain local page position without forcing independent refetches

Refreshing resets the active instance back to page 1 and clears cached
continuation pages for that query identity.

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
