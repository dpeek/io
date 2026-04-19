Status: Implemented
Last Updated: 2026-04-19

# 05: Monaco deletion and SVG fallback

## Must Read

- `./spec.md`
- `./04-editor-field-integration.md`
- `../../AGENTS.md`
- `../../lib/graphle-web-ui/package.json`
- `../../lib/graphle-web-ui/src/monaco.tsx`
- `../../lib/graphle-web-ui/src/monaco.test.tsx`
- `../../lib/graphle-web-ui/src/source-preview.tsx`
- `../../lib/graphle-web-ui/src/source-preview.test.tsx`
- `../../lib/graphle-web-ui/src/index.ts`
- `../../lib/graphle-module-core/src/react-dom/fields/svg.tsx`
- `../../lib/graphle-module-core/src/react-dom/resolver.test.tsx`
- `../../lib/graphle-web-ui/README.md`
- `../../lib/graphle-web-ui/doc/browser-primitives.md`

## Goal

Remove Monaco from `@dpeek/graphle-web-ui` completely while preserving usable
SVG source editing through a plain source editor.

After this task, the package should have no Monaco imports, exports, or
dependencies.

## Scope

Touch:

- `lib/graphle-web-ui/src/source-preview.tsx`
- `lib/graphle-web-ui/src/source-preview.test.tsx`
- `lib/graphle-web-ui/src/index.ts`
- `lib/graphle-web-ui/package.json`
- `lib/graphle-web-ui/README.md`
- `lib/graphle-web-ui/doc/browser-primitives.md`
- `lib/graphle-module-core/src/react-dom/fields/svg.tsx`
- related tests that assert Monaco source attributes
- `bun.lock`

Delete:

- `lib/graphle-web-ui/src/monaco.tsx`
- `lib/graphle-web-ui/src/monaco.test.tsx`

## Tasks

- Add a reusable textarea-backed source editor to `source-preview.tsx`.
  Suggested API:
  - `value: string`
  - `onChange?(nextValue: string): void`
  - `placeholder?: string`
  - `sourceKind: string`
  - `readOnly?: boolean`
  - optional `aria-invalid`
- Reuse the existing `sourcePreviewTextareaClassName`.
- Preserve stable data attributes such as `data-web-svg-source="textarea"` for
  SVG tests and debugging.
- Replace `SvgFieldEditor`'s `MonacoSourceEditor` usage with the new source
  editor.
- Delete `monaco.tsx` and `monaco.test.tsx`.
- Remove `./monaco` from `lib/graphle-web-ui/package.json` exports.
- Remove `@monaco-editor/react` and `monaco-editor` dependencies.
- Remove any root re-exports that referenced Monaco.
- Update tests to assert the new source editor behavior.
- Update web-ui docs and README to describe:
  - Plate markdown editing
  - plain source editing for SVG
  - no Monaco dependency
- Search the repo for stale imports:
  - `MonacoSourceEditor`
  - `sourcePreviewMonacoOptions`
  - `@dpeek/graphle-web-ui/monaco`
  - `@monaco-editor/react`
  - `monaco-editor`

## Rules

- Do not replace SVG editing with Plate.
- Do not add CodeMirror or another code editor.
- Do not change SVG preview behavior.
- Keep source editor styling in `source-preview.tsx` and existing source-preview
  CSS utilities.
- Backwards compatibility for `@dpeek/graphle-web-ui/monaco` is not required.

## Verification

- Run `turbo check --filter=@dpeek/graphle-web-ui`.
- Run `turbo check --filter=@dpeek/graphle-module-core`.
- Run full `turbo check` because lockfile and package exports changed.

## Success Criteria

- No Monaco imports remain in `lib/`.
- No Monaco package export remains.
- `@monaco-editor/react` and `monaco-editor` are gone from
  `@dpeek/graphle-web-ui`.
- SVG edit mode still renders a source editor and preview.
- Markdown edit mode remains Plate-backed.
- Tests pass.

## Non-Goals

- syntax highlighting for SVG source
- adding a general code editor abstraction
- changing markdown Plate behavior
