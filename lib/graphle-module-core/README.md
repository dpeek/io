# Graph Module Core

`@dpeek/graphle-module-core` is the canonical workspace package for the built-in
`core:` namespace.

## Read This First

- Start with `./out/index.d.ts` for the compact public contract.
- Start with `./src/index.ts` for the package-root public entrypoint.
- Read `./src/core.ts` for the canonical `core:` namespace assembly.
- Read `./src/core/minimal.ts` for the minimal core slice used by the
  personal-site MVP boot path.
- Read `./src/query.ts` for the package-root core query-surface catalog and
  module read-scope exports.
- Read `./src/core/saved-query.ts` for durable saved-query and saved-view
  records.
- Read `./src/core/icon.ts`, `./src/icon/seed.ts`,
  `./src/icon/resolve.ts`, and `./src/core/svg-sanitization.ts` for icon and
  SVG ownership.
- Read `./src/react-dom/index.ts` for the browser-default subpath.

## Package Docs

These are the canonical agent docs for package-specific behavior in
`@dpeek/graphle-module-core`.

- [`./doc/core-namespace.md`](./doc/core-namespace.md): built-in `core:`
  namespace assembly, manifest ownership, and slice boundaries
- [`./doc/saved-queries-and-catalogs.md`](./doc/saved-queries-and-catalogs.md):
  durable saved-query or saved-view records plus the package-root core catalog
  and read-scope contract
- [`./doc/icons-and-svg.md`](./doc/icons-and-svg.md): `core:icon`,
  `core:svg`, icon seeds, fallback resolution, SVG sanitization, and bootstrap
  wiring
- [`./doc/structured-values.md`](./doc/structured-values.md): duration, money,
  percent, quantity, range, and rate families plus the shared structured-value
  helpers
- [`./doc/react-dom.md`](./doc/react-dom.md): the `react-dom` subpath,
  browser field resolver defaults, and query-editor authoring support

Cross-package architecture now lives in `../graph-module/doc/module-stack.md`,
`../graph-module/doc/type-modules.md`, and
`../graph-query/doc/query-stack.md`. Start here when the question is local to
this package. Jump to the root graph docs when the question crosses package,
runtime, or product boundaries.

## What It Owns

- the canonical `core` namespace assembly
- the `minimalCore` namespace and `minimalCoreGraphBootstrapOptions` for the
  local personal-site graph path
- the built-in `coreManifest` authored through the shared graph-module manifest
  contract
- built-in core scalar, enum, entity, dataset, and helper contracts
- `coreGraphBootstrapOptions`
- `minimalCoreGraphBootstrapOptions`
- colocated core icon seeds and shared icon-resolution helpers
- SVG sanitization for the built-in icon and SVG contracts
- structured-value parsing, normalization, and formatting helpers
- core-owned identity, admission, share, locale, country, and currency schema
- core-owned saved-query, saved-query-parameter, and saved-view schema plus
  typed durable-query helpers
- the package-root `coreQuerySurfaceCatalog`,
  `coreBuiltInQuerySurfaces`, `coreBuiltInQuerySurfaceIds`, and
  `coreCatalogModuleReadScope`, `coreCatalogModuleReadScopeRegistration`
  exports for the built-in core catalog scope and saved-query library surfaces
- core-specific browser defaults from `@dpeek/graphle-module-core/react-dom`

## Important Semantics

- `./src/core.ts` is the canonical `core:` namespace assembly. It applies the
  generated id map over the built-in core slice definitions and is the place to
  look when you need to know what currently ships in `core`.
- `minimalCore` is a deliberately smaller boot namespace for the personal-site
  MVP. It includes schema anchors and the scalar types needed for page/post
  records, but leaves icon, SVG, saved-query/view, workflow, identity, sharing,
  and app-owned records out of the default local graph.
- `coreManifest` publishes definition-time runtime contributions only:
  built-in schemas, the core query-surface catalog, and the core catalog
  module read scope. Install lifecycle and activation state remain
  authority-owned.
- Durable `core:savedQuery`, `core:savedQueryParameter`, and `core:savedView`
  records live here. Workflow and later modules may publish surfaces that those
  durable saved queries bind to, but they do not take ownership of the durable
  graph records themselves.
