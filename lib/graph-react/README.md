# Graph React

`@io/graph-react` is the canonical host-neutral React layer for synced graph
clients.

## What It Owns

- predicate binding hooks such as `usePredicateField(...)` and
  `usePredicateValue(...)`
- entity and relationship traversal helpers such as `EntityPredicates` and
  `PredicateRelatedEntities`
- host-neutral field and filter resolver contracts
- mutation validation and persisted-mutation helpers
- generic synced-runtime React context, sync-state, and query hooks

## What It Does Not Own

- DOM widgets, field editors, icon rendering, or other browser-only components
- OpenTUI-specific rendering
- web bootstrap, loading, and error UI
- kernel ids, store primitives, or schema authoring helpers
- workflow or other domain-specific schema packages
- sync transport and client construction APIs

## Package Split

- `@io/graph-react` owns the host-neutral React runtime contracts.
- `@io/graph-module-core/react-dom` owns the current default browser/DOM
  composition on top of those contracts, including both the generic field and
  filter widgets and the core-owned defaults such as `GraphIcon`.
- There is no `@io/graph-react-dom` package anymore.
- The former `react-opentui` adapter has been collapsed away because its shared
  runtime provider and query hooks were host-neutral and now live here.

## Public API Shape

The package root re-exports the curated host-neutral surface from `./src`:

- predicate hooks and metadata helpers
- field and filter resolver primitives
- entity traversal helpers
- mutation validation and persisted mutation helpers
- synced runtime provider, context, sync-state, and query hooks

Cross-package traversal coverage now lives in `@io/graph-integration`.

## Build Output

Run `turbo build --filter=@io/graph-react` from the repo root, or `bun run build`
in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-react` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
colocated Bun tests.
