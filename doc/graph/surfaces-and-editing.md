# Graph Surfaces And Editing

## Purpose

This document describes the next layer above predicate metadata and below
route-local app composition: graph-native surface contracts plus edit-session
semantics.

The goal is to let developers build most application UIs by describing:

- schema, relationships, and field metadata
- collection and record surfaces over those entities
- commands and permissions for business actions
- edit and validation behavior for draft-backed forms

without dropping immediately to route-local React composition for every
collection, form, and create flow.

## Why This Layer Exists

The current stack has strong low-level primitives:

- field metadata and reference policy on type modules
- host-neutral predicate refs and field resolvers
- browser field editors and views in the default DOM adapter
- root-safe `ObjectViewSpec`, `RecordSurfaceSpec`, `CollectionSurfaceSpec`,
  `WorkflowSpec`, `GraphCommandSurfaceSpec`, and `GraphCommandSpec`

That is enough to render individual predicates well, but it is not yet enough
to describe most product surfaces coherently.

The remaining missing pieces are:

- browser and route-level composition over the authored collection and command
  surfaces
- an explicit edit-session model for draft handling and commit timing
- one validation model that spans field parsing, predicate validation, form
  composition, command validation, and authoritative failures

The current code already shows the split:

- update editors often validate and persist on every change
- create flows already use draft-backed predicate refs instead of immediate
  graph writes

That draft-backed create path is the seed of the more general model.

## Design Goals

- keep the root contracts pure data and host-neutral
- derive common application surfaces from schema and commands
- make edit granularity declarative instead of hardcoded inside individual
  editors
- let the same predicate renderer work in both standalone field rows and
  larger forms
- normalize validation so command and authority failures can map back to field
  paths
- avoid inventing an arbitrary widget tree too early

## Non-Goals

- storing raw React component trees in the graph
- replacing route-level composition with a full visual builder
- moving authoritative command execution out of app or authority-owned layers
- forcing every surface into one rigid layout shape

## Proposed Stack

The intended stack is:

1. schema layer
2. surface layer
3. edit-session layer
4. command execution layer
5. route layer

Each layer should stay narrow and composable.

### Schema Layer

The schema layer already describes:

- types and predicates
- cardinality and reference policy
- field metadata such as labels and editor kinds
- read/write policy and shareability

This remains the source of truth for data semantics.

### Surface Layer

The next layer should describe the reusable product surfaces that most apps
need:

- one record view over one entity
- one collection view over a type, relationship, or saved query
- one command surface for business actions
- one future route spec that points at those surfaces

### Current Exported Contract Guidance

The current root-safe authored surface exports on `@io/graph-module` should be
treated as:

- `ObjectViewSpec`: the compatibility-oriented current record-view descriptor
  for callers that already key authored layout by object view
- `RecordSurfaceSpec`: the preferred authored record-surface contract for new
  work, with field and section shapes intentionally aligned with
  `ObjectViewSpec`
- `CollectionSurfaceSpec`: the authored collection export; "collection view"
  in this doc refers to the product concept rather than a second root contract
- `WorkflowSpec`: the stable authored flow descriptor that still references
  `ObjectViewSpec` and `GraphCommandSpec` keys while record-surface and
  command-surface host composition settles
- `GraphCommandSpec`: execution, policy, and I/O shape only
- `GraphCommandSurfaceSpec`: the human-invocation layer for dialog, sheet,
  confirmation, and post-success behavior

### Edit-Session Layer

An edit session is the missing abstraction between predicate renderers and
persistent writes.

It owns:

- draft state
- dirty and touched tracking
- commit policy
- field and form issues
- aggregation for submit or command execution

### Command Execution Layer

Commands remain the authority-owned business boundary. The UI should describe
how commands are presented and how their issues map back to fields, but
execution policy and enforcement still live with command contracts and
authority.

### Route Layer

Routes should eventually be graph-addressable surfaces, but route registration,
shell ownership, and transport remain app concerns until the surface model is
stable.

## Surface Primitives

### Record View

The current `ObjectViewSpec` is the seed of a record view contract.
The first explicitly named authored export for that direction is
`RecordSurfaceSpec`, which intentionally stays structurally aligned with the
current object-view field and section shapes.

That contract should describe:

- the subject entity type
- sections and field rows
- related collections
- available commands
- edit defaults for the surface

Long term, the naming should emphasize that this is an entity-record surface
rather than a generic "object" abstraction.

### Collection View

`entity-type-browser` is really a collection-detail surface, not a reference
editor.
The current authored export name for this layer is `CollectionSurfaceSpec`;
`CollectionView` here refers to the broader product concept rather than a
separate root-safe type.

