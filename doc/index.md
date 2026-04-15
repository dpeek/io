---
name: Graphle docs index
description: "Repo entrypoint for root docs, package-owned current-state docs, and branch specs."
last_updated: 2026-04-15
---

# Graphle docs index

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

`graphle` is a Bun workspaces repository coordinated by Turborepo. The repo root
owns shared project configuration, entrypoints, and root docs, while packages
under `lib/*` own the operator runtime, graph engine, web surfaces, shared
browser primitives, and shared utilities.

The public product command now lives in `@dpeek/graphle`, with `graphle dev`
delegating to `@dpeek/graphle-local` for the personal-site local runtime.
`@dpeek/graphle-sqlite` owns local SQLite bootstrap plus persisted authority
storage, and `@dpeek/graphle-module-site` owns the `site:` schema. The
operator runtime remains in `@dpeek/graphle-cli`. `@dpeek/graphle-app` stays
focused on the curated graph helper surface plus app-specific web and Worker
composition. `@dpeek/graphle-web` owns reusable browser primitives.
`@dpeek/utils` owns shared env, log, and process helpers.

## Root docs

- `../graphle.md`: repo-local execution guidance included in prompt context
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

- `../lib/graphle/README.md`: public `graphle` binary package and `graphle dev`
  dispatch boundary
- `../lib/graphle-local/doc/local-dev.md`: local personal-site dev runtime,
  project bootstrap, persisted site authority, signed-cookie auth, `/api/*`
  routes, and browser opening
- `../lib/graphle-sqlite/doc/sqlite-bootstrap.md`: local `graphle.sqlite`
  creation, metadata bootstrap, persisted-authority storage, and health summary
- `../lib/graphle-module-site/doc/site-schema.md`: built-in `site:` schema for
  personal-site pages, posts, status, and paths
- `../lib/graphle-cli/doc/agent-runtime.md`: issue-driven automation runtime,
  scheduler, workspace lifecycle, and retained runtime behavior
- `../lib/graphle-cli/doc/agent-workflow.md`: workflow loading, issue routing, context
  assembly, and module-scoped doc selection
- `../lib/graphle-cli/doc/command-surfaces.md`: current `graphle agent ...`,
  `graphle browser-agent ...`, `graphle mcp ...`, and `graphle tui ...` command groups
- `../lib/graphle-cli/doc/legacy-agent-tui.md`: retained operator-facing session
  monitor for `graphle agent tui ...`
- `../lib/graphle-cli/doc/graph-mcp.md`: current graph MCP read surface and opt-in
  write gate
- `../lib/graphle-cli/doc/roadmap.md`: future CLI and graph MCP direction
- `../lib/graphle-cli/doc/tui.md`: terminal workflow product surface and the boundary
  against the legacy agent TUI
- `../lib/graphle-kernel/doc/runtime-stack.md`: graph workspace layout, current
  package boundaries, and the package-owned documentation rule
- `../lib/graphle-kernel/doc/roadmap.md`: graph-engine roadmap plus the package
  map for future-state docs
- `../lib/graphle-client/doc/roadmap.md`: computed-value and derived-read
  direction above typed refs
- `../lib/graphle-surface/doc/roadmap.md`: proposed graph-native record and
  collection surfaces, edit-session semantics, and route-level UI direction
- `../lib/graphle-authority/doc/roadmap.md`: retained-record boundary and
  durable restore direction above the live authority graph
- `../lib/graphle-app/doc/web-overview.md`: current app-owned browser and Worker runtime
  map
- `../lib/graphle-app/doc/entity-surface.md`: app-owned interactive entity-surface
  family above readonly record surfaces
- `../lib/graphle-app/doc/workflow-web.md`: current browser workflow surface and
  browser-agent boundary
- `../lib/graphle-app/doc/auth-store.md`: current Better Auth store and migration path
- `../lib/graphle-app/doc/local-bootstrap.md`: current localhost-only instant-onboarding
  contract
- `../lib/graphle-app/doc/authority-storage.md`: current SQLite-backed Durable Object
  authority storage shape, raw-SQL decision, retained rows, and secret
  side-storage
- `../lib/graphle-app/doc/roadmap.md`: future Better Auth and browser workflow
  direction

## Layout

- `../package.json`: Bun workspaces, the pinned package manager version, root
  Turbo clean and web-dev entrypoints, and app auth-migration proxy scripts
- `../turbo.json`: repo task graph for `build`, `check`, `clean`, and `dev`
  where `clean` is uncached and removes local Turbo build artifacts
- `../.oxlintrc.json`, `../.oxfmtrc.json`: repo-wide lint and formatting config
- `../graphle.ts`: repo config, context registry, profiles, modules, and routing
- `../lib/graphle/`: `@dpeek/graphle`, the public command package for
  `bunx @dpeek/graphle dev`
- `../lib/graphle-local/`: `@dpeek/graphle-local`, the phase-1 local Bun server,
  cwd project bootstrap, local auth, persisted site authority startup, browser
  opening, and placeholder rendering
- `../lib/graphle-sqlite/`: `@dpeek/graphle-sqlite`, the local
  `graphle.sqlite` open/bootstrap helper and persisted authority adapter
- `../lib/graphle-module-site/`: `@dpeek/graphle-module-site`, the built-in
  `site:` namespace for page and post records in the personal-site MVP
- `../lib/graphle-app/`: `@dpeek/graphle-app`, the app package for graph helper exports plus the
  browser Worker, routes, and app-owned web composition
- `../lib/graphle-cli/`: `@dpeek/graphle-cli`, the operator shell package for command dispatch,
  task execution, agent and browser-agent runtimes, MCP, TUI, and runtime config
- `../lib/graphle-*/`: extracted graph kernel, bootstrap, client, authority,
  sync, projection, query, workflow, and surface packages
- `../lib/graphle-web/`: `@dpeek/graphle-web`, the shared browser primitive package for reusable
  controls, markdown, Monaco, and source-preview chrome
- `../lib/utils/`: `@dpeek/utils`, the shared runtime helper package for env,
  logging, and process helpers
