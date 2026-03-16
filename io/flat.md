# Flat Source Tree Proposal

## Status

Proposal.

This document describes how this repo could move from a Bun workspace with many
small internal packages to one root package with one TypeScript source tree,
while keeping explicit module boundaries, curated imports, and per-tree compiler
settings.

## Purpose

The current workspace split is useful for naming and export curation, but much
of the package surface is operational overhead:

- repeated `package.json` files with similar scripts
- repeated `tsconfig.json` files extending the same base config
- many internal imports that primarily use workspace package names as aliases
- some package wrappers that are very thin, such as `config`

This proposal keeps the good parts:

- explicit public entrypoints
- human-readable import names
- per-domain ownership
- room for stricter lint and type boundaries

It removes the parts that create busywork:

- separate internal package manifests for every domain slice
- workspace dependency wiring for code that always ships together
- package-level ceremony for moves that are really intra-repo refactors

## Current Signals

The repo already behaves more like one codebase with domain folders than like a
set of independently versioned packages:

- most package `tsconfig.json` files extend `../lib/tsconfig.base.json`
- many packages differ only by a few compiler options or dependencies
- several package roots are thin export aggregators
- cross-package imports are common and intentional

Representative current packages:

- `agent`: scheduler, tracker integration, runtime state, prompt assembly, TUI
- `app`: app composition, server wiring, experiments, and proof routes
- `graph`: reusable graph engine, schema, and adapter subpaths
- `lib`: shared helpers and config loading
- `cli`: operator command surface
- `config`: root config re-export

The strongest real boundary today is not "separate package installability". It
is "separate public import surface". This proposal preserves that distinction.

## Decision Summary

Recommended target:

1. Keep one repo and one root package.
2. Move internal source under one `src/` tree with domain subfolders.
3. Keep curated public entrypoints through root `exports`.
4. Keep multiple TypeScript project configs for different source trees.
5. Enforce cross-domain imports through named entrypoints rather than relative
   path reach-through.
6. Keep docs organized by domain even if package boundaries disappear.

Recommended target layout:

```text
src/
  agent/
  app/
  cli/
  config/
  graph/
  lib/

io/
  overview.md
  workflow.md
  backlog.md
  flat.md
```

Recommended import style:

- allowed: `@io/core/graph`
- allowed: `@io/core/lib/config`
- allowed: `@io/core/agent`
- disallowed: `../../graph/...`
- disallowed: `../lib/src/...`
- disallowed: reaching into another domain's private file tree unless that path
  is an exported subpath

## Goals

- reduce internal package boilerplate without weakening architecture
- preserve curated import surfaces and legible ownership
- keep per-tree TypeScript customization where it is genuinely needed
- avoid turning the repo into unrestricted relative-import sprawl
- make internal moves cheaper while keeping review boundaries explicit

## Non-Goals

- publishing each current internal domain as an independently consumable package
- changing runtime behavior as part of the flattening itself
- forcing all code to use one identical compiler config
- removing the logical distinction between engine, app, CLI, and agent code

## Target Package Model

### One root package

Use one root `package.json` as the only package manifest for internal code.

It should own:

- all shared dependencies
- all root scripts
- all exported internal subpaths
- all top-level lint and typecheck commands

Example direction:

```json
{
  "name": "@io/core",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./agent": "./src/agent/index.ts",
    "./app": "./src/app/index.ts",
    "./cli": "./src/cli/index.ts",
    "./config": "./src/config/index.ts",
    "./graph": "./src/graph/index.ts",
    "./graph/react": "./src/graph/react/index.ts",
    "./graph/react-dom": "./src/graph/react-dom/index.ts",
    "./graph/react-opentui": "./src/graph/react-opentui/index.ts",
    "./graph/schema": "./src/graph/schema/index.ts",
    "./graph/schema/*": "./src/graph/schema/*/index.ts",
    "./graph/taxonomy/*": "./src/graph/taxonomy/*.ts",
    "./lib": "./src/lib/index.ts",
    "./lib/config": "./src/lib/config.ts",
    "./tsconfig/base": "./tsconfig.base.json"
  }
}
```

The exact package name is less important than keeping the import contract stable
and explicit.

### Domain subtrees

Keep current domain ownership, just under one source root:

- `src/agent/*`
- `src/app/*`
- `src/cli/*`
- `src/config/*`
- `src/graph/*`
- `src/lib/*`

This keeps physical layout familiar while removing workspace packaging
ceremony.

