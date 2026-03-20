# Repository Structure Direction

## Purpose

This document sets the repo-level direction for cleaning up `io` as it moves
from a fast-moving proof into a product-shaped codebase.

The goal is not a cosmetic reshuffle. The layout should make the long-term
model in `../vision.md` easier to build:

- graph runtime as durable core
- installable modules as the main expansion boundary
- web and TUI as adapter surfaces
- agent workflows operating on the same graph contracts

## What Stays

The current setup already has the right broad shape:

- one TypeScript workspace
- `tsgo`-first typechecking
- `graph`, `web`, and `agent` as explicit top-level concerns
- `@io/web` as a separate reusable UI package
- colocating schema authoring close to type-specific behavior

This direction keeps those choices.

## Current Problems

The main issue is not "too many packages." It is mixed ownership inside the
same tree.

Today `src/graph` mixes three different axes:

- runtime kernel
- schema and type authoring
- host-specific adapters and editors

That leads to a few concrete problems:

- type-local authoring is only partially true because DOM editors still live in
  centralized adapter folders
- one catch-all product namespace makes ownership drift and taxonomy cleanup
  harder
- generic browser primitives such as Monaco source editing and source/preview
  shells live in `graph` even when they are not graph-specific
- large files and large datasets hide naming drift and make agent work slower

## Direction

The core structural rule is:

1. module is the install and ownership boundary
2. type/value is the main authoring boundary inside a module
3. adapters wire modules into a host, but do not own the module behavior

## Target Layout

```text
src/
  agent/
  cli/
  graph/
    runtime/
    modules/
      core/
      pkm/
      ops/
      work/
    adapters/
      react/
      web/
      tui/
  lib/
  web/
lib/
  web/
```

### Responsibilities

`src/graph/runtime/`

- ids, schema compiler, store, sync, authority, validation, query contracts

`src/graph/modules/`

- built-in module families
- schema, views, workflows, commands, and module-local helpers
- module manifests when installability lands

`src/graph/adapters/`

- host bindings only
- editor/view registries
- adapter-specific composition that imports module-local files

`src/web/`

- app routes, app composition, Worker integration, and browser-specific product
  surfaces
- consumes reusable browser primitives from `@io/web` and graph-aware field
  adapters from `graph`, but does not own either package's shared editor
  contracts

`lib/web/`

- reusable browser UI primitives
- generic source/preview shell
- Monaco wrappers
- markdown rendering helpers

## Browser Editor Boundary

The extraction line is now:

- `@io/web` owns reusable browser primitives that do not need graph schema,
  typed refs, or graph mutation semantics
- `graph` owns graph-aware editor and field behavior, even when the browser UI
  is rendered through shared `@io/web` primitives
- `src/web` owns route-level product surfaces and app composition on top of
  both packages

Put code in `@io/web` when it is any of:

- presentational browser chrome such as source/preview shells and panel styles
- Monaco bootstrapping, loading fallbacks, and generic source-editor presets
- markdown rendering helpers or other typed-content renderers with no graph
  dependency
- reusable form controls, comboboxes, and layout primitives that any browser
  surface could consume

Keep code in `graph` when it needs any of:

- `PredicateRef`, typed entity refs, compiled schema metadata, or field-kind
  capability registration
- graph validation, normalization, persisted mutation callbacks, or draft to
  predicate writes
- graph-owned preview behavior such as SVG sanitization, icon markup rules, or
  typed entity-reference summaries
- resolver composition that decides which field editor or view a graph
  predicate should use

If a future browser editor could be reused outside graph-backed field editing
without carrying graph runtime imports, it belongs in `@io/web`. If it needs
graph contracts to function, keep it in `graph` and have it compose the shared
`@io/web` primitive instead of reimplementing the browser shell.

## Naming Rules

Use names for the role they play, not the implementation accident that exists
today.

### Stable terms

- `module`: installable domain slice
- `namespace`: graph key prefix such as `core:` or `pkm:`
- `type`: entity, enum, or scalar definition
- `field`: authored predicate on a type
- `view`: read-focused presentation contract
- `editor`: write-focused input contract
- `workflow`: multi-step flow contract
- `command`: executable graph action contract
- `surface`: route-level app UI
- `adapter`: host-specific binding layer

### Namespace rules

- keep `core:` small and durable
- replace vague catch-all product namespaces with domainful names
- prefer `pkm:`, `ops:`, `work:`, `people:`, `files:`, and similar domain
  prefixes over one giant product bucket
- if imported fit-test schemas return later, keep them outside product
  namespaces and outside the main built-in module tree

### File and folder rules

- singular names for type folders such as `topic`, `env-var`, `quantity`
- plural names only for containers such as `entities`, `enums`, `values`,
  `views`, `commands`
- use `schema.ts` as the public entry file inside a type folder and prefer
  direct compatibility shims like `schema/pkm/topic.ts` over nested
  `schema/pkm/topic/index.ts` wrappers
