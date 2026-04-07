---
name: Graph module workflow model
description: "Built-in workflow namespace assembly, schema ownership, and the browser-first v1 operator model in @io/graph-module-workflow."
last_updated: 2026-04-03
---

# Graph module workflow model

## Read this when

- you are changing the built-in `workflow:` schema
- you need to understand the package-root `workflow` namespace and manifest
- you are deciding whether behavior belongs in workflow schema, authority
  runtime, or host code

## Main source anchors

- `../src/index.ts`: package-root public entrypoint, `workflow` namespace, and
  `workflowManifest`
- `../src/schema.ts`: canonical workflow export surface
- `../src/type.ts`: workflow-owned types, enums, key patterns, and v1 operator
  model constants
- `./workflow-stack.md`: cross-package browser-first workflow contract
- `../../graph-module/doc/module-stack.md`: built-in module ownership

## What this layer owns

- the built-in `workflow:` namespace and its package-root manifest
- workflow entity, enum, and type definitions
- workflow-owned `env-var` and `document` slices
- the explicit browser-first v1 operator contract that sits above broader
  retained storage

It does not own install lifecycle, authority handlers, app routes, or TUI
components.

## Namespace assembly

`index.ts` is the source of truth for what ships in the built-in `workflow:`
namespace.

It does three concrete things:

- merges `documentSchema`, `envVarSchema`, and `workflowSchema`
- applies the generated `workflow.json` id map through `applyGraphIdMap(...)`
- publishes one canonical `workflow` namespace plus `workflowManifest`

`workflowManifest` currently contributes:

- the built-in `workflow` schema namespace
- the workflow query-surface catalog
- the workflow mutation, session-append, artifact-write, and decision-write
  commands
- the workflow review module read scope
- the branch-board and commit-queue retained projections

It does not implement installation or activation runtime behavior.

## Browser-first v1 model versus stored graph records

`type.ts` keeps the smaller browser-first product model explicit even though the
graph still stores broader workflow and repository-realization records.

The current v1 operator model is:

- one logical `WorkflowProject`
- one attached `WorkflowRepository`
- one operator-visible branch model with `workflowV1Branch`
- commit-first work through `workflowV1Commit`
- explicit session semantics through `workflowV1Session`
- retained session, artifact, and decision history

That model is exported directly through:

- `workflowV1Branch`
- `workflowV1Commit`
- `workflowV1Session`
- `workflowV1CommitStateValues`
- `workflowV1CommitGateValues`
- `workflowV1SessionKindValues`
- `workflowV1SessionStatusValues`

## Key patterns and lineage

The package keeps stable workflow-facing keys explicit:

- `project:`
- `repo:`
- `branch:`
- `commit:`
- `session:`
- `bundle:`

Lineage also stays explicit:

- repository -> project
- branch -> project
- commit -> branch
- session -> branch, with optional commit linkage

## Broader stored records that still matter

The package still ships broader retained or repository-facing records:

- `RepositoryBranch`
- `RepositoryCommit`
- `AgentSession`
- `AgentSessionEvent`
- `WorkflowArtifact`
- `WorkflowDecision`
- `ContextBundle`
- `ContextBundleEntry`

These remain valid current package contracts. The important rule is that
browser-facing and agent-facing reads should project them down to the smaller
workflow v1 model instead of widening the product contract again.

## Practical rules

- Put concrete `workflow:` schema in this package, not in `@io/graph-module`.
- Treat `workflowV1*` exports as the current operator-facing contract.
- Keep authority execution, route handling, and host presentation outside the
  package.