### Public entrypoints

Each domain keeps one intentional entrypoint and optional documented subpaths:

- `src/agent/index.ts`
- `src/app/index.ts`
- `src/cli/index.ts`
- `src/config/index.ts`
- `src/graph/index.ts`
- `src/lib/index.ts`

Subpaths remain appropriate when they reflect a real public surface:

- `@io/core/graph/react`
- `@io/core/graph/react-dom`
- `@io/core/graph/react-opentui`
- `@io/core/lib/config`

The rule is:

- one source tree does not mean one undifferentiated API surface

## TypeScript Model

## Keep Multiple TS Projects

One root package does not require one giant undifferentiated `tsconfig`.

Recommended config set:

```text
tsconfig.base.json
tsconfig.json
tsconfig.agent.json
tsconfig.app.json
tsconfig.cli.json
tsconfig.graph.json
tsconfig.lib.json
```

Recommended roles:

- `tsconfig.base.json`: strict shared defaults
- `tsconfig.json`: solution-style project references, no direct include
- `tsconfig.agent.json`: `src/agent/**/*`
- `tsconfig.app.json`: `src/app/**/*`
- `tsconfig.cli.json`: `src/cli/**/*`
- `tsconfig.graph.json`: `src/graph/**/*`
- `tsconfig.lib.json`: `src/lib/**/*` and `src/config/**/*`

### Why this still matters

Some trees already need different compiler behavior.

Current examples:

- `agent` uses `jsxImportSource: "@opentui/react"`
- several trees use Bun types
- graph and app have their own test and output assumptions

So the flattening should preserve per-tree compiler overrides instead of forcing
everything through a single `include`.

### Recommended root solution config

Example direction:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.lib.json" },
    { "path": "./tsconfig.graph.json" },
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.agent.json" },
    { "path": "./tsconfig.cli.json" }
  ]
}
```

### Recommended subtree config pattern

Example direction for `agent`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "jsxImportSource": "@opentui/react",
    "types": ["@types/bun"]
  },
  "include": ["src/agent/**/*"]
}
```

