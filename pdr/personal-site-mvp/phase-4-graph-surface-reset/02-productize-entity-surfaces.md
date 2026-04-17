Status: Proposed
Last Updated: 2026-04-17

# 02: Productize entity surfaces

## Must Read

- `./spec.md`
- `./01-generic-local-graph-transport.md`
- `../spec.md`
- `../../../AGENTS.md`
- `../../../pdr/entity-surface.md`
- `../../../lib/graphle-surface/README.md`
- `../../../lib/graphle-surface/doc/ui-stack.md`
- `../../../lib/graphle-surface/doc/record-surfaces.md`
- `../../../lib/graphle-surface/doc/react-dom.md`
- `../../../lib/graphle-surface/src/index.ts`
- `../../../lib/graphle-surface/src/react-dom/index.ts`
- `../../../lib/graphle-surface/src/react-dom/record-surface-mount.tsx`
- `../../../lib/graphle-app/doc/entity-surface.md`
- `../../../lib/graphle-app/src/web/components/entity-surface-plan.ts`
- `../../../lib/graphle-app/src/web/components/entity-surface.tsx`
- `../../../lib/graphle-app/src/web/components/create-entity-surface.tsx`
- `../../../lib/graphle-app/src/web/components/field-editor-row.tsx`
- `../../../lib/graphle-app/src/web/components/inspector.tsx`
- `../../../lib/graphle-app/src/web/components/explorer/create-draft-plan.ts`
- `../../../lib/graphle-app/src/web/components/explorer/create-draft-controller.ts`
- `../../../lib/graphle-app/src/web/components/explorer/catalog.ts`
- `../../../lib/graphle-react/doc/predicate-and-entity-hooks.md`
- `../../../lib/graphle-react/src/entity-draft.ts`
- `../../../lib/graphle-react/src/predicate.ts`
- `../../../lib/graphle-react/src/persisted-mutation.tsx`
- `../../../lib/graphle-react/src/validation-issue.ts`
- `../../../lib/graphle-module-core/doc/react-dom.md`
- `../../../lib/graphle-module-core/src/react-dom/resolver.tsx`
- `../../../lib/graphle-module-core/src/react-dom/field-registry.tsx`

## Goal

Move the reusable entity view/edit/create surface integration out of
`@dpeek/graphle-app` and into package-owned Graphle surface boundaries.

After this PDR, product packages should be able to render a generic entity
surface without importing the app proof package. The surface should compose the
pieces that already exist:

- typed entity and predicate refs
- `@dpeek/graphle-react` predicate hooks and draft controllers
- authored `RecordSurfaceSpec` section metadata when available
- `@dpeek/graphle-module-core/react-dom` field views and editors
- `@dpeek/graphle-surface/react-dom` record layout and section chrome

This is a productization and deletion pass. Do not invent a new editor system.

## Approach

### Land the reusable surface in `@dpeek/graphle-surface`

The default landing is `@dpeek/graphle-surface`:

- root package: pure planning and surface runtime helpers
- `react-dom` subpath: browser entity view/edit/create components

Create a new package only if a real dependency cycle blocks this landing. If a
new package is required, document the cycle and keep the same ownership rules.

Update package docs that currently say interactive entity screens sit in
`@dpeek/graphle-app`. After this PDR, the generic interactive entity surface
lives in the shared surface stack; app code owns only app-specific wrappers and
overrides.

### Extract pure planning without app imports

Move the reusable parts of
`lib/graphle-app/src/web/components/entity-surface-plan.ts` into
`@dpeek/graphle-surface`.

The extracted code must not import `@dpeek/graphle-app/graph` or app explorer
models. Replace those imports with lower-level packages:

- `edgeId`, `typeId`, `fieldWritePolicy`, and secret-field metadata from
  `@dpeek/graphle-kernel` when needed
- typed refs from `@dpeek/graphle-client`
- metadata and draft helpers from `@dpeek/graphle-react`
- `core` field ids from `@dpeek/graphle-module-core` only for default core
  system-field policy