A collection view should describe:

- its source
  - all entities of one type
  - entities related to a selected subject
  - entities from a saved or inline query
- its presentation
  - list
  - table
  - board
  - card grid
- the fields or render bindings used for rows, cards, or columns
- selection behavior
- collection-level commands
- create affordances
  - create one concrete type
  - choose among several types

This is the durable concept behind the current app-level entity browser.

### First Proving Ground: Scaffolded Entity Table

The first generic `CollectionView` implementation should be a schema-driven
entity table.

That table is likely the highest-leverage scaffolded application surface
because it can provide:

- one durable collection over entities of a chosen type or saved query
- inferred columns from schema or record-view metadata
- inferred cell renderers from predicate display metadata
- inferred editors from predicate editor metadata
- per-row actions from command surfaces bound to the row subject
- bulk actions from selection-scoped command surfaces
- create affordances for one or more entity types

The table should not invent a second collection stack beside the serialized
query work. The intended model is:

- `SavedQuery`: what rows to fetch
- `SavedView`: how to render, page, and parameterize that query result
- `CollectionView`: the higher-level app surface that adds selection, create
  affordances, row actions, bulk actions, and edit behavior

That means the first scaffolded entity table should build on the saved-query
and saved-view substrate rather than bypassing it.

In practice:

- normal table controls should edit filters, sort order, paging, and column
  visibility against the current inline or saved query/view state
- inline query sources are valid for drafts, previews, temporary dialogs, and
  route-local experimentation
- saved views are the durable product-grade path for reusable collection
  surfaces
- advanced users may still open the full query editor against the same saved
  query or saved view

This keeps the read plane centered on one serialized-query stack while letting
the higher-level collection surface focus on actions and editing semantics.

### Command Surface

`GraphCommandSpec` should stay focused on execution, policy, touched
predicates, and I/O shape.

The first authored UI-facing command layer should live beside it as
`GraphCommandSurfaceSpec`.
That split is intentional: record and collection surfaces should reference
command-surface keys for human invocation metadata, while raw command keys stay
the execution and workflow compatibility seam.

Most UIs still need an adjacent contract describing how a human invokes that
command:

- label and icon
- expected subject model
  - no subject
  - one entity
  - many selected entities
  - route or surface scope
- input presentation
  - inline
  - dialog
  - sheet
  - dedicated form
- submit behavior
  - optimistic
  - blocking
  - confirm first
- post-success behavior
  - refresh
  - close
  - navigate
  - open the created entity

Create flows should converge on commands and command surfaces rather than
route-local buttons with bespoke submission logic.

### Route Spec

Routes are a future surface-layer contract, not the first step.

A route spec should eventually describe:

- path and params
- the primary surface to mount
- route-level title and navigation metadata
- search-param bindings for selections, filters, tabs, and open records

The route layer should reference reusable record, collection, and command
surfaces rather than duplicate their shape.

## Field Rendering Contract

Predicate renderers are still the right primitive for field-specific UX, but
the contract should become broader than "one input that writes immediately."

A predicate capability should support three conceptual render modes:

- `view`: read-only presentation
- `control`: the bare interactive input
- `field`: the labeled field row with inline help and validation

That allows:

- dense collection cells and custom layouts to use the bare control
- standard forms to use the full field wrapper
- read-only record views to use the view representation

The parent surface should not need to recreate label, error, and hint plumbing
for every predicate.

## Edit Sessions

Edit sessions should become the standard way field renderers read and write
state.

An edit session may target:

- a live entity update
- a new entity draft
- command input before execution

The important behavior is the same in all three cases.

### Session Responsibilities

An edit session should own:

- the current committed value
- the current draft value
- dirty and touched state
- field-level issues
- form-level issues
- commit and revert operations
- optional batching across several predicate changes

### Commit Policy

Commit timing should be declarative.

On the extracted `@io/graph-react` runtime surface, commit policy is shared
metadata on `EditSessionController.defaultCommitPolicy` and
`EditSessionFieldController.commitPolicy`, not a built-in scheduler. That keeps
the edit-session layer host-neutral while still giving field renderers and
surface composition one common contract for when they should call `commit()`.

Useful modes are:

- `immediate`
- `blur`
- `debounce`
- `submit`

The intended first-pass behavior for those modes is:

- `immediate`: apply the draft mutation and commit it in the same interaction
- `blur`: keep the field dirty while the control is active, then commit on blur
- `debounce`: keep the field dirty until the debounce window expires, then
  commit with the configured delay
- `submit`: keep the session draft-backed until explicit submit or manual
  commit

