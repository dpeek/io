# Repository Structure Plan

## Purpose

This document turns `./structure.md` into a delivery plan that can be copied
into Linear as one stream with a small number of feature-sized issues.

The goal is to ship the structure work in mergeable slices without turning the
repo into a long-running migration branch.

## What We Need Beyond The Direction Doc

Before this goes into Linear, we need four things:

1. a fixed phase order
2. clear exit criteria for each phase
3. a Linear-friendly feature breakdown
4. task-level slicing rules so agents are handed narrow work

`./structure.md` already covers the target architecture. This document covers
how to get there.

## Shipping Rules

Every structure task should follow these rules:

- keep `bun check` green
- prefer move-only or rename-only changes before behavior changes
- update docs in the same PR when ownership moves
- do not carry a permanent imported fit-test schema unless it is buying us
  something real
- do not mix namespace renames, directory moves, and new value/editor behavior
  in one large patch unless the slice is still reviewable

## Not In Scope Yet

This plan is for repo structure and near-term taxonomy cleanup.

It does not yet include:

- remote module installation
- registry/discovery infrastructure
- full graph-native workflow replacement for Linear
- a complete files/media product surface
- large product-level UX redesign beyond the editor moves needed for structure

## Phase Order

Phase 1 is already partly started through `./structure.md`.

The recommended order from here is:

1. lock naming and rollout guardrails
2. extract generic browser primitives to `@io/web`
3. delete the temporary imported fit-test schema and clean its surface area
4. reshape `graph` around runtime, modules, and adapters
5. rename product namespaces and migrate the first module slices
6. add structured value families and editors
7. split mega files and trim tests

The order matters because:

- moving generic browser primitives first reduces noise in later graph moves
- deleting `estii` early stops it from distorting the product tree
- reshaping the package tree before big taxonomy additions avoids redoing work
- namespace renames should happen after the new module boundaries exist

## Phase 1: Lock Names And Boundaries

### Objective

Turn the direction into a stable implementation contract so later PRs are not
re-litigating structure in each diff.

### Scope

- finalize domain prefixes that replace `app:`
- confirm target folder names such as `runtime`, `modules`, and `adapters`
- confirm whether `react-dom` remains an exported adapter name or becomes `web`
- decide the pilot built-in module slices for migration

### Deliverables

- approved `./structure.md`
- approved this execution plan
- explicit decision that we are not carrying an imported fit-test schema today

### Exit Criteria

- new structure work can be judged against one written target
- there is no major unresolved naming question blocking later phases

### Suggested Linear Feature

`Lock repository structure contract`

### Candidate Tasks

- choose replacement namespaces for current `app:` types
- confirm adapter naming and folder targets
- list pilot built-in module slices and any future fit-test boundaries if they
  ever return
- review and approve the phased rollout doc

## Phase 2: Extract Generic Browser Primitives

### Objective

Move generic browser/editor infrastructure out of `graph` so later graph moves
only touch graph-specific concerns.

### Scope

- source/preview container
- Monaco loading wrapper
- markdown rendering helper
- shared surface styling that is not graph-specific

### Deliverables

- reusable source/preview primitives in `@io/web`
- graph editors consuming those primitives instead of owning them
- docs explaining what still belongs in `graph`

### Exit Criteria

- markdown and SVG editor flows still work
- `graph` no longer owns generic browser editor infrastructure

### Suggested Linear Feature

`Extract generic source/preview web primitives`

### Candidate Tasks

- move source/preview shell and styles into `@io/web`
- move Monaco wrapper into `@io/web`
- move markdown renderer into `@io/web`
- update graph markdown and SVG editors to consume the shared primitives
- document the `@io/web` vs `graph` boundary

## Phase 3: Delete The Temporary Imported Fit-Test Schema

### Objective

Remove `estii` and stop carrying a permanent imported fit-test schema in-tree
until that surface is buying enough to justify the maintenance cost.

### Scope

- delete the `estii` schema tree and export surfaces
- update exports, docs, tests, and plans that still refer to it
- keep the remaining kitchen-sink/test schema coverage as the lightweight fit
  check

### Deliverables

- no `estii` schema tree or package export
- docs that no longer assume a permanent imported smoke schema exists
- remaining schema smoke coverage still passing

### Exit Criteria

- the repo no longer carries `estii`
- exports, tests, docs, and Linear planning no longer point at deleted schema
  surfaces
- a new contributor can tell that imported fit-test schema is not part of the
  built-in product tree today

### Suggested Linear Feature

`Delete the estii smoke schema and clean exports/docs`

### Candidate Tasks

- delete `estii` files and package exports
- fix tests and schema entry surfaces after the deletion
- update docs and Linear planning that still describe `estii` as canonical or
  persistent smoke coverage

## Phase 4: Reshape Graph Around Runtime, Modules, And Adapters

