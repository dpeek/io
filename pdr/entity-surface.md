Status: Proposed
Last Updated: 2026-04-07

# Entity surface

## Must Read

- `../lib/app/src/web/components/explorer/entities.tsx`
- `../lib/app/src/web/components/explorer/inspector.tsx`
- `../lib/app/src/web/components/explorer/field-editor-row.tsx`
- `../lib/app/src/web/components/explorer/create-draft-inspector.tsx`
- `../lib/app/src/web/components/explorer/create-draft-controller.ts`
- `../lib/app/src/web/components/explorer/create-draft-plan.ts`
- `../lib/graph-surface/src/react-dom/record-surface-mount.tsx`
- `../lib/graph-surface/doc/record-surfaces.md`
- `../lib/app/doc/web-overview.md`

## Goal

Formalize one app-owned `EntitySurface` family that renders the canonical
product-facing record UI for both a live entity and a create draft for one
type before the entity exists.

The shared surface needs explicit `view | edit` mode, predictable
system-field handling, flexible field-row presentation, first-class
validation presentation, and a future adapter path from `RecordSurfaceSpec`.

The first shipped surface should:

- remove the duplicated header card
- remove the advanced debug panel
- render fields in one column
- render the type predicate as icon chrome instead of a normal field row
- render the name predicate first
- hide `id`
- hide `createdAt`
- render `updatedAt` last in low-emphasis chrome
- support explicit `view` and `edit` modes

## Approach

Treat `EntitySurface` as an app/web product primitive, not as a direct rename
of the current readonly `RecordSurfaceMount`.

The current lower-level contracts remain:

- `RecordSurfaceSpec` stays the durable authored layout contract
- `@io/graph-surface` stays the generic readonly record-shell and section
  rendering layer

The new work happens above that layer:

- extract entity row planning out of explorer-specific `EntityInspector`
- make field rendering mode explicit rather than inferred only from writability
- extract a shared record-field body that can render either live entity fields
  or draft fields
- separate field widget behavior from row chrome so surfaces can vary labels,
  descriptions, validation placement, and title/meta treatment per predicate
- add reusable app-owned `EntitySurface` and `CreateEntitySurface` wrappers
  with default product policy
- add an adapter path that can consume `RecordSurfaceSpec` as authored section
  metadata while still resolving live predicate refs for interactive rows
- add a surface-level validation model that can represent both row-local
  mutation failures and create-submit validation failures

The important boundary is:

- `RecordSurfaceSpec` describes structure
- app-owned surfaces own interactive behavior, host policy, and validation
  presentation

Recommended internal shape:

- `EntitySurface`: wrapper for live entities
- `CreateEntitySurface`: wrapper for draft-backed create flows
- one shared body or planner layer over a generic subject shape that exposes:
  - predicate tree
  - type entry
  - icon/title metadata
  - validation state
  - mode
  - optional footer actions

Recommended row model:

- field widget:
  - display renderer
  - editor renderer
  - secret-backed or readonly fallback behavior
- row presentation:
  - role: `title | body | meta | hidden`
  - label: `show | hide | auto`
  - description: `show | hide | auto`
  - validation: `inline | summary-only | auto`
  - status/meta visibility
  - per-mode behavior so one predicate may render differently in `view` and
    `edit`

Example:

- `name` can be `role = title` in `view` mode, meaning "show value without a
  field label"
- the same `name` predicate can fall back to a normal labeled editable row in
  `edit` mode
- `updatedAt` can be `role = meta` and render as low-emphasis footer content

## Rules

- Do not widen `RecordSurfaceSpec` with app-specific policy such as "name
  first" or "hide id". Keep those as host defaults on `EntitySurface`.
- Do not force edit-session logic into the current readonly
  `resolveRecordSurfaceBinding(...)` path.
- Prefer extraction over duplication. `EntityInspector` should become a thin
  wrapper around `EntitySurface`, not a parallel implementation.
- Prefer the same shared field/body surface for create drafts. Do not keep
  `GenericCreateInspector` as a permanent bespoke dialog-only renderer.
- Keep authored field order as the base order, then apply explicit host policy
  only for known system fields.
- Do not conflate field widget choice with row chrome. A predicate may keep the
  same view/editor widgets while changing label, description, validation, or
  title/meta presentation by mode.
- Keep backwards compat low priority. Replace explorer-owned composition once
  the new surface is proven.
- Reuse the existing shared field row and editor plumbing where possible rather
  than inventing a second widget stack.
- Treat validation as a first-class surface concern:
  - row-local predicate mutation errors
  - submit-time create validation errors
  - non-field or hidden-field errors that still need a visible summary

## Open Questions

- Should `updatedAt` render as a compact footer row inside the fields section,
  or as a separate metadata footer below the section?
- Should single-column support be added to
  `RecordSurfaceSectionView`, or should `EntitySurface` own its own section
  rendering while the lower-level record surface stays unchanged?
- Should `view` be the default mode everywhere, with `edit` only opt-in, or
  should explorer routes remember the last selected mode?
