---
name: Graph sync cursors
description: "Cursor parsing, ordering helpers, and fallback classification in @io/graph-sync."
last_updated: 2026-04-02
---

# Graph sync cursors

## Read this when

- you are changing cursor helper behavior
- you need to classify why incremental replay can no longer continue
- you are writing source-owned code that already understands a cursor prefix plus sequence format

## Main source anchors

- `../src/cursor.ts`: cursor helpers
- `../src/cursor.test.ts`: expected parse, compare, and fallback behavior

## Opaque by default

Cursor strings are opaque to downstream callers. Persist them, compare them for equality, and pass them back to the source.

This file is for source-owned helpers and tests that already control the cursor format.

## Parsing and formatting

- `parseAuthoritativeGraphCursor()` is a best-effort parser for cursors that end in a numeric suffix
- `formatAuthoritativeGraphCursor()` builds one cursor from `cursorPrefix` plus numeric sequence

If a cursor does not end in digits, parse returns `null`.

## Ordering

- `isCursorAtOrAfter()` only compares cursors that share the same prefix
- Different prefixes are treated as unrelated sources

That is why cursor-prefix changes map to reset behavior instead of an ordinary numeric comparison.

## Fallback classification

`classifyIncrementalSyncFallbackReason()` returns:

- `unknown-cursor` when the cursor format is not parseable or otherwise cannot be satisfied incrementally
- `reset` when the cursor prefix no longer matches the current source prefix
- `gap` when the cursor sequence is older than the retained base sequence for that prefix

This helper is intentionally narrow. It does not infer module-scope-specific reasons like `scope-changed` or `policy-changed`; those come from higher-level scoped sync logic.

## Practical rules

- Keep cursor parsing source-owned and best-effort. Do not make downstream callers depend on the cursor string format.
- Treat prefix changes as hard reset boundaries.
- Use `gap` only when the prefix still matches and the sequence has fallen behind the retained replay window.
