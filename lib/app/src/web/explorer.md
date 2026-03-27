# Explorer Proposal

## Purpose

Describe the long-term explorer design for the web app.

The target outcome is a single type-first surface that can inspect the full
graph, edit live graph-backed metadata through shared field editors, create new
entities without bespoke per-type forms, and reduce the number of custom views
the app needs to maintain.

This document is a proposal for the destination architecture. The current
explorer already uses the canonical `/graph` route and type-first selection
model, a shared inspector shell, draft-backed generic create for
client-writable entity types, and opt-in debug disclosures for raw ids and
keys. Old section-route aliases and explorer compatibility shims are gone.
Some other app surfaces still keep separate shortcut create flows.

## Problem Summary

The original explorer was split into separate `entities`, `types`, and
`predicates` modes. That split leaked into routing, selection state, list
composition, and the right-hand inspector implementation.

The current `/graph` surface has already collapsed those modes into one
type-first route, one shared inspector shell, and a draft-backed generic create
path inside the explorer.

That creates a few long-term problems:

- the surface is mode-first instead of graph-first
- the entity list does not represent all live entity types in the graph
- some non-explorer entrypoints still keep bespoke create shortcuts for topics
  or tag create-and-link flows
- ids and keys are visible in too many places, so the UI reads like a debug
  console instead of an operator tool

The explorer should instead answer one question:

What type am I looking at, which record of that type am I looking at, and how
do I edit it through the same field surface used everywhere else?

## Goals

- remove the top-level `entities`, `types`, and `predicates` filters
- make the first column a list of all graph types in the explorer namespace
- make the second column show the selected type's schema row plus its instances
- make the third column a single inspector shell
- let schema inspection and instance inspection share as much rendering logic as
  possible
- support creation of new entities through one consistent flow
- stop using ids and keys as primary UI labels
- preserve access to compiled-schema context where that context matters
- keep env vars valid without keeping env vars special
- preserve the current reusable field editor surface for markdown, svg, color,
  enum, reference, and secret-backed fields

## Non-Goals

- live schema recompilation from editing `core:type` or `core:predicate`
  metadata
- treating scalar values as first-class entity instances
- removing every special field interaction
  secret writes, markdown preview, and svg preview are still legitimate shared
  field-level custom behavior
- collapsing the dedicated sync page into the explorer

## Design Principles

### Type-first, not mode-first

The explorer should pivot around a selected type, not a selected tab.

Types already unify the things operators care about:

- domain records such as topics and env vars
- support entities such as tags and icons
- schema metadata entities such as `core:type` and `core:predicate`
- scalar and enum definitions that need schema inspection even when they do not
  have data instances

Now that the explorer is type-first, the dedicated type and predicate modes are
no longer necessary in routing or selection state.

### One inspector shell

The right-hand pane should not care whether the selection came from a schema row
or an instance row. It should always render:

- a header
- shared field rows
- optional supplemental sections when the selection has compiled-schema context

That is the core change that reduces custom views.

### Friendly labels first

Display names, labels, icons, and path labels should do most of the work.

Ids and keys may still exist for search, debugging, or copy actions, but they
should not be the default visible label in list rows, breadcrumbs, or badges.

### Generic creation needs a real foundation

The graph client already supports generic `validateCreate(...)` and
`create(...)` for every entity handle. That is necessary but not sufficient.

The missing primitive is a draft binding layer that can drive the same editor
surface before an entity exists. Without that, the app will keep growing
bespoke create panels.

## Proposed Information Architecture

### Route model

The canonical route should become:

- `/graph`

The selection should be encoded in search params:

- `type=<type-id>`
- `target=schema`
- `target=new`
- `target=<entity-id>`

Optional future params may include:

- `q=<instance-query>`
- `field=<path-label>` for deep-linking to a field row

### Column 1: Types

The first column should list all types in the explorer namespace.

On wide screens, the three explorer columns should share the available viewport
height and scroll independently rather than turning the whole page into one
long document.

Each row should show:

- icon
- human display name
- small kind badge such as `entity`, `enum`, or `scalar`
- instance count when the selected type kind is an entity type

The type list should be sourced from the full explorer namespace, not from a
hand-picked entity catalog.

That means the column includes ordinary product types and core support types
such as:

- `workflow:document`
- `workflow:envVar`
- `core:tag`
- `core:icon`
- `core:type`
- `core:predicate`
- `core:secretHandle`
- scalar and enum definitions such as `core:string`, `core:markdown`, and
  `workflow:documentBlockKind`

### Column 2: Targets

The second column should always be scoped to the selected type.

It should contain, in order:

1. a pinned `Schema` row
2. a pinned `New <Type>` row when creation is available
3. the live instances of the selected type

This column should not change meaning based on a top-level mode. Its job is
always:

- first let the operator choose whether they want the type schema or data
- then let them choose a specific instance

For scalar and enum types, the second column may legitimately contain only the
`Schema` row and no instance rows.

For zero-instance entity types, the second column still shows `Schema` and
`New <Type>`.

### Column 3: Inspector

The third column should be one inspector shell with three states:

- schema selection
- new-entity draft selection
- existing-entity selection

The shell should keep the same outer layout in all three states so the page
does not visually jump between unrelated screens.

## Selection Semantics

### Schema selection

Selecting the `Schema` row means:

- the inspector edits the selected type's live `core:type` entity metadata
- the inspector also shows compiled-schema supplements for the represented type

That allows one surface to show both:

- editable graph metadata
- authored compiled definition context

### Existing entity selection

Selecting a normal instance row means:

- the inspector renders the instance through the generic entity field editor
- the shared field section may prepend compact readonly metadata pairs such as
  record id, type, and timestamps when that context helps
- optional field create and clear affordances should live inside the field
  editors rather than shared row chrome
- the same shared field components continue to own markdown, svg, enum,
  reference, color, and secret-backed behavior

This should be the default editing path for most entities in the system.

### New entity selection

Selecting `New <Type>` means:

- the inspector renders a create draft for the selected type
- user-editable fields render in one shared list
- optional fields render through the same shared field editors used for live
  entities, including their unset states
- after commit, the new entity becomes the selected instance

The create state should live in the same inspector shell rather than opening a
completely unrelated panel.

## Inspector Composition

### Shared header

The header should be shared across schema and instance selections.

It should include:

- the display icon
- the display name
- the selected type label
- a small status line such as `Schema`, `New Topic`, or `Topic`

The header should avoid raw ids and raw keys in its default presentation.

### Shared field rows

The explorer should keep using shared predicate rows and the existing field
resolver stack for actual field editing.

That means the normal field system remains responsible for:

- scalar parsing and formatting
- combobox-backed enum selection
- Base UI reference picking
- tag combobox behavior on top of that shared Base UI combobox
- markdown source and preview
- svg source and preview
- shared `ColorInput` color editing with an inline swatch trigger
- secret-backed command flows

The explorer should prefer composition around that field system rather than
recreating field widgets at the screen level.

Unset optional rows should still use the shared row heading, but their create
and clear affordances should come from the field editor itself rather than a
renderer-owned `+` or `x` control.
For optional text editors specifically, the editor should collapse down to an
inline add button, expose an inline clear button when active, and treat an
empty draft on blur as an unset edge rather than a persisted empty string. The
`+` affordance should focus the revealed input or textarea immediately.

### Supplemental sections

The inspector should support optional supplemental sections that appear only
when they add real value.

The key long-term supplements are:

- compiled field tree for selected type schemas
- enum options for enum schemas
- scalar codec notes for scalar schemas
- compiled predicate usage for selected `core:predicate` entities
- metadata-only warning copy for selected `core:type` and `core:predicate`
  entities

These are still custom sections, but they are custom sections inside one shared
inspector shell rather than separate custom screens.

## Type Categories And Their UX

### Ordinary entity types

Examples:

- topics
- env vars
- tags
- icons

Flow:

- column 1 selects the type
- column 2 shows schema plus instances
- column 3 edits the schema or the chosen instance

This is the core happy path and should define the overall design language.

### `core:type`

`core:type` is both:

- a type in column 1
- the metadata entity used for schema editing

That recursion is acceptable and useful.

Selecting `core:type` should show:

- a `Schema` row for the `core:type` type itself
- the instances of `core:type`, which are the graph's type metadata entities

