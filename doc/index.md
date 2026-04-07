---
name: IO docs index
description: "Repo entrypoint for root docs, package-owned current-state docs, and branch specs."
last_updated: 2026-04-07
---

# IO docs index

## Read this when

- you need the repo-level doc entrypoint before changing code
- you need to know whether a topic belongs in root docs or a package-local doc
- you need the long-form vision or the cross-package branch contracts

## Documentation rules

- current-state docs live with the owning package under `lib/*/doc/*.md`
- package future work lives in the owning package `lib/*/doc/roadmap.md`
- root `doc/branch/*.md` owns cross-package workstream contracts and sequencing
- root `doc/vision.md` owns the repo-wide product vision
- the older numbered root synthesis docs are retired; do not recreate them

## Repo overview

`io` is a Bun workspaces repository coordinated by Turborepo. The repo root
owns shared project configuration, entrypoints, and root docs, while packages
under `lib/*` own the operator runtime, graph engine, web surfaces, shared
browser primitives, and shared utilities.

The operator runtime now lives in `@op/cli`. `@io/app` stays focused on the
curated graph helper surface plus app-specific web and Worker composition.
`@io/web` owns reusable browser primitives. `@io/utils` owns shared env, log,
and process helpers.

## Root docs

- `../io.md`: repo-local execution guidance included in prompt context
- `./vision.md`: long-form product vision and platform thesis
- `./agent/backlog.md`: stream, feature, and task planning plus backlog-editing contract
- `./agent/review.md`: post-execution review contract and follow-up issue creation rules
- `./agent/document.md`: doc-maintenance prompt contract
- `./agent/simplify.md`: cleanup prompt contract

## Branch model

Here, "branch" means delivery branch or workstream, not a Git branch.

The current dependency chain is:

1. Branch 1 defines the durable graph and authority kernel
2. Branch 2 defines identity, policy, and sharing rules on top of that graph
3. Branch 3 defines query, sync, projection, and invalidation contracts
4. Branches 4, 5, and 6 build product capabilities on those contracts
5. Branch 7 turns the contracts and capabilities into product surfaces

## Branch specs

- `./branch/01-graph-kernel-and-authority.md`: Branch 1 kernel, persistence,
  sync, and authority contracts
- `./branch/02-identity-policy-and-sharing.md`: Branch 2 identity, policy,
  capability, and sharing contracts
- `./branch/03-sync-query-and-projections.md`: Branch 3 scoped sync, query,
  projection, and invalidation contracts
- `./branch/04-module-runtime-and-installation.md`: Branch 4 module manifests,
  installation, migration, and permission contracts
- `./branch/05-blob-ingestion-and-media.md`: Branch 5 blob, ingestion,
  provenance, and media contracts
- `./branch/06-workflow-and-agent-runtime.md`: Branch 6 workflow and agent
  runtime contracts
- `./branch/07-web-and-operator-surfaces.md`: Branch 7 browser and operator
  surface contracts

## Package docs

- `../lib/cli/doc/agent-runtime.md`: issue-driven automation runtime,
  scheduler, workspace lifecycle, and retained runtime behavior
- `../lib/cli/doc/agent-workflow.md`: workflow loading, issue routing, context
  assembly, and module-scoped doc selection
- `../lib/cli/doc/command-surfaces.md`: current `io agent ...`,
  `io browser-agent ...`, `io mcp ...`, and `io tui ...` command groups
- `../lib/cli/doc/legacy-agent-tui.md`: retained operator-facing session
  monitor for `io agent tui ...`
- `../lib/cli/doc/graph-mcp.md`: current graph MCP read surface and opt-in
  write gate
- `../lib/cli/doc/roadmap.md`: future CLI and graph MCP direction
- `../lib/cli/doc/tui.md`: terminal workflow product surface and the boundary
  against the legacy agent TUI
- `../lib/graph-kernel/doc/runtime-stack.md`: graph workspace layout, current
  package boundaries, and the package-owned documentation rule
- `../lib/graph-kernel/doc/roadmap.md`: graph-engine roadmap plus the package
  map for future-state docs
- `../lib/graph-client/doc/roadmap.md`: computed-value and derived-read
  direction above typed refs
- `../lib/graph-surface/doc/roadmap.md`: proposed graph-native record and
  collection surfaces, edit-session semantics, and route-level UI direction
- `../lib/graph-authority/doc/roadmap.md`: retained-record boundary and
  durable restore direction above the live authority graph
- `../lib/app/doc/web-overview.md`: current app-owned browser and Worker runtime
  map
- `../lib/app/doc/workflow-web.md`: current browser workflow surface and
  browser-agent boundary
- `../lib/app/doc/auth-store.md`: current Better Auth store and migration path
- `../lib/app/doc/local-bootstrap.md`: current localhost-only instant-onboarding
  contract
- `../lib/app/doc/authority-storage.md`: current SQLite-backed Durable Object
  authority storage shape, raw-SQL decision, retained rows, and secret
  side-storage
- `../lib/app/doc/roadmap.md`: future Better Auth and browser workflow
  direction

## Layout

- `../package.json`: Bun workspaces, the pinned package manager version, the
  root Turbo web-dev entrypoint, and app auth-migration proxy scripts
- `../turbo.json`: repo task graph for `build`, `check`, `clean`, and `dev`
- `../.oxlintrc.json`, `../.oxfmtrc.json`: repo-wide lint and formatting config
- `../io.ts`: repo config, context registry, profiles, modules, and routing
- `../lib/app/`: `@io/app`, the app package for graph helper exports plus the
  browser Worker, routes, and app-owned web composition
- `../lib/cli/`: `@op/cli`, the operator shell package for command dispatch,
  task execution, agent and browser-agent runtimes, MCP, TUI, and runtime config
- `../lib/graph-*/`: extracted graph kernel, bootstrap, client, authority,
  sync, projection, query, workflow, and surface packages
- `../lib/web/`: `@io/web`, the shared browser primitive package for reusable
  controls, markdown, Monaco, and source-preview chrome
- `../lib/utils/`: `@io/utils`, the shared runtime helper package for env,
  logging, and process helpers
