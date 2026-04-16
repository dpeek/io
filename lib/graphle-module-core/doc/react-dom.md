---
name: Graph module core react-dom
description: "The react-dom subpath, browser field resolver defaults, and query-editor authoring support in @dpeek/graphle-module-core."
last_updated: 2026-04-08
---

# Graph module core react-dom

## Read this when

- you are changing the default browser field or filter layer
- you need to understand `createWebFieldResolver(...)`
- you are debugging the shipped query-editor authoring model or SVG or icon
  rendering

## Main source anchors

- `../src/react-dom/index.ts`: subpath export surface
- `../src/react-dom/resolver.tsx`: browser field resolver and wrapper
  components
- `../src/react-dom/field-registry.tsx`: built-in view, control, and field-row
  capabilities
- `../src/react-dom/query-editor.ts`: query-editor draft model, hydration,
  validation, and serialization
- `../src/react-dom/query-editor-catalog.ts`: installed-surface registry to
  query-editor catalog mapping
- `../src/react-dom/query-editor-value-semantics.ts`: supported field kinds and
  value coercion rules
- `../src/react-dom/icon.tsx`: `GraphIcon` and `SvgMarkup`
- `./icons-and-svg.md`: graph-wide icon and SVG contract plus the built-in
  core-owned icon layer

## What this layer owns

- the canonical browser-default field, filter, icon, and query-editor layer
  for the built-in graph stack
- the `react-dom` subpath exports used by app or web consumers
- the built-in mapping from installed query surfaces to the first query-editor
  authoring model

It does not own the host-neutral resolver contracts in `@dpeek/graphle-react`, nor
does it own app route composition.

## Field resolver model

`createWebFieldResolver(...)` layers DOM capabilities over the host-neutral
`@dpeek/graphle-react` resolver.

The browser layer explicitly distinguishes three render modes:

- `view`: read-only value presentation
- `control`: dense editor-only rendering
- `field`: labeled field-row rendering with shared chrome

Important rules:

- `editor` remains a compatibility alias for `control`
- if callers only provide `control` capabilities, the browser layer derives
  default `field` wrappers automatically
- `PredicateFieldControl` and `PredicateField` accept shared `controller` and
  `issues` props so validation state can flow through one editor path

## Shared form composition

Authored browser forms and field rows should compose through `@dpeek/graphle-web-ui` instead
of bespoke labels, selects, and validation blocks.

Preferred pattern:

- wrap authored controls in `Field`
- use `FieldLabel`, `FieldContent`, `FieldDescription`, and `FieldError` for
  field chrome
- set `data-invalid` on `Field` and `aria-invalid` on the concrete control
- use `NativeSelect` for simple HTML select behavior and `Select` only when the
  richer popup behavior is required
- use `Alert` for form-level or section-level feedback and `Empty` for empty
  states instead of ad hoc bordered boxes
- render checkbox and boolean rows with `Field orientation="horizontal"` or
  `orientation="responsive"`, with the control first and the label/content to
  its right

## Built-in browser capabilities

The shipped built-in view capabilities include:

- boolean
- color
- text
- markdown
- svg
- date
- number
- percent
- link
- external-link
- badge
- duration
- quantity
- range
- rate
- money
- entity-reference list views

The shipped control capabilities include the generic base editors plus:

- `number/duration`
- `number/quantity`
- `number/range`
- `number/rate`
- `money/amount`
- `entity-reference-combobox`

The shipped field-row capabilities override a few common kinds directly:

- checkbox
- text
- textarea
- select
- entity-reference-combobox

Everything else is wrapped through the default field-row chrome derived from
the control registry.

## Query-editor ownership

This subpath owns the first shared browser query-authoring model.

It provides:

- query-editor draft types
- hydration from serialized queries
- draft validation
- serialization back to `SerializedQueryRequest`
- the installed-surface catalog adapter
- the `QueryEditor` component

`createQueryEditorCatalogFromRegistry(...)` lowers installed module surfaces
into the smaller browser authoring catalog used by the current query editor.

## Supported field kinds

The first shipped query-authoring surface supports the scalar-style field
families:

- enum
- entity-ref
- date
- boolean
- text
- number
- url
- email
- color
- percent
- duration
- money
- quantity
- range
- rate

List-valued field kinds such as `enum-list`, `entity-ref-list`, and the other
`*-list` families are intentionally excluded from the first `/query` authoring
surface. The code reports those exclusions explicitly instead of pretending that
membership filters are scalar comparisons.

## Boundary rules

- Keep host-neutral resolver contracts in `@dpeek/graphle-react`.
- Keep durable query data and installed-surface ownership in the module or
  runtime packages that own them.
- Keep the package root React-free; browser defaults belong only on the
  `react-dom` subpath.

## Practical rules

- Extend `field-registry.tsx` when changing the shipped browser-default field
  capabilities.
- Extend `query-editor-value-semantics.ts` when a new query-surface field kind
  needs browser authoring support.
- Reuse `SvgMarkup` and the shared sanitizer-backed icon path instead of
  inventing per-screen SVG rendering.
