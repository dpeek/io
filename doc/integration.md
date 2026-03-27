# Graph Integration Test Migration Plan

## Purpose

This document describes how to move graph integration coverage into a dedicated
downstream package, `@io/graph-integration`, so graph packages no longer create
package-graph cycles through test-only imports and shared fixtures.

## Status

Implemented on 2026-03-29:

- SVG sanitization moved into `@io/graph-module-core`, with `@io/app/graph`
  kept as a compatibility re-export
- the empty `lib/graph-test-fixtures` stub was repurposed into
  `lib/graph-integration`
- the first cross-package suites now live in `@io/graph-integration`:
  - authority integration coverage
  - client bootstrap integration coverage
  - module-core `react-dom` integration coverage
  - graph-react entity traversal coverage
- shared kitchen-sink and bootstrapped test-graph fixtures now live under
  `lib/graph-integration/src/fixtures`
- a guardrail test now fails the workspace on cross-package relative `src/`
  imports

Remaining migration candidates:

- app-owned graph suites that still behave like downstream integration coverage
- any future shared fixture that cannot stay package-local without depending on
  another package's internals

## Current Problems

### 1. A real runtime cycle exists today

This is the highest-priority issue because it is not just a test-layout
problem.

- `@io/app` depends on `@io/graph-module-core`
- `@io/graph-module-core` imports `sanitizeSvgMarkup` from `@io/app/graph`
- those imports currently live in:
  - `lib/graph-module-core/src/core/icon.ts`
  - `lib/graph-module-core/src/react-dom/icon.tsx`
  - `lib/graph-module-core/src/react-dom/fields/svg-preview.tsx`

That makes `@io/app` an upstream utility package even though it is also
downstream of the extracted graph packages.

### 2. Integration tests bypass the package graph

Several graph packages import other packages through `src/` paths instead of
through workspace package exports.

- `lib/graph-authority/src/authority.test.ts`
  - imports `../../app/src/graph/testing/kitchen-sink.js`
  - imports `../../graph-module-core/src/index.js`
- `lib/graph-client/src/bootstrap-integration.test.ts`
  - imports `../../graph-bootstrap/src/test-fixtures.js`
- `lib/graph-module-core/src/react-dom/index.test.tsx`
- `lib/graph-module-core/src/react-dom/field-registry.test.tsx`
- `lib/graph-module-core/src/react-dom/filter.typecheck.ts`
  - import `../../../app/src/graph/testing/kitchen-sink.js`
- `lib/graph-react/src/entity.test.tsx`
  - imports `../../app/src/graph/test-graph.js`

These files work around the package graph instead of using it.

### 3. Fixture ownership is mixed

The main shared graph fixtures are spread across package internals:

- `lib/app/src/graph/testing/kitchen-sink.ts`
- `lib/app/src/graph/test-graph.ts`
- `lib/graph-bootstrap/src/test-fixtures.ts`

Those fixtures are used by tests in other packages, but they are not owned by a
package that is explicitly downstream of the graph workspace.

### 4. Not every shared fixture is actually test-only

`kitchenSink` is also used by the app runtime demo in
`lib/app/src/web/components/views-page.tsx`.

That means we should not blindly move everything under `app/src/graph/testing`
into an integration-only package without first separating demo/runtime fixtures
from integration fixtures.

## Target State

### Package layout

Create a new private workspace package:

- `lib/graph-integration`
- package name: `@io/graph-integration`

This package is intentionally downstream of the extracted graph packages and the
root `@io/app` package. It owns:

- graph integration tests that exercise multiple packages together
- shared integration fixtures and setup helpers
- package-graph-safe imports through public package entrypoints only

### Boundary rules

- Graph packages keep unit tests, probes, and typechecks that can run against
  local fixtures and their own public surface.
- Cross-package graph tests move into `@io/graph-integration`.
- No graph package may import another package through `../other-package/src/...`
  or `../../app/src/...`.
- `@io/graph-integration` may depend on graph packages, but graph packages must
  not depend on `@io/graph-integration`.

## Migration Plan

### Phase 1: Remove the runtime cycle first

Before moving tests, move `sanitizeSvgMarkup` out of `@io/app/graph` and into a
lower graph-owned package.

Recommended destination:

- `@io/graph-module-core` if SVG sanitization is part of the built-in core icon
  contract

Expected result:

- `@io/graph-module-core` no longer imports `@io/app/graph`
- `@io/app/graph` can re-export the lower-level helper if the root barrel still
  needs it

This phase is required even if no tests move yet.

