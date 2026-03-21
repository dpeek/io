# Branch 6: Workflow And Agent Runtime

## Mission

Move work, runs, sessions, artifacts, and context retrieval into the graph so
the system can operate on its own native workflow model.

## Why This Is A Separate Branch

The repo already has a useful agent runtime, but it is still tied to
issue-driven automation. This branch is about productizing workflow and agent
memory as first-class graph capabilities.

## In Scope

- graph-native workflow taxonomy
- run, session, artifact, and decision records
- context-bundle retrieval model
- retained execution history
- Linear mirroring or dual-write during migration
- agent runtime changes needed to consume graph-native workflow state

## Out Of Scope

- full replacement of all external tools on day one
- final polished operator UI for every workflow surface
- every future planning heuristic

## Durable Contracts Owned

- workflow entity model
- run and session lifecycle model
- artifact and decision record model
- agent context-bundle shape

## Likely Repo Boundaries

- `src/agent/`
- future workflow-engine and context-retrieval packages
- graph-native workflow modules

## Dependencies

- Branch 1 for graph persistence and writes
- Branch 4 for workflow and command descriptors as installable module features
- Branch 2 for principal-aware permissions
- Branch 3 for scoped retrieval of work queues and context bundles

## Downstream Consumers

- Branch 7 needs workflow and operator surfaces
- Branch 5 can attach ingest review tasks and artifacts to the workflow model

## First Shippable Milestone

Mirror the current Linear-backed task flow into graph-native workflow entities
and let the agent runtime read context and write artifacts through the graph.

## Done Means

- one real task flow exists in graph-native records
- the agent can retrieve a task-specific context bundle from the graph
- the agent writes run, session, and artifact records back to the graph
- Linear remains only as an adapter, not the only source of truth for that flow

## First Demo

Start a task, inspect the graph-native task and context bundle, run the agent,
and view the resulting artifact and session history in the graph.

## What This Unlocks

- self-hosted workflow proving ground
- durable agent memory
- workflow-native operator surfaces in Branch 7

## Source Anchors

- `doc/02-current-state-architecture.md`
- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`
