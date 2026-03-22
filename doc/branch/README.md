# Platform Branches

These docs translate the roadmap and vision into parallel workstreams. Here,
"branch" means delivery branch or workstream, not a Git branch.

The goal is to let multiple agents build the product in parallel without hiding
the real contract dependencies. Parallel work is only real when one branch can
make progress behind stable or explicitly provisional interfaces.

## Branch Specs

Each branch now lives in one canonical document. The former overview brief is
merged into the front of each file so the delivery summary and implementation
contract stay together.

1. [`01-graph-kernel-and-authority.md`](./01-graph-kernel-and-authority.md):
   stable facts, ids, schema, authoritative transactions, persistence, sync,
   and secret handling
2. [`02-identity-policy-and-sharing.md`](./02-identity-policy-and-sharing.md):
   principal model, auth projection, predicate-level policy, capability grants,
   and sharing contracts
3. [`03-sync-query-and-projections.md`](./03-sync-query-and-projections.md):
   scope-based sync, bounded queries, materialized indexes, and live scope
   registration
4. [`04-module-runtime-and-installation.md`](./04-module-runtime-and-installation.md):
   installable modules, manifests, migrations, permissions, and runtime
   registration
5. [`05-blob-ingestion-and-media.md`](./05-blob-ingestion-and-media.md):
   blob metadata, upload and finalize flow, queue-backed ingestion,
   derivatives, provenance, and file or media module families
6. [`06-workflow-and-agent-runtime.md`](./06-workflow-and-agent-runtime.md):
   graph-native workflow, context retrieval, runs, sessions, artifacts, and
   the agent runtime
7. [`07-web-and-operator-surfaces.md`](./07-web-and-operator-surfaces.md):
   browser bootstrap, module hosting, capability-aware UX, graph devtools, and
   operator surfaces

## Critical Path

The hard dependency chain is:

1. Branch 1 defines the durable graph and authority kernel
2. Branch 2 defines who can see and mutate which parts of that graph
3. Branch 3 defines how authorized slices are queried, indexed, synced, and
   invalidated
4. Branches 4, 5, and 6 build product capabilities on top of those contracts
5. Branch 7 turns the contracts and capabilities into a usable product surface

The product can make real parallel progress before all of those are complete,
but only if the early branches publish provisional contracts quickly.

## Safe Parallel Start

Wave 1:

- Branch 1 can start immediately
- Branch 2 can start immediately on principal and policy contracts
- Branch 4 can start on manifest shape and built-in module install flow using a
  provisional permission model
- Branch 6 can start on graph-native workflow types and Linear mirroring using
  current graph primitives
- Branch 7 can keep improving the shell and devtools against the current
  single-graph proof

Wave 2:

- Branch 3 becomes the focus once Branch 1 has stable transaction and cursor
  contracts and Branch 2 has a usable policy filter model
- Branch 5 can move once Branch 1 defines blob records and Branch 4 defines how
  blob-backed module families register

Later:

- federation-heavy work should wait until Branches 2 and 3 have stabilized
- polished module UX should wait until Branches 3 and 4 stop moving under it

## Shared Contracts To Stabilize Early

- fact, edge, and transaction model: owned by Branch 1
- principal, policy, and capability model: owned by Branch 2
- scope, query, projection, and invalidation model: owned by Branch 3
- module manifest and install contracts: owned by Branch 4
- blob record and ingest job contracts: owned by Branch 5
- workflow, run, artifact, and context-bundle contracts: owned by Branch 6
- module-host and capability-aware client contracts: owned by Branch 7