Keep the useful planning concepts:

- `EntitySurfaceMode`: `view | edit`
- row role: `title | body | meta | hidden`
- row chrome: label visibility, description visibility, validation placement
- mode-aware row options
- live entity row planning
- draft row planning
- field order preservation

Make app-specific policy configurable. The shared planner may ship defaults for
common core fields such as node type, name, created-at, and updated-at, but it
must not hardcode app workflow, explorer, secret, or icon assumptions.

### Consume authored record surfaces as structure

Do not create another authored surface contract.

The shared entity surface should accept optional `RecordSurfaceSpec` metadata as
the authored structure source:

- title and subtitle fields can inform title/meta rows
- section field order should drive visible field order
- section titles and descriptions should flow into section chrome
- missing authored metadata can fall back to field-tree order

`RecordSurfaceSpec` remains narrow. It describes structure; the entity surface
decides interactive behavior, edit mode, validation placement, and host policy.

Do not route editing through `resolveRecordSurfaceBinding(...)`. That binding is
still the readonly lookup path. Interactive surfaces should resolve live
predicate refs or draft predicate refs directly.

### Extract predicate row rendering

Move the generic parts of `PredicateRow` and `InspectorFieldSection` into
`@dpeek/graphle-surface/react-dom`.

The extracted predicate row should:

- render `view` mode through `PredicateFieldView` when supported
- render `edit` mode through `PredicateFieldControl` or `PredicateField`
  wrappers from `@dpeek/graphle-module-core/react-dom`
- use `usePredicateField(...)` and `formatPredicateValue(...)` from
  `@dpeek/graphle-react`
- use `usePersistedMutationCallbacks(...)` for write flushing
- accept path-keyed validation issues from create/submit flows
- keep row-local mutation errors visible
- keep label, description, status, and validation chrome configurable

The extracted row should not import app explorer helpers, app sync contexts, or
secret-field components.

Secret-field handling remains an app-specific override for now. The generic row
should expose an override hook such as `renderEditor`, `customEditor`, or a
field-renderer callback so `@dpeek/graphle-app` can keep its secret editor
without forcing secret infrastructure into the shared MVP path.

### Extract live and create surfaces

Move the generic shape of `EntitySurface` and `CreateEntitySurface` into
`@dpeek/graphle-surface/react-dom`.

The shared live entity surface should accept:

- an entity ref
- optional authored record surface metadata
- `view | edit` mode control
- optional mutation runtime or sync runtime
- optional row/field renderer overrides
- optional validation issues

The shared create surface should accept:

- a type field tree
- create defaults
- visible field paths or authored surface metadata
- `create(...)` and `validateCreate(...)` callbacks
- entity-reference lookup callbacks for draft reference fields
- type definitions by id
- optional mutation runtime
- an `onCreated(entityId)` callback

It should use the existing `createEntityDraftController(...)` from
`@dpeek/graphle-react`, not create a second draft model.

Dialog shell, close buttons, app-specific create labels, explorer catalog
selection, and route behavior stay outside the shared surface. Product packages
can wrap the shared create body in their own dialog or inline frame.

### Leave app as a thin consumer or proof path

After extraction, `@dpeek/graphle-app` should not keep a parallel generic entity
surface implementation.

Either:

- update app components to import the shared surface and provide app-only
  overrides, or
- delete app-local copies that are no longer referenced.

Do not preserve old app component paths for compatibility unless keeping a thin
wrapper materially reduces churn. Backwards compatibility with the app proof is
not a goal.

## Rules

- Run `turbo build` before edits and `turbo check` after edits.
- Do not import `@dpeek/graphle-app` from `@dpeek/graphle-surface`,
  `@dpeek/graphle-react`, `@dpeek/graphle-module-core`, or the MVP product path.
- Do not create a new surface metadata model.
- Use `RecordSurfaceSpec` as authored structure metadata.
- Keep readonly record binding separate from interactive entity editing.
- Keep field widgets in `@dpeek/graphle-module-core/react-dom`.
- Keep host-neutral hooks and draft controllers in `@dpeek/graphle-react`.
- Keep shell, routing, dialogs, auth, deploy, and sync status out of
  `@dpeek/graphle-surface`.
