---
name: Graphle web UI primitives
description: "Browser primitive ownership, exports, and package boundary for @dpeek/graphle-web-ui."
last_updated: 2026-04-15
---

# Graphle Web UI Primitives

## Read This When

- you are changing shared browser controls or layout primitives
- you need a browser-safe component that doesn't know about graph runtime state
- you are deciding whether code belongs in the UI kit, shell, or a product app

## Current Contract

`@dpeek/graphle-web-ui` is the canonical package for reusable browser
presentation primitives. It owns controls, layout helpers, markdown rendering,
theme CSS, and small browser utility hooks.

The package exports source-level component subpaths such as
`@dpeek/graphle-web-ui/button`, `@dpeek/graphle-web-ui/badge`, and
`@dpeek/graphle-web-ui/markdown`. The root export re-exports the same primitive
surface for packages that prefer a single import.

## Boundary

This package must stay browser-only and runtime-agnostic. It must not import the
local server, graph authority runtime, `site:` schema package, deploy packages,
`@dpeek/graphle-web-shell`, or `@dpeek/graphle-app`.
