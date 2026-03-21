# Branch 7: Web And Operator Surfaces

## Mission

Turn the platform contracts into usable web and operator surfaces for browsing,
editing, syncing, debugging, and operating the graph product.

## Why This Is A Separate Branch

The platform needs a consumer branch that turns the lower-level contracts into
real product value. This branch should move fast without re-owning kernel,
policy, sync, or module contracts.

## In Scope

- app shell and authenticated browser bootstrap
- module host and route composition
- graph explorer and devtools
- capability-aware entity and collection views
- sync status and operator tooling
- install and workflow surfaces as downstream contracts stabilize

## Out Of Scope

- ownership of graph, sync, module, or policy contracts
- low-level query planner implementation
- queue consumers and blob extraction runtime

## Durable Contracts Owned

- module-host interface for web views and editors
- capability-aware browser client expectations
- operator-facing shell and tooling conventions

## Likely Repo Boundaries

- `src/web/`
- shared web component packages
- TUI or operator integration surfaces that consume workflow state

## Dependencies

- Branch 1 for stable graph bootstrapping and authority APIs
- Branch 2 for auth and capability-aware behavior
- Branch 3 for scoped sync and projection-backed queries
- Branch 4 for module-host registration
- Branch 6 for workflow and artifact surfaces

## Downstream Consumers

- this is the main product-facing consumer branch rather than a dependency
  provider for other branches

## First Shippable Milestone

Ship a capability-aware app shell that can load one installed module over one
scoped sync view while preserving the graph explorer as a power tool.

## Done Means

- a signed-in user can load the app shell and a module view
- the module view uses documented host contracts rather than bespoke wiring
- the browser works against scoped sync rather than assuming whole-graph state
- the explorer and operator tools still work for debugging

## First Demo

Sign in, load one installed module, edit an entity through the module surface,
and watch the scoped sync and explorer update coherently.

## What This Unlocks

- a product-facing proof beyond pure devtools
- operator confidence in module install, workflow, and ingest features
- a surface that can expose later sharing and federation capabilities

## Source Anchors

- `doc/02-current-state-architecture.md`
- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/08-vision-overview.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`
