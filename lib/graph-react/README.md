# Graph React

`@io/graph-react` is the host-neutral React layer for synced graph clients.

It owns the host-neutral edit-session contracts, validation helpers, predicate
and entity hooks, resolver primitives, generic draft-value helpers,
entity-draft controller core, and the synced runtime React context/hooks.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Start with `./src/index.ts` for the package-root public entrypoint.
- Read `./src/predicate.ts` and `./src/entity.tsx` for predicate and entity
  hooks plus metadata readers.
- Read `./src/edit-session.ts`, `./src/validation-issue.ts`, and
  `./src/mutation-validation.ts` for edit-session and validation contracts.
- Read `./src/resolver.tsx` and `./src/filter.tsx` for host-neutral field and
  filter resolver primitives.
- Read `./src/runtime.tsx` and `./src/persisted-mutation.tsx` for synced
  runtime and persisted-mutation hooks.
- Read `./src/entity-draft.ts` and `./src/draft-value.ts` for the draft-backed
  entity controller surface.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-react`.

- [`./doc/predicate-and-entity-hooks.md`](./doc/predicate-and-entity-hooks.md):
  predicate hooks, metadata readers, and entity traversal helpers
- [`./doc/edit-sessions-and-validation.md`](./doc/edit-sessions-and-validation.md):
  edit-session contracts, validation issue modeling, and validated mutation
  helpers
- [`./doc/resolvers-and-filters.md`](./doc/resolvers-and-filters.md):
  host-neutral field and filter resolver primitives
- [`./doc/runtime-and-persisted-mutations.md`](./doc/runtime-and-persisted-mutations.md):
  synced runtime context, query hooks, and persisted mutation flushing
- [`./doc/entity-draft-controller.md`](./doc/entity-draft-controller.md):
  draft-value helpers and the draft-backed entity controller

Cross-package architecture now lives in `../graph-surface/doc/ui-stack.md`
and `../graph-surface/doc/roadmap.md`. Start here when the question is local
to this package. Jump to the broader package docs when the question crosses
package, adapter, or app boundaries.

## What It Owns

- edit-session contracts and commit-policy metadata
- validation issue modeling, aggregation, and graph-validation normalization
- predicate hooks and metadata readers
- entity traversal helpers over typed refs
- host-neutral field and filter resolver primitives
- draft-value helpers and the entity-draft controller core
- synced runtime provider, context, sync-state, and query hooks
- persisted-mutation callbacks over synced runtimes

## Important Semantics

- The default field and filter resolvers are intentionally host-neutral. They
  stay unsupported until a host supplies render-mode capabilities or operand
  editors.
- Field resolver modes are explicit: `view`, `control`, and `field`. The
  `editor` naming is only a compatibility alias for `control`.
- `@io/graph-react` reads predicate metadata and reference policy, but it does
  not own DOM widgets or browser fallbacks.
- `GraphRuntimeProvider` shares one synced graph runtime and also wires the
  persisted-mutation runtime provider used by mutation callbacks.
- `useGraphQuery(...)` recomputes against sync-state changes so host-neutral
  query hooks stay aligned with the synced runtime.
- `createEntityDraftController(...)` builds draft-backed predicate refs over a
  field tree. Its session and field controllers default to submit-oriented
  commit policy rather than mutating the real graph immediately.
- The draft controller's field-level validation helpers only surface issues for
  the predicate being edited. Unrelated validation failures do not block those
  local predicate checks.

## What It Does Not Own

- DOM widgets, browser-only field editors, or renderer composition
- module-authored catalogs, scopes, or schema definitions
- sync transport and client construction APIs
- app-specific explorer or create-flow composition

## Public API Shape

The package root re-exports the curated host-neutral surface from `./src`:

- edit-session contracts
- validation issue modeling and aggregation helpers
- predicate hooks and metadata helpers
- `usePredicateSlotValue(...)`
- draft-value helpers such as `cloneDraftValue(...)`, `sameLogicalValue(...)`,
  `getDraftValue(...)`, `setDraftValue(...)`, and `removeDraftItem(...)`
- `createEntityDraftController(...)`
- synced runtime provider, context, sync-state, and query hooks

The package root is the only public entrypoint.

## Build Output

Run `turbo build --filter=@io/graph-react` from the repo root, or `bun run build`
in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-react` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
colocated Bun tests.

The intended first-read contract artifact for agents is `./out/index.d.ts`.
