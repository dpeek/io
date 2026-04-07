---
name: Graph surface react dom
description: "Browser mounts and override seams for @io/graph-surface/react-dom."
last_updated: 2026-04-03
---

# Graph surface react dom

## Read this when

- you are changing `@io/graph-surface/react-dom`
- you need to understand the current browser mount behavior for collection or
  record surfaces
- you are deciding where host customization belongs

## Main source anchors

- `../src/react-dom/collection-surface-mount.tsx`: collection mount and
  unavailable states
- `../src/react-dom/collection-command-buttons.tsx`: proving-ground command
  triggers
- `../src/react-dom/record-surface-mount.tsx`: record shell, sections, and
  related collections
- `../src/react-dom/record-surface-mount.test.tsx`: current shell and override
  coverage

## What this layer owns

- browser mounting for collection surfaces
- browser mounting for readonly record surfaces
- the current shared record shell and section chrome
- a minimal button layer for collection commands

It does not own route registration, app shell composition, or general command
form or dialog infrastructure.

## Collection surface mounts

`CollectionSurfaceMount`:

- resolves the authored collection through `resolveCollectionSurfaceBinding(...)`
- creates or accepts a query-container runtime controller
- renders a loading or unavailable card until binding succeeds
- mounts `QueryContainerSurface` once the binding is ready

Default behavior:

- renderer registry defaults to `builtInQueryRendererRegistry`
- renderer capabilities come from that registry
- runtime defaults to `createCollectionSurfaceRuntime(...)`

`CollectionSurfaceMountView` is the read-only sibling that renders
`QueryContainerSurfaceView` from an already-resolved binding.

## Collection unavailable states

The current browser layer treats loading and integration failures the same way:

- show one card with the collection title and description
- show either a resolving message or the explicit binding issue

That keeps authored-surface lookup failures visible in the browser without
throwing the whole page.

## Collection command buttons

`CollectionCommandButtons` is intentionally small.

Current behavior:

- nothing renders without a usable subject
- one command may run at a time
- `confirm` submit behavior becomes a small inline confirm panel
- all other supported submit behaviors become direct buttons

The component does not currently interpret `inputPresentation.kind` beyond that
minimal confirm flow.

## Record surface mounts

`RecordSurfaceMount`:

- resolves the record binding asynchronously
- renders a loading or unavailable card while binding is unresolved
- delegates final rendering to `RecordSurfaceMountView`

`RecordSurfaceMountView`:

- uses the shared `RecordSurfaceLayout`
- renders each section through `RecordSurfaceSectionView`
- renders related collections below the sections
- accepts host overrides for title, subtitle, badges, status, icon, and field
  rendering

## Record shell behavior

The current record shell is readonly and opinionated:

- title and subtitle are rendered as inline values
- arrays and objects have explicit fallback formatting
- empty values render as `Unset`, `Empty`, or `Untitled` depending on context
- default section rows show label, optional description, and a rendered value

`RecordSurfaceSectionView` also supports:

- `chrome={false}` to skip the outer card shell
- `renderField(...)` to replace per-field rendering while keeping shared
  section structure

## Related collections

Related collection panels only mount when `relatedMountOptions` includes:

- collection lookup
- installed query-surface registry

Otherwise the browser shows a related-collection unavailable card. The record
mount does not guess how to recover missing query runtime dependencies.

## Practical rules

- Keep route and shell composition above this package.
- Use `renderField(...)` and the mount props for targeted customization before
  forking the whole shell.
- Keep general browser field widgets and query renderer implementations in the
  lower-level adapter packages they already belong to.