### Objective

Make the graph package structure match the architectural model: runtime kernel,
module authoring, and host adapters as separate concerns.

### Scope

- move runtime code into a clearer `runtime` home
- move built-in schema ownership into `modules`
- reduce adapter folders to registry and composition code
- keep exports coherent while the tree moves

### Deliverables

- `src/graph/runtime/`
- `src/graph/modules/`
- `src/graph/adapters/`
- docs updated to reflect the new graph package map

### Exit Criteria

- a reader can answer "where do runtime code, module authoring, and host
  integration live?" without tribal knowledge
- adapter folders no longer look like the primary ownership location for type
  behavior

### Suggested Linear Feature

`Reshape graph package around runtime, modules, and adapters`

### Candidate Tasks

- create the new top-level graph folders and move runtime kernel code
- move built-in schema ownership into `modules`
- collapse adapter folders toward registry/composition responsibilities
- update graph docs and package navigation after the move

## Phase 5: Rename Product Namespaces And Migrate Pilot Modules

### Objective

Remove vague product namespaces and prove the new module-local authoring model
on a small number of built-in module slices.

### Scope

- replace `app:` with domainful namespaces
- migrate at least one knowledge module and one ops module
- remove duplicate path shapes like `topic/topic`

### Deliverables

- clear namespace replacements for current product schema
- pilot modules migrated to the new folder model
- docs and tests updated to use the new names

### Exit Criteria

- `app:` is no longer the default home for product schema
- at least two migrated module slices prove the target authoring pattern

### Suggested Linear Feature

`Rename product namespaces and migrate pilot modules`

### Candidate Tasks

- rename `topic` into its domain namespace and new folder shape
- rename `env-var` into its domain namespace and new folder shape
- update schema ids, exports, docs, and tests for the renamed namespaces
- clean duplicate path segments and index files in migrated slices

## Phase 6: Add Structured Value Families And Editors

### Objective

Replace loose `string` and `json` placeholders with durable value families and
their shared editors.

### Scope

- `duration`
- `percent`
- `quantity`
- `money`
- `rate`
- `range`

### Deliverables

- new value modules
- shared editor/view patterns for those values
- migrations away from the most obvious placeholder fields

### Exit Criteria

- new work stops modeling units, rates, or durations as loose strings by
  default
- at least the high-signal placeholder fields are migrated

### Suggested Linear Feature

`Add structured value families and editors`

### Candidate Tasks

- define `duration` and `percent` modules plus editors
- define `quantity` and `money` modules plus editors
- define `rate` and `range` modules plus editors
- migrate the obvious placeholder fields in active schemas where the new values
  clearly fit
- document when to use each value family

## Phase 7: Split Mega Files And Trim Tests

### Objective

Improve navigability and reduce maintenance cost after the structural changes
land.

### Scope

- split files that are too large to work in comfortably
- move large static datasets into explicit data or generated modules
- trim tests that narrate implementation instead of proving contracts

### Deliverables

- smaller, clearer files in the main hotspots
- dataset files that do not hide logic in giant blobs
- tests biased toward contracts, smoke coverage, and high-risk UI paths

### Exit Criteria

- the worst file hotspots are split by responsibility
- the test suite still protects behavior while being easier to evolve

### Suggested Linear Feature

`Split hotspots and simplify test coverage`

### Candidate Tasks

- split graph sync and client hotspots by concern
- split explorer editing hotspots by concern
- move country/currency-style data into dedicated data files
- collapse overly specific tests into contract-focused suites

## Parallelism Notes

Some work can run in parallel once the phase contract is fixed.

Safe parallel areas:

- Phase 2 browser primitive extraction can overlap with early Phase 3 schema
  cleanup
- within Phase 6, value-family implementation can be split across a few small
  tasks once the shared naming contract is settled
- documentation tasks can trail the code move inside the same feature, but
  should land before the feature closes

Avoid parallelizing:

- namespace renames inside the same schema slice
- wide graph tree moves across the same folders
- multiple tasks editing the same explorer/editor registry at once

## Recommended Linear Shape

Recommended stream:

- `Repository Structure`

Recommended features:

1. `Lock repository structure contract`
2. `Extract generic source/preview web primitives`
3. `Delete the estii smoke schema and clean exports/docs`
4. `Reshape graph package around runtime, modules, and adapters`
5. `Rename product namespaces and migrate pilot modules`
6. `Add structured value families and editors`
7. `Split hotspots and simplify test coverage`

Tasks under each feature should be execution-sized, usually one focused PR per
task.

## Recommended First Feature To Execute

After this plan is approved, the safest first implementation feature is:

`Extract generic source/preview web primitives`

It gives immediate cleanup value, reduces noise in later graph moves, and does
not force the namespace decisions to land first.
