---
name: Graph module workflow projections and query surfaces
description: "Review-scope projections, dependency keys, invalidation, and built-in query surfaces in @io/graph-module-workflow."
last_updated: 2026-04-03
---

# Graph module workflow projections and query surfaces

## Read this when

- you are changing workflow review projections or invalidation
- you need to understand the workflow query-surface catalog
- you are debugging scope or projection ownership at module boundaries

## Main source anchors

- `../src/projection.ts`: read scope, dependency keys, invalidation, retained
  projection registration, and built-in query surfaces
- `../src/query-executors.ts`: built-in query executor planning
- `../src/projection.test.ts`: invalidation and registration coverage
- `./workflow-stack.md`: cross-package workflow product contract

## What this layer owns

- the workflow review module read scope
- the branch-board and commit-queue retained projections
- dependency-key planning and invalidation fan-out for workflow review
- the built-in workflow query-surface catalog

It does not own durable saved-query records. Those stay in
`@io/graph-module-core`.

## Read scope and dependency keys

The current packaged review scope is:

- `scope:workflow:review`

The package publishes:

- `workflowReviewModuleReadScope`
- `workflowReviewModuleReadScopeRegistration`
- `workflowReviewSyncScopeRequest`
- `workflowReviewScopeDependencyKey`

The current dependency-key set is intentionally small and explicit:

- the workflow review scope key
- the project-branch-board projection key
- the branch-commit-queue projection key

## Projections and invalidation

The shipped retained projections are:

- `workflow:project-branch-board`
- `workflow:branch-commit-queue`

Writes that touch workflow review entity types conservatively invalidate the
full workflow review dependency-key set. The current invalidation proof is
deliberately broader than a minimal per-projection delta.

`createWorkflowReviewInvalidationEvent(...)` currently emits:

- `cursor-advanced` delivery only
- both workflow projection ids
- the workflow review scope id

The retained provider registration also stays fail closed:

- missing projection state rebuilds
- incompatible state rebuilds
- stale state rebuilds

## Built-in query surfaces

The package-root workflow catalog currently publishes three surfaces:

- `workflow:project-branch-board`
- `workflow:branch-commit-queue`
- `scope:workflow:review`

Exports to use:

- `workflowQuerySurfaceCatalog`
- `workflowBuiltInQuerySurfaces`
- `workflowBuiltInQuerySurfaceIds`

These surfaces are module-owned metadata that later query runtime layers can
install and dispatch through.

## Executor boundary

`query-executors.ts` is the package-local bridge from normalized serialized
queries to workflow scope reads.

Current rules include:

- the branch-board surface requires an equality filter for `projectId`
- the branch-board surface only supports workflow-owned filters and order
  fields declared by the package
- the commit-queue surface requires an equality filter for `branchId`
- the commit-queue surface does not support custom ordering
- the review scope surface routes through module-scope query execution

Unsupported query shapes reject instead of being coerced silently.

## Practical rules

- Change `projection.ts` when workflow review ownership or invalidation changes.
- Change the query-surface catalog here when workflow-owned surfaces actually
  change.
- Keep saved-query durability in `graph-module-core` even when the bound
  surface belongs to this package.
