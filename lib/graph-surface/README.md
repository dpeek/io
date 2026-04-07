# Graph Surface

`@io/graph-surface` owns route-neutral collection-surface, collection-command,
and record-surface runtime on top of `@io/graph-query`.

The root package resolves authored `CollectionSurfaceSpec` and
`RecordSurfaceSpec` contracts into shared runtime bindings. The `react-dom`
subpath provides the browser mounts for those surfaces.

Record surfaces currently cover the smallest shared detail/runtime slice:

- title and subtitle field binding
- readonly section and field-row rendering
- related collection panels by composing collection-surface mounts
- `ObjectViewSpec` compatibility via explicit adaptation into
  `RecordSurfaceSpec`

Generic command wiring and edit orchestration still stay host-owned.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Start with `./src/index.ts` for the root runtime entrypoint.
- Read `./src/collection-surface.ts` for collection-surface binding and
  query-container runtime integration.
- Read `./src/collection-command-surface.ts` for collection command subject and
  binding resolution.
- Read `./src/record-surface.ts` for readonly record binding and
  `ObjectViewSpec` adaptation.
- Read `./src/react-dom/index.ts` for the browser entrypoint.
- Read `./src/react-dom/collection-surface-mount.tsx` and
  `./src/react-dom/record-surface-mount.tsx` for the current browser mounts.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-surface`.

- [`./doc/ui-stack.md`](./doc/ui-stack.md): cross-package ownership for typed refs, host-neutral React runtime, route-neutral surface runtime, and browser adapters
- [`./doc/collection-surfaces.md`](./doc/collection-surfaces.md): collection
  binding, saved-query and saved-view compatibility, and query-container
  runtime wiring
- [`./doc/collection-commands.md`](./doc/collection-commands.md): entity and
  selection command binding in the current proving-ground browser host
- [`./doc/record-surfaces.md`](./doc/record-surfaces.md): readonly record
  binding and `ObjectViewSpec` adaptation
- [`./doc/react-dom.md`](./doc/react-dom.md): browser mounts, shared shell
  components, and override seams
- [`./doc/roadmap.md`](./doc/roadmap.md): future graph-native surfaces,
  editing, command-surface UX, and route direction

Cross-package authored contract and UI boundary docs now live in
`./doc/ui-stack.md`, `../graph-query/doc/query-stack.md`, and
`./doc/roadmap.md`. Start here when the question is local to the surface
runtime. Jump to the broader package docs when the question crosses authored
metadata, query execution, or app route ownership.

## What It Owns

- route-neutral collection-surface binding over installed query surfaces and
  saved queries
- collection command binding for the current browser proving ground
- readonly record-surface binding over authored sections and related
  collections
- `ObjectViewSpec` compatibility adaptation into `RecordSurfaceSpec`
- browser mounts for collection and record surfaces

## Important Semantics

- The current collection runtime only binds query-backed collection surfaces.
  Other `CollectionSurfaceSpec.source.kind` values fail closed.
- The current collection renderer runtime supports `list`, `table`, and
  `card-grid`. `board` is still unsupported at this layer.
- Collection presentation fields resolve in a fixed order: explicit authored
  fields first, then default-selected query-surface selections, then all
  selections, then ordering or filter metadata.
- The default collection runtime delegates page execution to
  `requestSerializedQuery(...)`.
- Collection command binding is intentionally narrow in the current browser
  host: entity and selection subjects work; scope subjects do not.
- The same proving-ground command layer only supports post-success behaviors
  `refresh` and `openCreatedEntity`.
- Record surfaces are currently readonly bindings over a lookup. They read
  title, subtitle, section fields, and related collection references, but they
  do not own edit-session orchestration.
- `RecordSurfaceMount` can render related collections only when the caller
  provides both a collection lookup and an installed query-surface registry.

## Entrypoints

- `@io/graph-surface`
- `@io/graph-surface/react-dom`

## What It Does Not Own

- pure authored `CollectionSurfaceSpec`, `RecordSurfaceSpec`,
  `GraphCommandSurfaceSpec`, or `ObjectViewSpec` contracts
- query transport, saved-query persistence, or query-surface catalog ownership
- field resolver primitives, field widgets, or browser field adapters
- route registration, shell composition, or authoritative command execution

## Root API

- `resolveCollectionSurfaceBinding`
- `createCollectionSurfaceSourceResolver`
- `createCollectionSurfaceRuntime`
- `createEntityCollectionCommandSubject`
- `createSelectionCollectionCommandSubject`
- `resolveCollectionCommandBindings`
- `resolveRecordSurfaceBinding`
- `adaptObjectViewToRecordSurface`

## `react-dom` API

- `CollectionSurfaceMount`
- `CollectionSurfaceMountView`
- `CollectionCommandButtons`
- `RecordSurfaceMount`
- `RecordSurfaceMountView`
- `RecordSurfaceLayout`
- `RecordSurfaceSectionView`

## Build Output

Run `turbo build --filter=@io/graph-surface` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-surface` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.

The intended first-read contract artifact for agents is `./out/index.d.ts`.
