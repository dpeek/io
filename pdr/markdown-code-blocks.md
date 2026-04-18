Status: Proposed
Last Updated: 2026-04-18

# Markdown code blocks

## Must Read

- `../lib/graphle-web-ui/src/markdown.tsx`
- `../lib/graphle-web-ui/src/markdown.test.tsx`
- `../lib/graphle-web-ui/src/global.css`
- `../lib/graphle-web-ui/src/button.tsx`
- `../lib/graphle-web-ui/src/tooltip.tsx`
- `../lib/graphle-web-ui/src/json.tsx`
- `../lib/graphle-web-ui/doc/browser-primitives.md`
- `../lib/graphle-module-core/src/react-dom/fields/markdown.tsx`
- `../lib/graphle-site-web/src/site-feature.tsx`
- <https://shiki.style/guide/install>
- <https://shiki.style/guide/bundles>
- <https://shiki.style/guide/best-performance>
- <https://shiki.style/guide/dual-themes>
- <https://github.com/remarkjs/react-markdown>
- <https://github.github.io/gfm/>
- <https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks>
- <https://bun.com/docs/runtime/markdown>
- <https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText>

## Goal

Make `MarkdownRenderer` render fenced code blocks with lazy-loaded Shiki syntax
highlighting, copy-to-clipboard controls, and useful filename/language labels.

The result should keep markdown rendering inside `@dpeek/graphle-web-ui`, so
product packages can keep using `MarkdownRenderer` without local code-block
styling or renderer forks.

The first shipped surface should:

- render fenced blocks with a compact header and stable code body
- lazy-load Shiki only when a code block needs highlighting
- keep unhighlighted code readable during SSR, hydration, and loading
- support copy-to-clipboard from the raw source text
- detect language from the fence language or from a filename/path convention
- show a filename when the fence provides one
- support light and dark themes without making consumers wire theme state
- keep inline code rendering unchanged

## Current State

`MarkdownRenderer` currently prefers `Bun.markdown.react(...)` when Bun's
markdown API is present and falls back to `react-markdown` otherwise.

That split is now more cost than value for code blocks:

- `react-markdown` exposes fenced code as `code` nodes with
  `className="language-..."`, and supports custom components and plugins.
- `Bun.markdown.react` exposes `pre({ language, children })`, but only the
  first info-string word. It does not preserve the rest of the fence metadata
  needed for `filename=...` or `title=...`.
- The two paths would produce different code-block behavior unless we build two
  metadata pipelines.

The renderer already applies `.graph-markdown prose max-w-none
dark:prose-invert`, and `global.css` maps Tailwind Typography variables to
Graphle design tokens. The code-block work should build on that contract rather
than overriding markdown styles in product packages.

## Approach

Use one `react-markdown` pipeline for the shared renderer and remove the
runtime `Bun.markdown.react` branch. Backwards compatibility is not a concern,
and a single path gives us consistent metadata handling in Bun, Vite, tests,
SSR, and browser hydration.

Add the markdown features that the Bun path currently provided or implied:

- `remark-gfm` for GitHub-style tables, task lists, strikethrough, and literal
  autolinks
- `rehype-slug` for heading IDs
- a small local remark/rehype bridge that preserves fenced code metadata on the
  rendered hast node

The metadata bridge should keep the raw values minimal and explicit:

- `data-language` from the mdast `code.lang`
- `data-meta` from the mdast `code.meta`
- optionally `data-code-block="true"` to make tests and CSS targeting stable

Render block code through a dedicated `MarkdownCodeBlock` component. Inline
`code` should stay as regular prose inline code.

Recommended component shape:

- `MarkdownRenderer` owns markdown parsing and passes custom `pre`/`code`
  components.
- `MarkdownCodeBlock` owns the block frame, header, labels, copy button, and
  fallback plain code rendering.
- `markdown-code-info.ts` owns info-string parsing and language/filename
  inference as pure functions.
- `markdown-shiki.ts` owns the dynamic Shiki import and returns highlighted
  HTML or a structured failure.

Lazy Shiki loading should use a dynamic import from the code-block component,
not a top-level Shiki import in `markdown.tsx`. The first paint should render a
plain `<pre><code>` body. After mount, a `useEffect` should load the Shiki
module for blocks with a supported language and replace the body with
highlighted markup.

Use Shiki's dual-theme output so the renderer does not need to subscribe to the
app theme:

- light theme: `github-light`
- dark theme: `github-dark`
- `defaultColor: false`

Then add scoped CSS under `.graph-markdown` so Shiki token colors read from
`--shiki-light` in normal mode and `--shiki-dark` in dark mode. The code frame,
header, and fallback colors should use Graphle CSS tokens such as
`--background`, `--foreground`, `--muted`, `--muted-foreground`, and `--border`.

For bundle size, start with Shiki's async shorthand or a small
`shiki/bundle/web` import inside the lazy module. If the resulting browser
bundle is too large, switch to Shiki core with the JavaScript regex engine and
an explicit language/theme list. The implementation should keep the lazy module
boundary either way so that optimization does not change the public renderer.

## Fence Conventions

GFM only standardizes fenced code blocks and the common language-first
convention. Filename/title metadata is a Graphle convention layered onto the
info string.

Support these forms:

````md
```tsx filename="lib/graphle-web-ui/src/markdown.tsx"
const value = 1;
```

```ts title="schema.ts"
export const schema = {};
```

```lib/graphle-web-ui/src/markdown.tsx
export function MarkdownRenderer() {}
```
````

Parsing rules:

- The first info-string token is the language when it looks like a language
  identifier.
