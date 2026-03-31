# Graph React

`@io/graph-react` is the canonical host-neutral React layer for synced graph
clients.

## What It Owns

- edit-session and field-controller contracts for draft-backed create, update,
  and command-input flows
- normalized validation issue and aggregation helpers for field, form, and
  command surfaces
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

- edit-session and field-controller contracts
- normalized validation issue modeling and aggregation helpers
- predicate hooks and metadata helpers
- field and filter resolver primitives
- entity traversal helpers
- mutation validation and persisted mutation helpers
- synced runtime provider, context, sync-state, and query hooks

Cross-package traversal coverage now lives in `@io/graph-integration`.

## Edit Session Contract

The extracted edit-session layer is intentionally small and host-neutral:

- `EditSessionController<Value>` owns whole-session draft, commit, revert,
  touched, and field lookup behavior
- `EditSessionFieldController<Value>` narrows that contract to one field path
- `ValidationIssue` helpers give field, form, command, and authority validation
  one shared issue shape

`EditSessionCommitPolicy` is descriptive metadata rather than a built-in
scheduler. Hosts and renderers decide when to call `commit()`, while the shared
runtime exposes one common policy contract:

- `immediate`: apply the draft change and commit it in the same interaction
- `blur`: keep a dirty draft while the control is active, then commit on blur
- `debounce`: keep a dirty draft until the debounce window elapses, then commit
- `submit`: keep the whole interaction draft-backed until an explicit submit or
  commit call

Field controllers may override `defaultCommitPolicy` with a field-specific
`commitPolicy`. The current explorer create-draft controller is the first
downstream integration path and uses `{ mode: "submit" }` for both the session
default and generated field controllers so the create flow stays draft-backed
until submit.

## Build Output

Run `turbo build --filter=@io/graph-react` from the repo root, or `bun run build`
in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-react` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
colocated Bun tests.