The first in-repo proving ground stays intentionally narrow: the explorer
generic create dialog currently exposes `{ mode: "submit" }` for both the
session default and the generated field controllers. That documents the
starting behavior for draft-backed create flows without forcing later update or
inline-edit work into the same timing.

Policies should be overridable at several levels:

- field default from schema metadata
- surface default from the record or command form
- app-level fallback by editor kind

This removes the need for each text, number, or structured-value editor to
hardcode its own persistence timing.

### Draft-Backed Predicate Controllers

The current create flow already demonstrates the intended direction: it builds
predicate-shaped draft controllers that expose `get`, `set`, `add`, `remove`,
and `validate*` methods while operating over an in-memory input object.
The explorer generic create dialog is the first in-repo proving ground for
backing those draft predicates with the shared edit-session and field-controller
contracts.

That same mechanism should back:

- create forms
- update forms
- command-input forms

The field renderer should not care whether it is editing a live synced entity
or a draft session. It should talk to one controller contract.

## Validation Model

Validation should be normalized across the whole stack.

Today there are several natural validation phases:

- parse validation inside the field renderer
- predicate and schema validation against a draft or entity
- form-level validation across several fields
- command validation against the full input or selected subject set
- authority or server validation on execution

These should all lower into one issue shape with enough information to route
the issue back to either a field path or the enclosing form.

At minimum an issue should carry:

- a stable path or scope
- a source
- a message
- optional machine-readable code

Field renderers should filter the issue set to their own path. Forms and
command surfaces should aggregate the whole issue set to decide whether submit
is allowed and how errors are presented.

This is how validation should "bubble up" cleanly to create and update
commands.

## Commands At The UI Boundary

Commands should become the default create and mutation boundary for higher
level surfaces.

That means:

- create buttons should usually point at command surfaces
- record views should surface record-scoped commands
- collection views should surface collection or selection-scoped commands
- command results should be able to map field issues back into the active edit
  session

This keeps business rules in commands while still allowing generic surface
renderers to provide useful create and edit experiences.

## Storage Model

The long-term target is for surfaces and routes to be graph-addressable, but
the implementation path should be staged.

### First

Author surface contracts in code beside schema modules so the API shape can
stabilize with type safety.

### Later

Persist graph-backed surface and route entities that reference those stable
contracts or override small pieces of them.

This keeps the first iteration coherent without committing too early to a
fully user-authored layout DSL.

## Package Ownership

### `@io/graph-module`

Owns pure authored contracts:

- record view specs
- collection view specs
- command surface specs
- future route specs
- edit-policy metadata that belongs with schema or authored surfaces

### `@io/graph-react`

Owns host-neutral runtime contracts:

- edit-session primitives
- field-controller contracts
- issue aggregation helpers
- surface resolver primitives that stay free of DOM concerns

The first explicit shared contract layer on that surface is:

- `EditSessionController`
- `EditSessionFieldController`
- `EditSessionCommitPolicy`
- `EditControllerSnapshot`
- `ValidationIssue`
- `PathValidationIssue`
- `ScopedValidationIssue`
- `aggregateValidationIssues(...)`

### `@io/graph-module-core/react-dom`

Owns the default browser implementation:

- field renderers over the shared controller contract
- default field-row wrappers
- collection and record surface defaults for the browser
- command dialogs or inline forms built from the shared surface contracts

### `app`

Owns:

- route registration and shell composition
- authoritative command implementations
- transport
- app-specific surface composition or experiments
- eventual graph-backed route persistence

## Phased Implementation

1. Generalize the current draft controller into a shared edit-session
   controller that can back both create and update.
2. Evolve predicate field capabilities so they render against field
   controllers and issue sets instead of deciding persistence timing
   internally.
3. Extend and stabilize the collection-view contract beside the existing
   record and workflow contracts.
4. Extend and stabilize the UI-facing command-surface contract adjacent to
   `GraphCommandSpec`.
5. Build one generic browser surface in `app/web` that can render record,
   collection, and command surfaces from those contracts.
6. Add route specs and graph-backed persisted surfaces only after the authored
   surface contracts feel stable.

## Fit With The Existing Work

This direction fits the current work rather than replacing it.

- field metadata and reference policy remain on the schema surface
- `ObjectViewSpec` and `WorkflowSpec` remain the starting point for higher
  level surface contracts
- `GraphCommandSpec` remains the execution and policy contract
- the default DOM adapter still owns browser widgets
- the create-draft flow becomes the prototype for a general edit-session model

The shift is mainly to make the missing surface and editing layer explicit so
the next APIs land in one coherent direction instead of accumulating as
route-local helpers.
