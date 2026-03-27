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