Example direction for `graph`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "types": ["@types/bun"],
    "resolveJsonModule": true
  },
  "include": ["src/graph/**/*"]
}
```

The point is not to preserve every current file exactly. The point is to keep
tree-local compiler intent.

## Import Boundary Rules

This proposal only works if import discipline becomes stricter, not looser.

Recommended rules:

1. Code may import within its own subtree using relative paths.
2. Code may import from another subtree only through exported root-package
   subpaths.
3. Cross-domain relative imports are forbidden.
4. Private implementation files must stay private even though they now live in
   the same package.

Examples:

- `src/agent/service.ts` may import `./workflow.ts`
- `src/agent/service.ts` may import `@io/core/lib`
- `src/agent/service.ts` may import `@io/core/lib/config`
- `src/agent/service.ts` may not import `../lib/config.ts`
- `src/app/*` may import `@io/core/graph/react-dom`
- `src/app/*` may not import `../graph/react-dom/fields.tsx` directly unless
  that file is deliberately exported

### Enforcement

Enforce with lint, not convention alone.

Recommended guardrails:

- restricted import patterns for `../<other-domain>/...`
- restricted imports for private files outside the current subtree
- optional domain-tag rules if you want stronger layering later

The key property is:

- flattening the package model should not flatten architecture

## Dependency Model

## One dependency graph, explicit policy

With one package, package-manager dependency ownership becomes weaker.

That means the repo must decide whether these are acceptable tradeoffs:

- any source file can technically import any installed dependency
- the package manager no longer tells you which domain "owns" a dependency
- app-only or agent-only dependencies need lint or documentation guardrails if
  you care about accidental spread

Recommended policy:

- keep one root dependency set
- document which dependencies are domain-specific
- add lint restrictions only where accidental use would cause real harm

Suggested practical categories:

- root-safe: `zod`, small shared utilities
- graph-only or graph-plus-host-adapter: `react`
- agent-only: OpenTUI packages, Linear SDK
- app-only: browser, Vite, Wrangler, UI packages

The repo likely does not need hard policy for every library on day one. Start
with the dependencies that signal architectural drift if imported from the wrong
place.

## Script Model

Root scripts should replace repeated per-package scripts.

Example direction:

- `bun run lint`
- `bun run types`
- `bun run test`
- `bun run check`
- `bun run dev:app`
- `bun run dev:agent`
- `bun run dev:graph`

Implementation options:

1. one root command that runs all subtree checks
2. one root command per subtree for focused local iteration

Recommended approach:

- keep both aggregate and focused commands

Example shape:

```json
{
  "scripts": {
    "lint": "oxlint",
    "types": "tsgo --noEmit -p tsconfig.json",
    "test": "bun test",
    "check": "bun run lint && bun run types && bun run test",
    "check:app": "bun run lint src/app && bun run types -p tsconfig.app.json && bun test src/app",
    "check:graph": "bun run lint src/graph && bun run types -p tsconfig.graph.json && bun test src/graph",
    "check:agent": "bun run lint src/agent && bun run types -p tsconfig.agent.json && bun test src/agent"
  }
}
```

The exact command syntax can change based on tool capabilities, but the intent
should remain:

- central scripts
- subtree-focused validation

## Docs And Ownership Model

The current docs already describe logical ownership better than package
manifests do. That should continue.

Recommended doc model after flattening:

- keep `io/` as the repo-level contract and planning surface
- keep domain docs near domain concerns:
  - `agent/io/*`
  - `graph/io/*`
  - `app/io/*`
- update wording from "workspace/package" to "domain/subtree" where appropriate
- keep references to domain ownership explicit even if the package boundary is
  gone

Important distinction:

- removing internal packages should not erase domain language from docs

## Migration Strategy

## Phase 0: Decide the import contract first

Goal:

- agree on the boundary model before moving files

Steps:

1. Decide the root package name and public subpath scheme.
2. Decide which current package exports remain public.
3. Decide which current package entrypoints become private implementation.
4. Decide whether any current domain should remain a real separate package.

Exit criteria:

- one written import contract
- one proposed `exports` map
- one list of intentionally public subpaths

## Phase 1: Introduce root exports and TS project refs

Goal:

- create the future control plane before a large source move

Steps:

1. Add root `exports` that describe the target public surfaces.
2. Add root solution `tsconfig.json` plus subtree configs.
3. Add lint rules for forbidden cross-domain relative imports.
4. Keep the existing workspace layout temporarily while these rules land.

Expected result:

- the future import discipline becomes real before files move

## Phase 2: Move source trees without changing public import names

Goal:

- flatten physical layout while minimizing call-site churn

Steps:

1. Move `agent/src/*` to `src/agent/*`.
2. Move `app/src/*` to `src/app/*`.
3. Move `cli/src/*` to `src/cli/*`.
4. Move `config/src/*` to `src/config/*`.
5. Move `graph/src/*` to `src/graph/*`.
6. Move `lib/src/*` to `src/lib/*`.
7. Update root exports to point at the new paths.
8. Keep import names stable where possible.

Expected result:

- most call sites keep the same conceptual imports even though files moved

## Phase 3: Remove package wrappers and duplicate config

Goal:

- delete obsolete workspace scaffolding

Steps:

1. Remove internal package manifests that only existed for workspace wiring.
2. Remove duplicate package-local scripts now replaced at the root.
3. Replace package-local tsconfig inheritance paths with root project configs.
4. Remove internal dependency links such as `workspace:*`.

Expected result:

- one dependency manifest
- one script surface
- one TS solution model

## Phase 4: Tighten private/public boundaries

Goal:

- make sure flattening did not widen the usable internal API by accident

Steps:

1. Audit each exported subpath for necessity.
2. Remove any subpaths that merely expose convenience internals.
3. Add more lint restrictions where accidental imports appear.
4. Keep domain index files intentionally small and curated.

Expected result:

- the public surface stays smaller than the physical tree

## Phase 5: Clean docs, tooling, and commands

Goal:

- finish the conceptual migration

Steps:

1. Update docs that still say "workspace" or "package" where that wording is no
   longer accurate.
2. Update dev scripts and operator commands.
3. Update any CI or editor settings that assume package directories.
4. Update import examples in docs and tests.

Expected result:

- repo language matches repo structure

## Suggested File Layout

This is a concrete direction for the main source tree:

```text
src/
  index.ts

  agent/
    index.ts
    server.ts
    service.ts
    workflow.ts
    workspace.ts
    tracker/
    runner/
    tui/
    plugin/

  app/
    index.ts
    server.ts
    server-app.ts
    authority.ts
    graph/
    experiments/
    type/
    web/

  cli/
    index.ts
    cli.ts
    create.ts
    install.ts
    res/

  config/
    index.ts

  graph/
    index.ts
    graph/
    react/
    react-dom/
    react-opentui/
    schema/
    taxonomy/
    type/

  lib/
    index.ts
    config.ts
    env.ts
    log.ts
    process.ts
```

Notes:

- `config` can stay tiny if it is still useful as a semantic alias
- `graph` should keep its current subpath structure because that boundary is
  real
- `agent/plugin/*` should remain internal unless there is a real consumer-facing
  reason to export it

## Special Cases In This Repo

### `graph` is the strongest candidate for curated subpaths

The current `graph` package already has meaningful exported subpaths:

- root graph API
- React bindings
- DOM bindings
- OpenTUI bindings
- schema subpaths
- taxonomy subpaths

Those should remain explicit in the flat model. This proposal is not arguing for
one giant `src/index.ts` export barrel.

### `config` is the strongest candidate to collapse completely

The current `config` tree is mostly a semantic re-export of the root config.

That means it can either:

1. disappear entirely, with callers importing from a root config entrypoint, or
2. remain as `src/config/index.ts` as a stable semantic alias

Either is viable. The second option is easier on callers.

### `agent` needs its own TS settings

`agent` already uses a different JSX import source for OpenTUI. That is the
best example of why "flat source tree" should not mean "single tsconfig include
for everything".

### `app` and `graph` still need conceptual separation

Even inside one package:

- `graph` should remain reusable engine and adapter code
- `app` should remain composition, authority wiring, server transport, and proof
  ownership

The current modularity docs still matter after flattening.

## Risks

### Risk: Relative-import sprawl

If the repo removes packages but does not enforce exported-subpath imports, the
result will be worse than the current model.

Mitigation:

- add lint restrictions before or at the same time as the move

### Risk: Hidden dependency spread

With one root manifest, code may begin importing heavy or host-specific
dependencies from inappropriate trees.

Mitigation:

- document dependency ownership
- add targeted import restrictions for the highest-risk libraries

### Risk: Public API expands accidentally

A flatter tree makes it easy to import implementation files directly.

Mitigation:

- make exported subpaths the default rule
- keep domain index files curated
- forbid direct imports into other domains' private files

### Risk: TS/editor performance regressions

A poorly configured giant project can be slower than several smaller ones.

Mitigation:

- keep solution-style references
- keep subtree includes narrow
- avoid one monolithic `include: ["src/**/*"]` as the only project