- When an authored `RecordSurfaceSpec` explicitly includes system fields such
  as `createdAt` or `id`, should host policy still hide them by default, or
  should authored surfaces be able to opt back in later?
- Should a failed create validation force the surface into `edit` mode when it
  was previously showing `view`?
- Do we want one exported polymorphic surface with `subject.kind = entity |
  draft`, or two exported wrappers over one shared body?
- How should hidden-field validation issues render when the failing path is
  not part of the visible surface policy?
- Should `name` be treated as a special title slot in `view` mode by default,
  or should that only happen when explicit host policy asks for it?
- How much of row presentation should come from authored `RecordSurfaceSpec`
  labels and descriptions versus host-side policy defaults and overrides?

## Success Criteria

- There is one exported app-owned surface path for live entities and one for
  draft-backed create flows, both sharing the same field/body rendering model.
- `EntityInspector` delegates to `EntitySurface` and no longer owns custom row
  planning.
- `GenericCreateInspector` delegates to the shared create-surface path and no
  longer owns bespoke field-section composition.
- The new surface supports explicit `view` and `edit` modes and the two modes
  render differently even for writable fields.
- Per-predicate row chrome is flexible enough to support different behavior by
  mode:
  - a field can hide its label in `view` mode and show it in `edit` mode
  - descriptions can be shown, hidden, or demoted
  - validation can appear inline or in a shared summary
  - title and meta fields can render outside normal body rows
- The default surface renders one field column and applies the desired system
  field policy:
  - type as icon
  - name first
  - id hidden
  - createdAt hidden
  - updatedAt last
- Validation behavior is defined and implemented for both live and draft
  flows:
  - field-level errors can render on the relevant row
  - submit-level create errors can render in one shared surface summary
  - hidden or non-field errors do not disappear silently
- The adapter path from `RecordSurfaceSpec` to entity-surface row planning is
  documented, even if the first rollout only uses inferred sections.
- Relevant docs describe the boundary between app-owned `EntitySurface` and
  lower-level readonly record-surface contracts.
- `turbo check` passes.

## Tasks

- Define the app-owned `EntitySurface` API in `lib/app/src/web/components/`
  with:
  - live entity input for the entity wrapper
  - draft-controller input for the create wrapper
  - runtime and secret-field hooks
  - explicit `view | edit` mode
  - overridable field policy
  - surface-level validation input
- Define a row-presentation model for the shared surface that separates:
  - field widget behavior
  - row chrome behavior
  - mode-specific overrides for labels, descriptions, validation, and
    title/meta roles
- Extract a pure row-planning helper from
  `lib/app/src/web/components/explorer/entities.tsx` that works over a shared
  subject shape and:
  - flattens predicate refs in authored order
  - classifies system fields
  - reorders `name`
  - hides `id` and `createdAt`
  - moves `updatedAt` to the end
  - resolves the displayed type icon separately
  - assigns row roles and chrome defaults for `name`, body fields, and meta
    fields
- Refactor `PredicateRow` in
  `lib/app/src/web/components/explorer/field-editor-row.tsx` so rendering mode
  is explicit:
  - `view` prefers field views
  - `edit` prefers field editors when writable
  - readonly and secret-backed fallbacks keep working
  - external validation issues can be injected by path in addition to existing
    row-local mutation errors
  - row chrome can hide or show labels and descriptions by mode
- Decide and implement the single-column section strategy:
  - either extend `RecordSurfaceSectionView` with a column option and section
    header actions
  - or add an app-owned section renderer used only by `EntitySurface`
- Define a shared validation model for the new surface:
  - path-keyed field issues
  - surface-level issues
  - merge behavior between local mutation failures and external submit
    validation
- Build the first `EntitySurface` implementation with:
  - no top header card
  - no debug disclosure
  - one fields section
  - section-level `view | edit` toggle
  - low-emphasis `updatedAt` rendering at the end
- Build `CreateEntitySurface` on the same shared body using
  `createEntityDraftController(...)` and current create-plan defaults instead
  of bespoke dialog-only composition.
- Replace `EntityInspector` internals with `EntitySurface` while keeping the
  explorer route stable.
- Replace `GenericCreateInspector` internals with `CreateEntitySurface` while
  keeping the current create flow stable.
- Add tests for:
  - system-field ordering and hiding
  - `view | edit` mode switching
  - one-column section rendering
  - field-level validation injection and clearing
  - create-submit validation summary behavior
  - secret-backed and readonly fallback behavior
- Update docs:
  - add an app-owned entity-surface doc under `lib/app/doc/`
  - link it from `lib/app/doc/web-overview.md`
  - update `lib/graph-surface/doc/record-surfaces.md` to restate that
    record-surface runtime remains readonly and is now consumed by a higher
    level interactive entity surface

## Non-Goals

- redesigning module manifest contracts
- turning `RecordSurfaceSpec` into a full edit-session contract
- solving example/module example-type registration in the same change
- changing collection surfaces or query renderer surfaces as part of this
  first extraction