The UI should deduplicate obvious confusion where possible. If the selected
schema row and one instance row resolve to the same underlying entity, the list
should avoid showing two visually identical entries.

Creating new `core:type` entities should be possible in the generic system, but
the inspector must clearly say that this creates graph metadata only and does
not compile a new runtime type definition.

### `core:predicate`

`core:predicate` should work like any other entity type:

- schema row at the top
- predicate instances below
- generic metadata editing in the shared inspector

Selected predicate instances should also show a compiled usage supplement so the
operator can answer:

- which authored type fields use this predicate
- what the compiled range and cardinality are

This replaces the dedicated predicate mode without losing the important authored
context.

### Scalar types

Scalar types do not have data instances in the same sense as entity types.

For scalar selections, the UX should be:

- schema row only
- no empty promise that there should be standalone scalar records
- a schema supplement that explains the scalar's role and, where useful, the
  display/editor behavior it enables

Actual scalar values continue to be inspected through entity fields.

### Enum types

Enum types similarly do not need a list of data instances.

For enum selections, the schema inspector should show:

- editable graph metadata for the enum type's `core:type` entity
- a compiled options supplement

The options supplement should present friendly names and descriptions, not raw
ids as the primary display value.

### Secret-backed support types

`core:secretHandle` should be inspectable like any other entity type.

Creation should remain technically possible through the generic create system,
but the default UX should steer operators toward the meaningful flow:

- create or select the owning entity
- write the secret through the secret-backed field editor

That keeps secret handle creation explicit without pretending that manual handle
creation is the usual operator action.

## Labeling Rules

The explorer should adopt a strict default labeling policy:

- use `name` first when present
- fall back to `label`
- fall back to a type-aware human display label
- fall back to a localized generic label such as `Untitled Topic`

The explorer should not use raw ids or raw keys as default row subtitles.

Acceptable exceptions:

- explicit copy actions
- hidden search keywords
- an advanced debug disclosure that is off by default

This rule applies to:

- type rows
- schema rows
- instance rows
- breadcrumbs
- inspector badges
- predicate supplemental sections

## Search And Filtering

The target design removes top-level mode filters, not search.

Recommended search behavior:

- column 1 search filters types by friendly label, secondary aliases, and hidden
  keys
- column 2 search filters instances by friendly label, secondary metadata, and
  hidden ids/keys
- schema rows are never filtered out of column 2

This keeps the explorer efficient without turning the UI back into a debug
surface.

## Generic Creation Model

### Recommendation

The best long-term solution is to add a shared draft binding layer that can
drive the same field editors before an entity exists.

The create system should not be implemented as a growing set of handwritten
forms per type.

### Why a draft binding layer is necessary

Today the reusable field editors operate on live predicate refs.

That is enough for update flows, but not enough for create flows, because a new
entity does not yet have:

- a committed node id
- live predicate refs in the real store
- a persisted validation context bound to an existing subject

A draft binding layer solves that by exposing predicate-like bindings over an
uncommitted create state.

### Desired draft behavior

A create draft should:

- mirror the field tree shape of the target entity type
- support field-level editors through the same display and editor metadata
- validate individual field writes where possible
- run full `validateCreate(...)` against the accumulated draft before commit
- understand reference options against the live graph
- hide or lock fields that are not user-writable in normal client flows
- commit through the real graph handle's `create(...)`

### Field inclusion rules

The create draft should show:

- client-writable fields in one section, following the compiled field tree order
- optional fields rendered immediately through the shared editor stack, with
  unset handling delegated to each editor

It should omit or defer:

- managed type fields
- lifecycle-managed fields such as timestamps
- `server-command` and `authority-only` fields from the initial create payload

For those deferred fields, the inspector should explain that they are edited
after creation through the normal instance view.

This is especially important for env vars:

- create the env var metadata through the generic create flow
- then write the secret through the generic secret-backed field editor on the
  created entity

That keeps env vars consistent with the rest of the system.

### Type-specific defaults

The long-term system may grow optional type-level create metadata for things
such as:

- suggested initial names
- default enum values
- placeholder text
- first-class create descriptions

That metadata should remain additive. The explorer should not require bespoke
screen code just because a type wants a nicer default title.

## Metadata Versus Compiled Schema

The explorer must remain honest about the difference between:

