# Graph Module Core

`@io/graph-module-core` is the canonical workspace package for the built-in
`core:` namespace.

## What It Owns

- the canonical `core` namespace assembly
- built-in core scalar, enum, entity, dataset, and helper contracts
- `coreGraphBootstrapOptions`
- colocated core icon seeds and shared icon-resolution helpers
- SVG sanitization for the built-in icon and SVG contracts
- structured-value parsing, normalization, and formatting helpers
- core-owned identity, admission, share, locale, country, and currency schema
- core-owned saved-query, saved-query-parameter, and saved-view schema plus
  typed durable-query helpers
- the package-root `coreQuerySurfaceCatalog`,
  `coreBuiltInQuerySurfaces`, `coreBuiltInQuerySurfaceIds`, and
  `coreCatalogModuleReadScope` exports for the built-in core catalog scope and
  saved-query library surfaces
- core-specific browser defaults from `@io/graph-module-core/react-dom`

## What It Depends On

- `@io/graph-module` for schema authoring helpers
- `@io/graph-kernel` for id reconciliation and low-level schema contracts
- `@io/graph-bootstrap` for bootstrap-facing option contracts

## What It Does Not Own

- generic type-module authoring helpers from `@io/graph-module`
- host-neutral React runtime contracts from `@io/graph-react`
- the extracted `workflow:` module tree in `@io/graph-module-workflow`
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
  `@io/graph-module-workflow`

Callers import the core catalog through the package root:

```ts
import { coreQuerySurfaceCatalog } from "@io/graph-module-core";
```

## Browser Defaults

The `@io/graph-module-core/react-dom` subpath is the canonical home for the
current default DOM/browser implementation, including:

- `GraphIcon`
- `SvgMarkup` and `SvgPreview`
- the default field and filter resolver bundles
- generic browser field views, editors, and filter operand editors used by the
  current graph UI
- core structured-value editors and helpers
- tag-aware entity-reference create-and-attach behavior
- the default built-in browser behavior for the current `core:` module

This subpath replaces the former `@io/graph-react-dom` package and the retired
root `@io/app/graph/adapters/react-dom` compatibility surface.

The package root stays React-free. Callers that need the browser layer import
the `react-dom` subpath directly.

Cross-package integration suites for this package live in
`@io/graph-integration` so package-local tests can stay boundary-safe.

## Build Output

Run `turbo build --filter=@io/graph-module-core` from the repo root, or
`bun run build` in this package, to emit `./out`.
Run `turbo check --filter=@io/graph-module-core` from the repo root, or
`bun run check` in this package, to lint, format, type-check, and execute the
package-local Bun tests.
