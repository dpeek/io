---
name: Graph query workbench
description: "Route-neutral draft hydration, browser storage, preview runtime, and save helpers in @io/graph-query."
last_updated: 2026-04-02
---

# Graph query workbench

## Read this when

- you are changing query-workbench draft reopening or preview behavior
- you need to understand browser storage for saved query or saved view records
- you are wiring route state to the shared query runtime without app-local policy

## Main source anchors

- `../src/query-workbench.ts`: route-target resolution, storage, preview runtime, and save helpers
- `../src/query-workbench.test.ts`: stale route-state and preview-runtime coverage
- `../src/query-editor.ts`: draft hydration and serialization
- `../src/query-container.ts`: preview runtime controller
- `../../app/src/web/lib/query-workbench.ts`: app-local default-surface wrapper over the generic helpers

## What this layer owns

- route-neutral query-workbench target resolution
- hydration of saved-query, saved-view, or inline-draft targets into editor drafts
- memory and browser stores for durable saved query or saved view records
- preview runtime helpers built on the shared query-container runtime
- save helpers that wrap lower-level persistence errors into workbench-specific errors

It does not own app route parsing or route-local default-surface policy.

## Route target model

`resolveQueryWorkbenchRouteTarget(...)` collapses route-like input into one explicit target:

- `blank`
- `draft`
- `saved-query`
- `saved-view`
- `invalid`

Failures stay explicit:

- invalid encoded draft state
- invalid parameter overrides
- missing saved query or saved view records
- stale or incompatible saved-query compatibility

That lets callers fail closed before they try to hydrate the editor or preview runtime.

## Browser storage

`createQueryWorkbenchBrowserStore(...)` wraps one memory store with versioned local storage.

Important rules:

- the storage key defaults to `io.web.query-workbench`
- persisted data is versioned by `queryWorkbenchStoreVersion`
- version mismatch or unreadable JSON clears the stored payload

This store keeps saved query or saved view records. It does not persist app chrome or route-specific UI state.

## Preview runtime

`createQueryWorkbenchPreviewRuntime(...)` reuses the shared query-container runtime:

- inline drafts execute through `requestSerializedQuery(...)`
- saved-query previews resolve through the same saved-source resolver used by other runtime consumers
- optional inline parameter definitions can be injected for draft previews

That keeps preview execution on the same cache, validation, and stale-recovery path as the rest of the package.

## Save helpers

- `saveQueryWorkbenchQuery(...)` serializes a validated editor draft into a saved query record
- `saveQueryWorkbenchView(...)` saves the query first, then a saved view with validated container defaults
- lower-level `SavedQuerySaveError` failures are coerced into `QueryWorkbenchSaveError`

## Practical rules

- Keep workbench helpers route-neutral and browser-safe.
- Keep invalid targets explicit instead of partially hydrating stale state.
- App wrappers may choose better defaults for one route, but the generic workbench helpers should not hard-code them.
