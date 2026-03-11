# Remaining Schema-Driven UI Backlog

## Purpose

This document makes the remaining schema-driven UI backlog concrete.

It is a companion to:

- `doc/schema-driven-ui-implementation-plan.md`
- `doc/web-bindings.md`
- `doc/typed-refs.md`

The architecture docs describe the model. This document describes the proof surfaces, file boundaries, and staging assumptions for the remaining IO backlog items.

## Current Starting Point

The current repo already provides the main proof surfaces the remaining backlog should build on:

- `app/src/graph/app.ts`
  - `company.name`
  - `company.status`
  - `company.foundedYear`
  - `company.website`
  - `company.tags`
  - `person.worksAt`
- `graph/src/type/address/index.ts`
  - an existing richer `address` type that is not yet wired into the app namespace
- `app/src/web/*`
  - the current web package and dev surface

The remaining backlog should prefer additive work on those surfaces over inventing a separate demo domain.

## Phase 3 Backlog

### OPE-47: Generic web field renderers

Goal:
prove that the resolver from Phase 3 can drive a useful generic UI path.

Concrete proof surface:

- `company.name` as the base text field
- `company.foundedYear` as the first numeric optional field
- `company.website` as the first URL field
- `company.status` as the first enum field

Implementation notes:

- Keep the renderer inputs centered on `PredicateRef`, not projected values.
- Make the generic path work for both read-only and editable modes.
- Let metadata select variants such as badge vs plain text and link vs external-link without changing the field contract.
- Leave `company.tags` and `person.worksAt` for Milestone 4 rather than back-solving `many` and relationship semantics here.

Validation focus:

- one field component subscribes to one predicate slot
- unrelated field edits do not rerender sibling field components
- the generic path is strong enough that the company proof can compose from it directly

Out of scope:

- async option loading
- relationship pickers
- collection-aware editors
- generated layout systems beyond the minimal proof

### OPE-48: Company proof of concept

Goal:
validate the whole Phase 3 loop on a narrow real entity surface.

Concrete proof surface:

- one generated inspector or editor for `company`
- required fields: `name`, `status`, `website`
- optional fourth field: `foundedYear`

Implementation notes:

- Reuse the generic renderer path from `OPE-47` rather than adding ad hoc company-specific components.
- Prefer one small dev surface in `app/src/web/*` over a broad explorer rewrite.
- Add light rerender instrumentation so the proof records whether predicate-local invalidation actually holds.

Validation focus:

- the parent entity composition stays stable while leaf fields rerender
- edits mutate through predicate refs rather than projected patch objects
- the result is convincing enough to either continue into Milestone 4 or revise the model while the scope is still small

Out of scope:

- nested fields
- `many` collections
- entity-reference editing
- query and filter builders

## Milestone 4 Backlog

### OPE-49: Nested field-tree traversal

Goal:
define how nested schema shape survives into the ref surface without introducing nested snapshot subscriptions.

Concrete proof surface:

- an address-like nested group
- each leaf still resolves to its own `PredicateRef`

Implementation notes:

- Reuse the existing `address` type if practical, but wire it into the app schema deliberately instead of treating it as a floating example.
- The first step is traversal shape and ref identity, not the full nested editor experience.
- Keep the distinction explicit between a nested traversal helper and a subscribed reactive unit.

Validation focus:

- nested traversal preserves schema shape
- leaf refs remain stable and subscribe independently
- parent sections do not subscribe to full nested subtree state by accident

Out of scope:

- final relationship editing UX
- collection semantics for `many`
- broad renderer customization

### OPE-50: Collection-aware editing semantics

Goal:
define a first coherent editing model for `many` fields before relationship semantics are layered in.

Concrete proof surface:

- `company.tags` as the first `many string` field

Implementation notes:

- Start with explicit unordered tag semantics unless ordering is truly required.
- Prefer `replace`, `add`, and `remove` over a generic catch-all setter API.
- Keep logical slot notifications tied to the collection value consumers observe, not raw edge churn.

Validation focus:

- one `PredicateRef` can drive a complete collection editor
- tag edits do not cause unrelated fields to rerender
- the API does not pretend every `many` field has the same UX requirements

Out of scope:

- ordered list reordering if not required for the first proof
- relationship pickers
- async validation pipelines

### OPE-51: Entity-reference field policies

Goal:
add the first explicit typed UI policy for relationship fields while keeping references distinct from embedded values.

Concrete proof surface:

- `person.worksAt`

Implementation notes:

- Focus on selecting, displaying, and removing existing related entities first.
- Treat create-and-link as optional follow-up behavior, not the minimum slice.
- Keep the resolver output reference-aware so the relationship path does not look like an embedded object editor.

Validation focus:

- a relationship field can render from a `PredicateRef`
- the UI preserves entity identity semantics
- reference editing policy remains explicit in metadata or resolver behavior

Out of scope:

- deep relationship browsing
- generalized async search infrastructure
- full inline creation workflows

### OPE-52: Milestone 4 proof of concept

Goal:
combine nested traversal, collection editing, and relationship policies into one convincing proof surface.

Concrete proof surface:

- nested address fields
- one tags-like `many string` field
- one relationship field such as `worksAt`

Implementation notes:

- A cohesive two-entity flow is acceptable if it keeps the proof small; do not force every field onto one schema type just for aesthetics.
- Prefer extending an existing surface such as `person` or `company` over inventing a fresh demo app.
- Keep the demo focused on validating semantics and rerender behavior, not on shipping polished layout or navigation.

Validation focus:

- nested leaf fields remain independently subscribed
- collection editing feels coherent in a generated UI
- relationship editing is explicit and typed rather than snapshot-driven

Out of scope:

- generalized form-builder layout APIs
- query/filter UI
- final design polish

## Staging Rules

- Do not solve Milestone 4 concerns inside Phase 3 issues.
- Prefer one clear proof surface per issue over prematurely generalized abstractions.
- When in doubt, make the first behavior explicit and narrow, then generalize after the proof succeeds.
