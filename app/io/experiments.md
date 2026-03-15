# App Experiment Contract

## Purpose

Define the internal structure for adding a new app experiment without growing
more flat schema, route, and runtime wiring files.

## Layout

Each experiment lives under `../src/experiments/<name>/`.

- `graph.ts`: experiment-owned graph registration plus any schema exports that still
  remain app-local to the experiment
- `seed.ts`: optional example-runtime seed hook for proof data
- `web.ts`: experiment-owned route registration for the shared shell
- optional colocated UI/binding files such as `screen.tsx` when the slice is ready
  to move out of the current flat proof files

Current examples:

- `../src/experiments/company/`: company schema plus company/query/relationship
  proof routes
- `../src/experiments/outliner/`: block schema plus outliner route
- `../src/experiments/env-vars/`: env-var and secret-ref schema plus settings
  route
- `../src/experiments/explorer/`: route-only graph tooling slice
- `../src/experiments/workspace/`: promoted workspace schema wiring plus the
  experiment-local management screen

## Current Namespace Ownership

App experiments currently carry the app-owned `app:` namespace slices that are
still being proven out.

- `core:` remains reserved for the engine metamodel and shared built-ins from
  `@io/graph`.
- `app:` is the bucket for the current experiment and domain slices exposed
  through `app/src/experiments/*`, including the current company/person,
  outliner block, env-var/secret-ref, and workspace/workflow proof types.
- App experiments should not introduce speculative new namespace buckets before
  reusable graph-owned modules exist.

This means an experiment `graph.ts` can still define or register `app:` types
today, but that file should be treated as app-owned proof composition rather
than the long-term canonical home for reusable schema.

When a slice has already been promoted, its experiment `graph.ts` should import
the canonical modules from `@io/graph/schema/app/*` and stay focused on
registration and seeding.

## Shared Contracts

These files stay shared app infrastructure rather than experiment-local code:

- `../src/experiments/contracts.ts`: typed experiment graph and web contracts
- `../src/experiments/graph.ts`: registry that merges experiment schema and
  seed hooks
- `../src/experiments/web.ts`: registry that merges experiment routes
- `../src/graph/app.ts`: app namespace composed from registered experiment
  schema
- `../src/graph/example-data.ts`: example runtime seeding composed from
  registered experiment hooks
- `../src/web/runtime.tsx`: shared synced runtime bootstrap
- `../src/web/app-shell.tsx`: shared shell, navigation, and canonical route
  behavior

## Promotion Out Of `app:`

When an experiment slice becomes reusable enough to move into `graph`, promote
it as one concrete refactor:

1. Move the canonical type modules into `graph/src/schema/app/<slice>/` with
   one directory per type.
2. Keep the experiment `graph.ts` file focused on registration and composition.
3. Keep `seed.ts` proof-oriented and `web.ts` route-oriented.
4. Update imports, tests, and docs in the same change.

Until that promotion happens, experiment graph files remain the current app-side
authoring surface for `app:` proof slices.

## Registration Rules

When adding a new experiment:

1. Create `../src/experiments/<name>/graph.ts` if the slice owns schema or seed
   wiring.
   Promoted reusable schema should be imported from `@io/graph/schema/app/*`
   rather than redefined there.
2. Create `../src/experiments/<name>/web.ts` if the slice owns routed UI.
3. Add the graph definition to `../src/experiments/graph.ts` and the web
   definition to `../src/experiments/web.ts`.
4. Keep runtime bootstrap, shell behavior, and generic bindings in shared app
   infrastructure unless the new slice proves a reusable contract should move.

Route keys, route paths, and schema member names must stay unique across all
registered experiments. The registry tests cover that contract.
