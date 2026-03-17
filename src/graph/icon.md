# Graph Icons

## Purpose

Icons are graph-owned entities. SVG is graph-owned scalar data. The explorer should treat both through the normal typed entity/predicate surface rather than a bespoke icon workflow.

## Current Shape

- `core:icon` is an ordinary entity type.
- `core:svg` is a scalar type for sanitized SVG markup.
- Types opt into icons explicitly through `iconReferenceField(...)`.
- Type and predicate definitions can declare an optional icon seed directly on the authored
  definition.
- Bootstrap seeds canonical icons from `res/icon/*.svg`.
- Missing icons are inferred before falling back to `unknown.svg`:
  enum types default to `tag.svg`, and predicates whose range is another entity type default to
  `edge.svg`.
- Rendering happens through shared DOM helpers such as `GraphIcon` and `SvgMarkup`.

## Data Model

### `core:svg`

`core:svg` is the authored scalar for icon markup:

- encoded and stored as a string
- validated with the shared SVG sanitizer
- rendered through a dedicated `svg` display/editor kind

That keeps SVG-specific preview behavior out of bespoke screen code and inside the normal field resolver path.

### `core:icon`

`core:icon` keeps icon metadata as ordinary graph fields:

- `name`
- `label`
- `description`
- `createdAt`
- `updatedAt`
- `key`
- `svg`

The `svg` field uses `core:svg`, normalizes markup on create/update, and rejects unsafe or malformed input.

### Opt-in references

Icon assignment stays explicit:

- `core:type.icon`
- `core:predicate.icon`
- future app-owned types such as `topic.icon`

No global `icon` predicate is inherited from `core:node`.

### Seed Registry

`graphIconSeeds` is the canonical seed registry for definition-level icons:

- each seed owns a stable graph id, slug key, display name, and raw SVG payload
- the registry is sourced from `res/icon/*.svg`
- schema definitions can reference a seed object directly, similar to enum option references
- runtime bootstrap materializes the seed icon entities through the normal typed create lifecycle
  before linking type and predicate metadata

## Explorer Surface

Icons are edited through the existing `entities` section.

- `core:icon` appears as a normal entity type in the entity-type list
- icon entities reuse the generic entity inspector
- the `svg` predicate renders a shared source/preview editor
- icon reference fields still use the shared Base UI entity-reference combobox

`/graph/icons` can remain as a route alias, but it should land in the generic entity explorer rather than a dedicated icon panel.

## Preview Toggle Editing

Markdown and SVG now share the same explorer interaction pattern:

- source mode shows Monaco without line numbers when available and falls back to a textarea
- a single `Preview` toggle sits in the top-right overlay of the editor or preview panel
- enabling preview renders the typed content, and the same toggle returns to source mode
- source and preview panels share the same rounded-xl field surface and 16px inset so markdown and SVG stay visually aligned
- the field resolver owns the toggle rather than individual screens

For SVG preview:

- preview uses sanitized inline markup
- the shared DOM renderer injects root `<svg>` sizing classes so host button styles do not shrink icons, and allows a 1px overflow inset so stroked icons do not get clipped
- invalid draft markup surfaces sanitizer errors instead of rendering
- committed graph values stay normalized through the same validation path used by create/update

## Validation And Sanitization

SVG input is treated as untrusted markup.

Current rules include:

- exactly one root `<svg>`
- valid or derivable `viewBox`
- no scripts, event handlers, foreign content, or external references
- allowlist-only tags and attributes
- normalization that strips fixed `width` / `height` from the root `<svg>` while preserving child shape geometry

The same sanitizer is reused by:

- field validation
- create/update normalization
- preview rendering
- icon rendering

## Current Coverage

- schema/runtime coverage for `core:icon`, `core:svg`, create/update validation, and delete safety
- generic field resolver coverage for markdown and SVG source/preview editing
- explorer coverage for icon assignment and icon-entity editing through the normal entity pane

## Deferred

- generic entity creation in the explorer
- generic entity deletion in the explorer
- richer icon catalog workflows such as tagging or bulk import