- Keep app-only explorer, workflow, Better Auth, and secret-editor behavior out
  of the extracted generic surface.
- Prefer deleting or thinning app-owned copies over copying code and leaving two
  generic implementations.
- Keep package docs current.

## Open Questions

None.

## Success Criteria

- `@dpeek/graphle-surface` exports route-neutral entity surface planning types
  and helpers from its root entrypoint.
- `@dpeek/graphle-surface/react-dom` exports browser entity view/edit/create
  components or bodies that can be used outside `@dpeek/graphle-app`.
- The extracted surface code has no imports from `@dpeek/graphle-app`.
- The extracted predicate row delegates field view and editor selection to
  `@dpeek/graphle-module-core/react-dom`.
- The extracted create flow uses `createEntityDraftController(...)` from
  `@dpeek/graphle-react`.
- Authored `RecordSurfaceSpec` metadata can drive section and field order for
  an interactive entity surface without using readonly
  `resolveRecordSurfaceBinding(...)`.
- Field-tree fallback still works when no authored record surface is supplied.
- `view` and `edit` modes are explicit and test-covered.
- Row-level validation and submit-level validation can both be displayed.
- App-specific secret-field behavior is supplied as an override, not imported
  into the shared surface.
- App-owned generic entity surface copies are deleted or reduced to thin
  wrappers around the shared surface.
- `@dpeek/graphle-surface` docs describe its expanded ownership of generic
  interactive entity surfaces.
- `@dpeek/graphle-app` docs no longer describe the generic entity surface as
  app-owned.
- `turbo build` passes.
- `turbo check` passes.

## Tasks

- Add or update `@dpeek/graphle-surface` dependencies needed for
  `@dpeek/graphle-react` and `@dpeek/graphle-module-core/react-dom`.
- Add a root `entity-surface` module in `@dpeek/graphle-surface` for pure
  planning types and helpers.
- Move generic row planning from app `entity-surface-plan.ts` into the new
  surface module.
- Replace app graph imports in extracted code with lower-level kernel, client,
  React, and module-core imports.
- Add support for optional `RecordSurfaceSpec` section metadata as the visible
  field ordering source.
- Keep field-tree order fallback for surfaces without authored metadata.
- Add tests for live row planning, draft row planning, system-field defaults,
  authored section ordering, and mode-specific row roles.
- Add `PredicateRow` or equivalent field-row component to
  `@dpeek/graphle-surface/react-dom`.
- Add an entity field section component that reuses `RecordSurfaceSectionView`
  while rendering predicate rows through the shared field resolver.
- Add live entity surface and create entity surface bodies to
  `@dpeek/graphle-surface/react-dom`.
- Add SSR component tests with `renderToStaticMarkup` for view mode, edit mode,
  validation display, and unsupported/empty field behavior.
- Update `@dpeek/graphle-app` entity/create/detail flows to consume the shared
  surface or delete the local copies when unused.
- Keep app-specific secret-field editor wiring as an override supplied by app
  code.
- Update `@dpeek/graphle-surface` README and docs to describe generic
  interactive entity-surface ownership.
- Update `@dpeek/graphle-app/doc/entity-surface.md` to say the generic surface
  moved out and app owns only proof-specific wrappers/overrides.
- Update any cross-package docs that still say interactive entity screens belong
  in `@dpeek/graphle-app`.

## Non-Goals

- Do not migrate `@dpeek/graphle-site-web` in this PDR.
- Do not add `site:item` surface metadata in this PDR.
- Do not delete site DTO APIs in this PDR.
- Do not redesign `RecordSurfaceSpec`.
- Do not make `resolveRecordSurfaceBinding(...)` edit-aware.
- Do not add Better Auth, workflow, saved-query, installed-module, admission,
  share, or capability behavior to the shared surface.
- Do not build a new graph query or command execution model.
- Do not create a separate admin app or route namespace.