### Phase 2: Scaffold `@io/graph-integration`

Create a package with the same workspace conventions as the other graph
packages.

Minimum setup:

- `package.json`
- `tsconfig.json`
- `src/`
- `check` script that runs lint/format/test the same way as the rest of the
  workspace

The package should depend on the graph packages it integrates and on `@io/app`
only when it is validating a root `@io/app` graph surface on purpose.

Note: there is already an empty `lib/graph-test-fixtures/` directory in the
repo. We should either repurpose that directory into `lib/graph-integration` or
remove it during the migration so we do not keep two partial fixture homes.

### Phase 3: Move shared integration fixtures

Move integration-only fixtures into `@io/graph-integration/src/fixtures`.

Initial candidates:

- `lib/graph-bootstrap/src/test-fixtures.ts`
- `lib/app/src/graph/test-graph.ts`
- the cross-package parts of `lib/app/src/graph/testing/kitchen-sink.ts`

Fixture split rules:

- keep fixtures that exist only to support cross-package test scenarios in
  `@io/graph-integration`
- keep demo/runtime fixtures in the package that ships them
- if one fixture currently serves both roles, split it into:
  - an integration fixture owned by `@io/graph-integration`
  - a smaller app-owned demo fixture for runtime examples

### Phase 4: Move cross-package graph suites

Move the graph integration suites that currently require multiple packages and
shared fixtures.

The first set should include:

- `lib/graph-authority/src/authority.test.ts`
- `lib/graph-client/src/bootstrap-integration.test.ts`
- `lib/graph-module-core/src/react-dom/index.test.tsx`
- `lib/graph-module-core/src/react-dom/field-registry.test.tsx`
- `lib/graph-react/src/entity.test.tsx`

The app-owned graph suites that behave like integration coverage should also be
reviewed for migration, especially tests under `lib/app/src/graph/` that stand
up bootstrap, client, authority, and sync together.

Likely move:

- `sync.test.ts`
- `runtime/http-client.test.ts`
- `validation-lifecycle.test.ts`
- `client-validation.test.ts`
- `client-enum.test.ts`
- `client-lifecycle.test.ts`
- `store-subscriptions.test.ts`
- `icon.test.ts`

Likely stay in `@io/app`:

- root export/barrel assertions
- root-only graph helper tests
- app-owned runtime/demo behavior

Examples:

- `lib/app/src/graph/index.test.ts` should stay app-local
- `lib/app/src/graph/definition-contracts.probe.ts` should stay with its owning
  package unless it becomes pure shared-contract coverage

### Phase 5: Keep package-local unit coverage local

Not every test should move.

Package-local tests should remain with their package when they can be expressed
without cross-package fixture imports.

Examples:

- package surface tests
- pure contract tests
- pure value-module tests
- local typecheck probes using minimal inline fixtures

Immediate cleanup targets:

- rewrite `lib/graph-react/src/index.test.ts` to stop depending on
  `@io/app/graph`
- rewrite `lib/graph-module-core/src/react-dom/filter.typecheck.ts` to use a
  local fixture or an integration-package fixture instead of `app/src/...`

### Phase 6: Add enforcement

Once the moves land, add a guardrail so the repo cannot regress.

Recommended checks:

- fail on `src/` imports that cross workspace package boundaries
- fail on undeclared `@io/*` dependencies
- optionally keep a small allowlist for intentional same-package relative
  imports only

This can live in lint, a repo script, or a dedicated `turbo check` step.

## Ownership Decision

We should treat fixture ownership as two separate concerns:

- `@io/graph-integration` owns fixtures used to validate package interaction
- `@io/app` owns runtime examples and product/demo data needed by shipped app
  surfaces

That split is important because `kitchenSink` currently does both jobs.

## Exit Criteria

The migration is complete when all of the following are true:

- `@io/graph-module-core` no longer imports `@io/app/graph`
- graph packages do not import other packages through `src/` paths
- cross-package graph integration suites run from `@io/graph-integration`
- package-local unit tests remain in their owning packages
- app demos do not depend on integration-only fixtures
- CI prevents new cross-package `src/` imports from being added

## Recommended Execution Order

1. Move `sanitizeSvgMarkup` down and break the runtime cycle.
2. Create `@io/graph-integration`.
3. Move shared fixtures into the new package.
4. Move the worst cross-package suites first.
5. Split app demo fixtures away from integration fixtures.
6. Add import-boundary enforcement.

This ordering keeps the refactor incremental while removing the most dangerous
cycle first.
