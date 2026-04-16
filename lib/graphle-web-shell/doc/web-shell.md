---
name: Graphle web shell
description: "Generic browser shell runtime, feature registration, and host status contracts owned by @dpeek/graphle-web-shell."
last_updated: 2026-04-15
---

# Graphle Web Shell

## Read This When

- you are changing browser feature registration
- you are changing shell frame, navigation, status, or command slots
- you need the boundary between the generic shell and a product browser app

## Current Contract

`@dpeek/graphle-web-shell` is a React library. It accepts feature contributions
from browser product packages and renders a shell frame with stable slots:
navigation, primary content, status, and commands.

Feature contributions can provide navigation items, page renderers, and command
metadata. The registry sorts contributions by explicit order first, then label,
then id so package composition stays deterministic.

## Host Status

The host context carries summaries for auth, graph, sync, deploy, and runtime
state. A summary has a label, a state, and optional detail text. The shell can
render those summaries, but it doesn't know how auth is implemented, where graph
state is stored, or how deploy works.

## Boundary

This package imports browser primitives from `@dpeek/graphle-web-ui`. It must
not import `@dpeek/graphle-local`, `@dpeek/graphle-module-site`,
`@dpeek/graphle-app`, Better Auth, SQLite adapters, or deploy packages.
