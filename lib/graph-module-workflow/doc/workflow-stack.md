---
name: Graph workflow stack
description: "Cross-package ownership for the browser-first v1 workflow contract centered on @io/graph-module-workflow."
last_updated: 2026-04-03
---

# Graph workflow stack

## Read this when

- the question spans `@io/graph-module-workflow`, `@io/graph-module-core`,
  `@io/graph-authority`, app-owned workflow routes, or the operator-facing v1
  workflow contract
- you need the shared workflow boundary before changing workflow schema,
  workflow reads, or authoritative workflow writes
- you want the owning package doc before editing a workflow-related area

## Main source anchors

- `../src/index.ts`: package-root public entrypoint and `workflowManifest`
- `../src/type.ts`: browser-first v1 workflow model constants and stored graph
  contracts
- `../src/command.ts`: typed workflow mutation command surface
- `../src/projection.ts`: workflow projections, read scopes, and query surfaces
- `../src/client/read.ts`: packaged browser read contract
- `../../graph-authority/src/session.ts`: authoritative apply and replay above
  the shared workflow command layer
- `../../app/src/web/lib/authority.ts`: current host-owned workflow authority
  implementation

## What this doc owns

- the cross-package ownership map for the shipped workflow stack
- stable seams between the built-in workflow schema, shared durable core
  records, authority-owned execution, and the browser-first v1 product model
- redirects to the package-local docs that own current runtime behavior

It does not own browser shell chrome, TUI rendering, or browser-agent
filesystem runtime behavior.

## Current ownership

- `@io/graph-module-workflow` owns the concrete built-in `workflow:` schema,
  workflow commands, review projections, query-surface catalogs, env-var and
  document slices, and packaged read or live-sync contracts
- `@io/graph-module-core` owns the shared durable `core:` records those
  workflow contracts depend on, especially saved queries, saved views, and
  shared value or identity contracts
- `@io/graph-authority` owns authoritative workflow execution, installed-module
  activation state, and graph-backed command application
- host runtime code owns route composition, Durable Object wiring, browser
  pages, and the local browser-agent runtime

## Stable contracts

### Browser-first v1 priorities

The first browser workflow milestone stays focused on these rules:

- one inferred `WorkflowProject`
- one attached `WorkflowRepository`
- one operator-visible `WorkflowBranch`: `main`
- a commit queue as the primary workflow surface
- explicit workflow sessions
- one `UserReview` gate
- authoritative retained session, artifact, and decision history
- no separate `WorkflowRun`

That smaller operator-facing model is deliberate even though the graph still
stores broader retained and repository-realization records.

### Workflow model versus stored graph records

`type.ts` keeps the browser-first product model explicit through:

- `workflowV1Branch`
- `workflowV1Commit`
- `workflowV1Session`

The package still ships broader retained or repository-facing records such as:

- `RepositoryBranch`
- `RepositoryCommit`
- `AgentSession`
- `AgentSessionEvent`
- `WorkflowArtifact`
- `WorkflowDecision`
- `ContextBundle`
- `ContextBundleEntry`

Important rule:

- browser-facing and agent-facing reads should project those broader records
  down to the smaller v1 model instead of widening the product contract again

### Workflow writes stay command-first

Workflow writes should stay behind typed commands rather than raw host-owned
entity mutation.

That means:

- the package owns typed workflow command contracts
- authority and host code own actual execution and route composition
- browser and TUI code consume the typed workflow contract instead of
  rebuilding workflow semantics ad hoc

### Authority and host boundaries

Keep these out of the package surface:

- authority execution details
- route composition
- Durable Object plumbing
- browser shell composition
- browser-agent launch, attach, or finalization mechanics

Those belong above the shared built-in module package even when they are part of
the shipped workflow product.

## Where current details live

- `./workflow-model.md`: built-in `workflow:` namespace assembly and v1 model
- `./workflow-commands.md`: typed workflow command surfaces
- `./projections-and-query-surfaces.md`: review projections, scopes, and
  built-in query surfaces
- `./reads-and-live-sync.md`: packaged workflow read or live-sync contracts
- `./env-vars.md`: `workflow:envVar` as a consumer of the shared secret-handle
  contract
- `./documents.md`: workflow-owned document slices
- `../../graph-authority/doc/authority-stack.md`: command-lowering,
  authorization, and host-owned workflow execution
- `../../graph-module/doc/module-stack.md`: built-in module ownership and
  authored manifest lifecycle
- `../../../doc/branch/06-workflow-and-agent-runtime.md`: broader workflow and
  agent-runtime branch direction
- `../../app/doc/workflow-web.md`: current app-owned browser workflow surface
- `../../app/doc/roadmap.md`: future browser workflow direction above the
  shared package boundary

## Related docs

- `../../graph-query/doc/query-stack.md`: query surfaces and review-scope
  execution
- `../../graph-module/doc/secret-stack.md`: secret-handle contract used by
  workflow env vars

Keep this doc narrow. Current-state package behavior belongs in the package docs
listed above.