- `filename=`, `file=`, `name=`, and `title=` all set the displayed filename.
- Quoted values may contain spaces. Unquoted values end at whitespace.
- If no explicit language is present and the first token looks like a path or
  filename, use it as the filename and infer language from its extension.
- If both language and filename exist, highlight by language and display the
  filename.
- If only language exists, display the normalized language label.
- If neither exists, render a copyable plain block with no language label.
- `text`, `plain`, `plaintext`, `txt`, and `nohighlight` should skip Shiki and
  render plain code.

Start with a compact alias/extension map:

- `js`, `mjs`, `cjs` -> `javascript`
- `jsx` -> `jsx`
- `ts`, `mts`, `cts` -> `typescript`
- `tsx` -> `tsx`
- `sh`, `shell`, `bash`, `zsh` -> `bash`
- `yml`, `yaml` -> `yaml`
- `md`, `mdx` -> `markdown` / `mdx`
- `json`, `jsonc` -> `json` / `jsonc`
- `html`, `css`, `scss` -> matching Shiki languages
- `diff`, `patch` -> `diff`
- `sql` -> `sql`

Unknown languages should not throw. They should render plain code and preserve
the visible label.

## Rules

- Keep markdown rendering owned by `@dpeek/graphle-web-ui`.
- Do not add product-app markdown overrides for this feature.
- Keep inline code unchanged.
- Do not call Shiki from hot render paths. Load it asynchronously and cache the
  imported highlighter/helper module.
- Do not create a highlighter per code block if the chosen Shiki API exposes a
  reusable highlighter or cached shorthand.
- Do not assume the Clipboard API always succeeds. The copy button should catch
  failures and avoid throwing into React.
- Keep the raw source text as the copied value, not highlighted HTML.
- Keep the SSR and no-JavaScript output usable as plain code.
- Keep code-block header controls out of prose typography with `not-prose`.
- Keep Graphle-specific styling scoped to `.graph-markdown`.
- Do not use `dangerouslySetInnerHTML` for untrusted markdown outside the Shiki
  output path. If Shiki output is injected as HTML, the input must still be
  source code only, and unknown languages must fall back to escaped plain text.

## Open Questions

- Should the copy button show a transient "Copied" state, or should it stay as
  an icon-only action with a tooltip?
- Should `title=` and `filename=` both display exactly as authored, or should
  path-like values be shortened to the basename on narrow screens?
- Should we reserve metadata syntax for future line numbers or line
  highlighting, even though those features are out of scope for the first pass?
- Should we use Shiki's HTML output for speed, or render Shiki tokens as React
  spans to avoid `dangerouslySetInnerHTML` entirely?

## Success Criteria

- `MarkdownRenderer` has one rendering path based on `react-markdown`.
- GFM tables, task lists, strikethrough, and literal autolinks render through
  the shared renderer.
- Heading IDs are still generated.
- Fenced code blocks render with stable Graphle-owned code-block chrome.
- Inline code remains normal prose inline code.
- Code blocks copy the exact raw source text to the clipboard.
- Shiki is not part of the initial markdown renderer module.
- Supported languages highlight after the lazy Shiki module loads.
- Unknown and `nohighlight` languages render as plain, copyable code without
  throwing.
- Filename/title metadata is parsed from supported info-string conventions.
- Filename/path-only fences infer language from file extension.
- Light and dark themes both render without consumer-side theme wiring.
- Tests cover the parser, SSR/plain render, GFM behavior, copy button presence,
  lazy-highlight success, and unknown-language fallback.
- `lib/graphle-web-ui/doc/browser-primitives.md` documents the renderer's
  code-block ownership and consumer boundary.
- `turbo check` passes.

## Tasks

- Add the direct dependencies needed by `@dpeek/graphle-web-ui`:
  - `shiki`
  - `remark-gfm`
  - `rehype-slug`
  - any small unified/mdast visitor utility imported directly by the local
    metadata bridge
- Replace the Bun/react split in `lib/graphle-web-ui/src/markdown.tsx` with one
  `react-markdown` pipeline using GFM, slugging, the metadata bridge, and custom
  code-block components.
- Add pure info-string parsing and language inference helpers under
  `lib/graphle-web-ui/src/`, with direct unit coverage for quoted metadata,
  aliases, extensions, path-only fences, and no-highlight aliases.
- Add a lazy Shiki helper module under `lib/graphle-web-ui/src/` that caches the
  imported Shiki API/highlighter and returns either highlighted HTML or a plain
  fallback signal.
- Add the `MarkdownCodeBlock` UI:
  - stable header row
  - filename or language label
  - icon-only copy button with tooltip
  - plain-code fallback while Shiki loads
  - safe fallback for clipboard errors and unsupported languages
- Add scoped `.graph-markdown` CSS for:
  - code-block frame and header
  - scrollable code body
  - Shiki dual-theme variables
  - reduced prose interference via `not-prose`
- Update `lib/graphle-web-ui/src/markdown.test.tsx` and add focused parser
  tests.
- Update downstream tests only where they assert the old
  `data-web-markdown-renderer="bun"` behavior.
- Update `lib/graphle-web-ui/doc/browser-primitives.md` to document the new
  renderer contract.
- Run `turbo check` and fix all issues.

## Non-Goals

- supporting Mermaid, GeoJSON, TopoJSON, or other executable/rendered diagram
  blocks
- adding line numbers, line highlighting, diff decorations, or collapsed blocks
  in the first pass
- building a full Linguist-compatible language detector
- changing markdown editor behavior in `MarkdownFieldEditor`
- adding product-package markdown styling overrides
- preserving the Bun markdown rendering branch
