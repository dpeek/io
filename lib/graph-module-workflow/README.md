# Graph Module Workflow

`@io/graph-module-workflow` is the canonical workspace package for the built-in
`workflow:` namespace.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Start with `./src/index.ts` for the package-root public entrypoint and
  `workflowManifest`.
- Read `./src/schema.ts` for the canonical workflow package export surface.
- Read `./src/type.ts` for workflow-owned graph contracts and the browser-first
  v1 operator model bridge.
- Read `./src/command.ts`, `./src/session-append.ts`,
  `./src/artifact-write.ts`, and `./src/decision-write.ts` for the command
  surfaces.
- Read `./src/projection.ts`, `./src/query.ts`, and
  `./src/query-executors.ts` for review-scope projections, query surfaces, and
  scope reads.
- Read `./src/client/*` and `./src/server/mutation.ts` for the packaged read,
  live-sync, session-feed, and mutation transport contracts.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@io/graph-module-workflow`.

- [`./doc/workflow-stack.md`](./doc/workflow-stack.md): cross-package ownership for the browser-first v1 workflow contract
- [`./doc/workflow-model.md`](./doc/workflow-model.md): built-in `workflow:`
  namespace assembly, schema ownership, and the browser-first v1 operator
  model
- [`./doc/workflow-commands.md`](./doc/workflow-commands.md): workflow
  mutation, retained session append, artifact write, and decision write
  commands
- [`./doc/projections-and-query-surfaces.md`](./doc/projections-and-query-surfaces.md):
  review-scope projections, dependency keys, invalidation, and built-in query
  surfaces
- [`./doc/reads-and-live-sync.md`](./doc/reads-and-live-sync.md): scope reads,
  read-client request kinds, session-feed contract, and live refresh
- [`./doc/env-vars.md`](./doc/env-vars.md): the `workflow:envVar` slice as a
  consumer of the shared secret-handle contract
- [`./doc/documents.md`](./doc/documents.md): workflow-owned document,
  document-block, and document-placement slices

Cross-package architecture now lives in `./doc/workflow-stack.md`,
`../graph-module/doc/module-stack.md`, and
`../graph-module/doc/secret-stack.md`. Start here when the question is local
to this package. Jump to the root graph docs when the question crosses
package, authority, or product boundaries.

## What It Owns

- the canonical `workflow` namespace assembly
- the built-in `workflowManifest` authored through the shared graph-module
  manifest contract
- workflow entity, enum, and type definitions
- workflow command contracts and summary/result types, including retained
  session append, artifact-write, and decision-write surfaces
- workflow projection metadata, read-scope contracts, dependency-key planning,
  invalidation helpers, and shared Branch 3 registrations
- workflow query-surface catalogs for planner, saved-query, editor, and
  renderer registration
- retained workflow projection checkpoint and row types
- workflow query/projection index builders and projection schema
- workflow-owned `env-var` and `document` slices
- workflow-specific read clients, session-feed contracts, live wrappers, and
  mutation helpers via `./client` and `./server`

## Important Semantics

- `workflowManifest` publishes definition-time runtime contributions only:
  built-in schemas, workflow query-surface catalogs, workflow commands, the
  review module read scope, and the retained projections. Install lifecycle and
  activation state stay authority-owned.
- `type.ts` keeps the browser-first v1 operator model explicit even while the
  graph still stores broader repository and retained-runtime records. The
  package exports `workflowV1Branch`, `workflowV1Commit`, and
  `workflowV1Session` as the current product contract.
- Retained storage still uses `AgentSession` and `AgentSessionEvent`. The
  explicit bridge to `WorkflowSession` semantics lives in `session-append.ts`,
  which maps retained session kinds and runtime states onto the smaller v1
  session contract.
- `workflow:mutation` is the typed server-command write surface for project,
  repository, branch, commit, and session changes. Mutable session writes stay
  narrowed to `Plan`, `Review`, and `Implement` until native workflow-session
  storage lands.
- The package owns the workflow review read scope, projection dependency keys,
  invalidation planning, and the built-in query-surface catalog for the branch
  board, commit queue, and review scope.
- The `client` and `server` subpaths publish transport and helper contracts,
  not app route handlers or Durable Object composition.
- `workflow:envVar` consumes the shared secret-handle authoring contract. It
  does not define secret storage or authority runtime behavior itself.

## What It Depends On

- `@io/graph-module` for module authoring helpers
- `@io/graph-module-core` for built-in core scalar and shared value contracts
- `@io/graph-kernel` for ids and low-level graph helpers
- `@io/graph-client` for typed query helpers
- `@io/graph-projection` for retained projection and invalidation contracts

## What It Does Not Own

- generic helpers from `@io/graph-module`
- `core:` schema/contracts from `@io/graph-module-core`
- graph-owned saved-query, saved-query-parameter, and saved-view durability
  records from `@io/graph-module-core`
- host-neutral React helpers from `@io/graph-react`
- web authority handlers in `lib/app/src/web/lib/*`
- app route handlers, Durable Object composition, or other host/runtime adapters
- workflow UI components in `lib/app/src/web/components/*` or `lib/cli/src/tui/*`

The package root is the canonical internal import surface for built-in
`workflow:` contracts, projection metadata, and query helpers. Web and TUI
runtime code consume this package; they do not extend it.

## Entrypoints

- `@io/graph-module-workflow`
- `@io/graph-module-workflow/client`
- `@io/graph-module-workflow/server`

## Query Ownership

- `workflowQuerySurfaceCatalog` and the related
  `workflowBuiltInQuerySurface*` exports are workflow-local module metadata for
  planner, editor, renderer, and saved-query compatibility
- workflow owns the concrete projection-backed collection surfaces and the
  workflow review scope surface; it does not own the durable saved-query
  graph objects
- the current built-in registry combines this package-root catalog with the
  core package-root catalog in the app installation layer

Callers import workflow query-surface metadata through the package root:

```ts
import { workflowManifest, workflowQuerySurfaceCatalog } from "@io/graph-module-workflow";
```

The same package root is also the canonical place to import the current shared
Branch 3 registrations:

```ts
import {
  workflowReviewModuleReadScopeRegistration,
  workflowReviewRetainedProjectionProviderRegistration,
} from "@io/graph-module-workflow";
```

## Build Output

Run `turbo build --filter=@io/graph-module-workflow` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-module-workflow` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.

The intended first-read contract artifact for agents is `./out/index.d.ts`.
