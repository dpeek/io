# Graph Integration

`@io/graph-integration` owns downstream graph integration coverage and shared
fixtures that exercise multiple graph packages together.

## What It Owns

- cross-package graph integration suites that would otherwise create package
  graph violations through test-only imports
- shared integration fixtures such as the kitchen-sink schema and bootstrapped
  test graph helpers
- installed-module contract proof coverage that walks authored manifests,
  planner targets, installed-module ledger rows, and fail-closed lifecycle
  planning through public package entrypoints only
- guardrails that fail the workspace on cross-package relative `src/` imports

## What It Does Not Own

- package-local unit tests, probes, and typechecks that can be expressed with
  local fixtures
- app runtime/demo fixtures that ship with `@io/app`
- public runtime APIs for the graph packages themselves

## Package Boundary

`@io/graph-integration` is intentionally downstream of the extracted graph
packages. It depends on public package entrypoints only; graph packages must not
import it.

## Validation

Run `turbo check --filter=@io/graph-integration` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
cross-package Bun suites.
