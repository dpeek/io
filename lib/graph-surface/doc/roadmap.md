---
name: Graph surface roadmap
description: "Future graph-native surface, editing, and route-composition direction centered on @io/graph-surface."
last_updated: 2026-04-07
---

# Graph surface roadmap

## Read this when

- you are designing future record, collection, command, or route surfaces
- you need the package split between authored metadata, edit sessions, and
  route-neutral runtime
- you are reading proposal work rather than shipped surface runtime behavior

## Current state

The current split is already real:

- `@io/graph-module` owns pure authored surface and command contracts
- `@io/graph-react` owns edit-session contracts, validation issues, and
  host-neutral resolver primitives
- `@io/graph-surface` owns the current route-neutral record and collection
  runtime plus the browser mounts
- `@io/graph-module-core/react-dom` owns the default field, filter, icon, SVG,
  and query-editor browser layer
- app code still owns route registration, shell composition, transport, and
  authoritative command implementations

## Future direction

The next layer above predicate metadata and below route-local app composition
should make it possible to describe most product UI in graph-native metadata:

- record surfaces over entities
- collection surfaces over relations, saved queries, or later broader sources
- command surfaces for human invocation behavior
- edit-session semantics for draft-backed forms
- later route specs that point at those reusable surfaces

## Core design goals

- keep authored contracts pure data and host-neutral
- derive common application surfaces from schema, query, and command metadata
- make commit timing declarative instead of hardcoded inside individual editors
- let the same field renderer work in view, control, and full field-row modes
- normalize validation so field, form, command, and authority errors can map
  back to one issue model

## Surface direction

### Record surfaces

`RecordSurfaceSpec` is the preferred authored contract for new work.
`ObjectViewSpec` remains the compatibility bridge while older metadata
migrates.

Future work is about making authored record surfaces a stronger reusable product
primitive, not about keeping two parallel record models forever.

### Collection surfaces

The long-term product concept is still a reusable collection surface above the
serialized-query stack.

The likely path is:

- `SavedQuery` decides what rows to fetch
- `SavedView` decides how that result is parameterized and rendered
- a higher-level collection surface adds selection, create affordances, row
  actions, bulk actions, and edit behavior

The first generic proving ground remains the schema-driven entity table.

### Command surfaces

`GraphCommandSpec` should keep owning execution, policy, touched predicates,
and I/O shape. `GraphCommandSurfaceSpec` should keep growing as the human
invocation layer:

- label and icon
- subject model
- input presentation
- submit behavior
- post-success behavior

Create and edit flows should converge on commands and command surfaces rather
than bespoke route-local button logic.

## Edit-session direction

Edit sessions should become the standard controller contract for:

- create forms
- update forms
- command-input forms

The important split stays the same:

- `@io/graph-react` owns the controller and issue contracts
- hosts decide how commit policy like `blur`, `debounce`, or `submit` is
  scheduled

## Validation direction

Validation should keep lowering into one shared issue model that can represent:

- field-path issues
- form-scope issues
- command-input issues
- authority-returned validation failures

That shared model is the bridge between generic surface rendering and
authority-owned business rules.

## Route direction

Route specs are still later work.

If they land, they should reference reusable record, collection, and command
surfaces rather than restating those shapes in a second route-local contract.

## Source anchors

- `../src/collection-surface.ts`
- `../src/collection-command-surface.ts`
- `../src/record-surface.ts`
- `../src/react-dom/index.ts`
- `../../graph-react/src/edit-session.ts`
- `../../graph-module/src/contracts.ts`
- `../../graph-module-core/src/react-dom/index.ts`

## Related docs

- [`./ui-stack.md`](./ui-stack.md): current shipped ownership split
- [`./collection-surfaces.md`](./collection-surfaces.md): current collection
  runtime
- [`./collection-commands.md`](./collection-commands.md): current proving-ground
  command binding
- [`./record-surfaces.md`](./record-surfaces.md): current readonly record
  runtime
- [`../../graph-kernel/doc/roadmap.md`](../../graph-kernel/doc/roadmap.md):
  broader graph-engine roadmap