- avoid duplicate path segments like `topic/topic`
- avoid implementation-first names like `react-dom` when the real boundary is
  `web`

### Editor kind rules

Do not grow one flat string namespace forever.

Prefer family/variant names such as:

- `text/input`
- `text/textarea`
- `source/markdown`
- `source/svg`
- `reference/entity`
- `reference/entity-many`
- `number/quantity`
- `money/amount`

That keeps the taxonomy readable as the editor surface grows.

## Taxonomy Direction

The type system should grow in layers.

### Core

Very small, durable vocabulary:

- ids
- names and labels
- timestamps
- refs
- privacy and capability metadata
- basic scalar families

### Foundation modules

Reusable domains many modules depend on:

- people and organizations
- files and media
- documents and notes
- tasks and workflow
- secrets and integrations
- time and calendar

### Product modules

Modules that power the out-of-the-box product:

- personal knowledge
- operations and environment config
- work tracking and agent runtime artifacts

### Imported fit-test schemas

We are not carrying an imported fit-test schema in-tree right now.

If that changes later, keep those schemas clearly outside product taxonomy and
module naming.

## Structured Value Families

Structured value work should keep replacing loose `string` and `json`
placeholders with durable module-owned shapes.

Implemented core families:

- `duration`
- `percent`
- `quantity`
- `money`

Near-term follow-ups:

- `unit`
- `rate`
- `range`

`measure` is not a good canonical type name because it is too vague. Use more
specific terms such as `quantity` or `rate`.

## Structured Editors

Current shared editor families:

- quantity editor: amount + unit
- money editor: amount + currency
- duration editor: human units instead of raw milliseconds
- percent editor: constrained numeric entry and display formatting

Near-term editor families:

- rate editor: numerator + denominator
- range editor: min/max pair
- generic source/preview editor: markdown, SVG, JSON, code
- file/image editor: upload + preview
- richer reference editors: single, many, ordered, createable

## Shipping Strategy

Do not attempt one giant rewrite branch.

Ship this work with:

1. one direction document
2. one phased migration plan
3. many small execution slices

This document is the direction document.

The migration plan should define phases, acceptance criteria, and what each
phase deliberately does not include.

Actual implementation should be sliced into reviewable tasks, not assigned as
"do phase 3."

See `./structure-plan.md` for the execution plan that turns this direction into
phase-by-phase work and a Linear-friendly feature breakdown.

## Phased Work

### Phase 1: Freeze structure and naming

- agree on target layout
- agree on namespace rules
- record that we are not carrying an imported fit-test schema for now
- define what moves to `@io/web`

Exit criteria:

- docs are stable enough that later refactors do not re-open the same debate

### Phase 2: Extract generic browser primitives

- move source/preview shell to `@io/web`
- move Monaco wrappers to `@io/web`
- move generic markdown rendering to `@io/web`
- keep graph-specific mutation wiring and SVG sanitization in `graph`

Exit criteria:

- markdown and SVG editors still work
- `graph` owns graph behavior, not generic browser chrome

### Phase 3: Delete temporary imported fit-test schema

- remove `estii`
- clean exports, tests, and docs that referenced it
- stop carrying a permanent imported smoke schema until it is buying us
  something real

Exit criteria:

- the repo no longer carries `estii`
- package exports, tests, docs, and plans no longer depend on it

### Phase 4: Reshape graph around runtime, modules, and adapters

- move runtime kernel into a clearer home
- move built-in schema into `modules`
- reduce adapter folders to registry and composition code

Exit criteria:

- a reader can tell where runtime, module authoring, and host integration live

### Phase 5: Roll out value taxonomy and editors

- add structured value modules
- migrate obvious string and JSON placeholders
- pilot the module-local editor pattern on a few concrete types

Exit criteria:

- units, quantities, money, rates, and durations stop leaking through ad hoc
  raw fields

### Phase 6: Split mega files and trim tests

- split files by responsibility
- move big static datasets into explicit data or generated modules
- bias tests toward runtime contracts, module smoke tests, and high-risk UI
  integration paths

Exit criteria:

- the tree is faster to navigate
- tests cover durable behavior instead of implementation narration

## Execution Rules

Each implementation slice should:

- keep the repo passing `bun check`
- separate mechanical moves from behavior changes when possible
- update nearby docs when ownership changes
- leave a clearer boundary than it found

Good slices:

- extract generic source/preview primitives to `@io/web`
- delete `estii` and clean exports/docs
- introduce `duration` value module and editor
- split explorer field editing by responsibility

Bad slices:

- "reorganize the graph package"
- "clean up structure"
- "do phase 4"

## Decision To Hold Constant

We are not carrying an imported fit-test schema in-tree right now.

If one returns later, it should not shape product taxonomy, package naming, or
the default built-in module layout.