### Risk: Migration churn masks behavior changes

A large move can create noisy diffs that hide real regressions.

Mitigation:

- land boundary and config changes before physical moves
- migrate one subtree at a time if needed
- keep import names stable as long as possible

## Validation Plan

The migration should prove the following after each phase:

- typechecking still works per subtree and at the root
- public import names continue to resolve
- cross-domain relative imports are blocked by lint
- tests still run by subtree and at the root
- docs and examples use the new import contract consistently

Recommended checks:

1. root typecheck across project references
2. subtree typecheck for `agent`, `app`, and `graph`
3. root test run
4. focused test runs for the moved subtree
5. lint check specifically covering import-boundary rules

## Recommended Adoption Strategy

Recommended pilot order:

1. establish root exports and TS project refs
2. flatten `lib` and `config` first because they are small and low-risk
3. flatten `cli` next
4. flatten `agent` once OpenTUI config and runtime commands are stable
5. flatten `graph` and `app` carefully, preserving their curated subpaths and
   conceptual separation

Reasoning:

- `lib` and `config` give the highest boilerplate reduction for the lowest
  architectural risk
- `graph` and `app` carry the strongest real boundary, so they should move after
  the enforcement tooling is proven

## Recommendation

This repo is a credible candidate for a flat internal source tree because the
current workspace model mostly provides naming and export structure rather than
independent package lifecycles.

The proposal is good only if all of the following remain true:

1. imports still go through curated named entrypoints
2. multiple TS project configs remain in place
3. lint rules enforce cross-domain boundaries
4. `graph`, `app`, `agent`, `cli`, and `lib` remain explicit domain concepts

The bad version of this idea is:

- one package
- one giant source tree
- no import rules
- no public/private distinction

The good version is:

- one package
- one source tree
- many explicit domain entrypoints
- many TS projects
- stricter boundary enforcement than the current workspace happens to provide

Under those guardrails, flattening would likely reduce busywork in this repo
without sacrificing the architecture the current docs are trying to protect.