- live graph metadata entities
- checked-in compiled schema definitions

Editing `core:type` and `core:predicate` metadata does not live-recompile the
runtime. The UI should not pretend otherwise.

The recommended presentation is:

- graph metadata fields stay editable in the shared inspector
- compiled facts appear in clearly labeled supplemental sections
- drift indicators appear inside those supplemental sections instead of becoming
  the page's primary navigation model

That keeps the truth visible without forcing a separate screen for schema
inspection.

## Custom Views To Keep

The target state should reduce custom views, not eliminate all custom behavior.

The custom pieces worth keeping are:

- secret-backed field editor behavior
- markdown preview behavior
- svg preview behavior
- compact compiled-schema supplements for selected `core:type` and
  `core:predicate` entities

The custom pieces worth removing are:

- top-level entity/type/predicate mode screens
- env-var-specific create panels
- type-specific create panels for ordinary entity types
- duplicate header and metadata layouts for types versus predicates versus
  ordinary entities

## Migration Plan

The proposal should be shipped in phases, not as one cutover.

A single change would bundle together:

- a new route and selection model
- a broader type and instance catalog
- a new inspector composition model
- generic create-draft infrastructure
- removal of existing explorer compatibility paths

That is too much product and technical risk to hide inside one change.

The biggest reason to phase the work is that the target UX depends on one new
foundation that does not exist yet:

- draft bindings that let the shared field editor surface work before an entity
  exists

Until that foundation lands, a one-shot rewrite would either:

- keep bespoke create panels and still ship an incomplete architecture, or
- attempt the explorer rewrite and the draft system simultaneously

Both options make review and regression isolation worse.

The recommended strategy is:

- ship the structural pieces first
- ship generic creation only after the shared draft layer exists
- drop route aliases and compatibility code once the canonical route is proven
- hide raw ids and keys behind explicit debug affordances once the unified
  surface is stable

If the product needs one visible launch moment, the implementation can still be
developed in phases behind a flag and exposed all at once later. The code
should still land incrementally.

### Phase 1: Document the target

- add this proposal
- align nearby docs to reference the type-first direction

### Phase 2: Expand the catalog

- build the type list from the full explorer namespace
- build instance lists for every entity type, not just product entities plus icons
- keep the existing inspectors temporarily while the catalog broadens
- preserve the existing routes and top-level explorer layout during this phase

### Phase 3: Collapse routing and selection state

- move to one canonical `/graph` route
- replace `section` state with `{ typeId, target }`
- remove old section-route aliases and compatibility parsing
- keep temporary compatibility adapters if needed so inspector internals can
  still be migrated separately

### Phase 4: Unify the inspector shell

- introduce one shared inspector layout
- move `EntityInspector`, `TypeInspector`, and `PredicateInspector` behavior
  into shared sections plus supplements
- remove top-level mode navigation
- keep creation flows conservative in this phase
  `New <Type>` can stay hidden or partial until draft bindings are ready

### Phase 5: Add draft bindings and generic create

- implement the draft create layer
- render `New <Type>` through the shared inspector
- remove env-var-specific create UI
- keep document-backed create flows on the same generic foundation
- keep type-specific defaults additive rather than screen-specific

### Phase 6: Finish cleanup

- hide ids and keys from default explorer chrome
- add focused debug affordances only where truly needed
- remove obsolete docs, route aliases, and compatibility code

## Testing Requirements

The long-term refactor needs dedicated explorer coverage.

Minimum test cases:

- selecting a type populates schema plus instance rows
- scalar and enum types show schema-only states cleanly
- `core:type` and `core:predicate` are browsable through the same surface
- creating an ordinary entity works through the generic draft flow
- env var creation lands in the created entity and then allows secret editing
- ids and keys are not rendered in the default visible UI
- canonical `type` and `target` params hydrate the correct selection model
- schema supplements show compiled field or usage context without requiring a
  separate mode

## Recommendation

The best long-term solution is:

- a single `/graph` route
- a type-first three-column layout
- one inspector shell
- a shared draft binding layer for generic creation
- schema supplements instead of schema-specific screens

That direction preserves the strongest part of the current system, which is the
generic field editor stack, while removing the weakest part, which is the
mode-first screen split and the growing set of bespoke creation surfaces.