- `core:icon` and `core:svg` are package-owned graph contracts. Bootstrap
  consumes this package's icon seeds and default resolvers; it does not invent
  a separate icon catalog.
- The structured-value families in this package are semantic value contracts,
  not formatting hints. If a field loses meaning without its unit, currency, or
  bounds, it likely belongs on one of these types instead of plain `number` or
  `string`.
- The package root stays React-free. Browser defaults, DOM rendering, and the
  shipped query-editor authoring model live on the
  `@dpeek/graphle-module-core/react-dom` subpath.

## What It Depends On

- `@dpeek/graphle-module` for schema authoring helpers
- `@dpeek/graphle-kernel` for id reconciliation and low-level schema contracts
- `@dpeek/graphle-bootstrap` for bootstrap-facing option contracts

## What It Does Not Own

- generic type-module authoring helpers from `@dpeek/graphle-module`
- host-neutral React runtime contracts from `@dpeek/graphle-react`
- the extracted `workflow:` module tree in `@dpeek/graphle-module-workflow`
- module installation, activation, or runtime registry logic

## Query Ownership

- `core:savedQuery`, `core:savedQueryParameter`, and `core:savedView` are the
  durable graph-owned product objects for saved-query and saved-view state
- `coreQuerySurfaceCatalog` and the related `coreBuiltInQuerySurface*` exports
  are module-authored metadata published from the package root
- the initial reusable core query surfaces stay in core because they expose
  core-owned product objects and shared module metadata rather than
  workflow-local projections
- saved queries store module, catalog, and surface ids plus versions so they
  can bind to the core catalog or to workflow-local surfaces from
  `@dpeek/graphle-module-workflow`

Callers import the core catalog through the package root:

```ts
import { coreManifest, coreQuerySurfaceCatalog } from "@dpeek/graphle-module-core";
```

The same package root also publishes the current shared Branch 3 registration
for that scope:

```ts
import { coreCatalogModuleReadScopeRegistration } from "@dpeek/graphle-module-core";
```

## Browser Defaults

The `@dpeek/graphle-module-core/react-dom` subpath is the canonical home for the
current default DOM/browser implementation, including:

- `GraphIcon`
- `SvgMarkup` and `SvgPreview`
- the default field and filter resolver bundles
- generic browser field views, editors, and filter operand editors used by the
  current graph UI
- the shared browser query-editor draft model, installed-surface catalog
  adapter, and form-first `QueryEditor` component used by app/web consumers
- core structured-value editors and helpers
- tag-aware entity-reference create-and-attach behavior
- the default built-in browser behavior for the current `core:` module

This subpath replaces the former `@dpeek/graphle-react-dom` package and the retired
root `@dpeek/graphle-app/graph/adapters/react-dom` compatibility surface.

The package root stays React-free. Callers that need the browser layer import
the `react-dom` subpath directly.

Cross-package integration suites for this package live in
`@dpeek/graphle-integration` so package-local tests can stay boundary-safe.

## Field Renderer Boundary

The browser field surface at `@dpeek/graphle-module-core/react-dom` is intentionally
split across three render modes:

- `PredicateFieldView`: resolves `view` mode for read-only record and cell
  presentation
- `PredicateFieldControl`: resolves `control` mode for dense inline editors
- `PredicateField`: resolves `field` mode for the labeled row with shared
  description and error chrome

`PredicateFieldEditor` remains as a compatibility alias for
`PredicateFieldControl`.

When callers build a custom resolver with `createWebFieldResolver(...)`, they
can supply all three capability sets explicitly. If they only supply
`control` capabilities, the browser layer derives default `field` wrappers so
existing editors can still render inside the shared row chrome.

`PredicateFieldControl` and `PredicateField` also accept optional
`controller` and `issues` props. That shared render state lets the same
built-in editor run against controller-backed drafts while filtering
validation issues by `controller.path`, so record, collection, and
command-surface work can reuse one browser field path instead of rebuilding
label and error plumbing per screen.

## Build Output

Run `turbo build --filter=@dpeek/graphle-module-core` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@dpeek/graphle-module-core` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.

The intended first-read contract artifact for agents is `./out/index.d.ts`.
