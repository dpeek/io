---
name: App entity surface
description: "App-owned interactive entity-surface boundary above readonly record surfaces."
last_updated: 2026-04-08
---

# App entity surface

## Read this when

- you are changing app-owned interactive entity detail or create surfaces
- you need the ownership split between app-owned entity surfaces and
  `@io/graph-surface`
- you need the intended adapter path from `RecordSurfaceSpec` into an
  interactive app surface

## What this doc owns

- the app-owned `EntitySurface` family for interactive entity screens
- the current landing for row planning, row chrome, and create-draft support
- the ownership boundary for validation and system-field policy

It does not own authored record metadata or readonly record binding. Those
stay in `@io/graph-module` and `@io/graph-surface`.

## Current landing in tree

- `../src/web/components/entity-surface.tsx`: exported live-entity wrapper
  used by app-owned record/detail hosts
- `../src/web/components/create-entity-surface.tsx`: exported draft-backed
  create wrapper used by the generic app create dialog
- `../src/web/components/entity-surface-plan.ts`: live-entity row planning,
  row roles, row chrome, and explicit `view | edit` mode
- `../src/web/components/inspector.tsx`: shared inspector shell and section
  renderer that reuses `RecordSurfaceLayout` and
  `RecordSurfaceSectionView`; `EntitySurface` now only reuses the section path
  and owns its single-card chrome locally
- `../src/web/components/field-editor-row.tsx`: mode-aware row body, widget
  selection, and validation placement
- `../src/web/components/explorer/create-draft-plan.ts`: create-draft field
  eligibility and defaults
- `../src/web/components/explorer/create-draft-controller.ts`: draft adapter
  over `@io/graph-react`
- `../src/web/components/entity-type-browser.tsx` and
  `../src/web/components/collection-browser-surface.tsx`: app-owned detail
  flows that now render the live surface directly
- `../src/web/components/entity-create-button.tsx`: app-owned create entry
  that now renders the shared draft surface directly

## Exported family

- `EntitySurface`: live-entity wrapper for app-owned interactive detail
- `CreateEntitySurface`: draft-backed create wrapper for app-owned create flows
- both wrappers should share one planner and one row/body renderer
- future app-owned interactive record/detail work should import these wrappers
  directly
- do not add inspector-local or route-specific record/detail hosts beside this
  family

## Responsibilities

- choose surface mode: `view` or `edit`
- keep the current live field-tree order, and later authored section order,
  as the base order before applying app policy for known system fields
- treat type as icon chrome, hide `id` and `createdAt`, move `updatedAt` into
  meta chrome, and promote `name` into the title slot in `view` mode
- decide row role, label visibility, description visibility, and validation
  placement
- own validation presentation for row-local mutation failures, submit-time
  create failures, and hidden or non-field summary issues
- reuse shared field widgets and section chrome instead of forking a second
  widget stack
- keep the live entity detail in one app card, with the `view | edit` toggle
  in the footer instead of a separate header panel

## Row planning and chrome

`buildLiveEntitySurfacePlan(...)` is the current planner. It flattens live
predicate refs, preserves the entity field-tree order for non-system rows,
then assigns one of four app-owned roles:

- `title`
- `body`
- `meta`
- `hidden`

Each row also carries app-owned chrome policy:

- label visibility
- description visibility
- validation placement

`PredicateRow` resolves those policies per mode, then chooses the display or
editor path and merges external validation messages with row-local mutation
errors.

## Create flow

`buildCreatePlan(...)` decides which fields stay in the generic create path and
whether the current dialog is supported. `createEntityDraftController(...)`
adapts app catalog lookups into the shared draft controller from
`@io/graph-react`.

`CreateEntitySurface` is the current generic create host. It keeps the
dialog-specific shell in app/web while reusing the same shared field/body path
as `EntitySurface`, rather than pushing draft-session or submit-validation
concerns into `@io/graph-surface`.

## Boundary against readonly record surfaces

- `RecordSurfaceSpec` stays the authored structure contract: subject,
  title/subtitle fields, section metadata, and related collection keys
- `resolveRecordSurfaceBinding(...)` stays a readonly lookup adapter over field
  values and related collections
- `RecordSurfaceMount*` stays the shared readonly shell for browse-only record
  layouts; it is not a competing app-owned detail API
- app-owned entity surfaces may reuse `RecordSurfaceLayout` or
  `RecordSurfaceSectionView` chrome, but interactive behavior stays above the
  binding layer

Do not move app policy such as `name` promotion, system-field hiding, explicit
edit mode, or validation placement into `RecordSurfaceSpec`.

## Adapter path from `RecordSurfaceSpec`

The intended adapter path is:

1. start from authored `RecordSurfaceSpec.sections`, or from
   `adaptObjectViewToRecordSurface(...)` while older `ObjectViewSpec` data is
   still in flight
2. keep authored section order, titles, labels, and descriptions as metadata
3. resolve those field paths against live predicate refs or the draft field
   tree, not through `resolveRecordSurfaceBinding(...)`
4. map the resolved rows into app-owned row roles and chrome defaults
5. render them through the shared app row/body layer, which is
   `PredicateRow` plus `InspectorFieldSection` today

That path keeps the authored contract narrow. `RecordSurfaceSpec` still says
"what fields exist and how they are grouped." The app surface decides "how an
interactive product screen should behave."

## Related docs

- [`./web-overview.md`](./web-overview.md): current app-owned web and Worker
  runtime map
- [`../../graph-surface/doc/record-surfaces.md`](../../graph-surface/doc/record-surfaces.md):
  readonly record-surface binding and adapter boundary below this layer
- [`../../../doc/branch/07-web-and-operator-surfaces.md`](../../../doc/branch/07-web-and-operator-surfaces.md):
  Branch 7 product-surface contract
- [`../../../pdr/entity-surface.md`](../../../pdr/entity-surface.md): delivery
  plan for the exported surface family
