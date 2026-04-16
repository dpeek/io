---
name: Graphle site web
description: "Assembled personal-site browser app, feature registration, and package-owned client assets for @dpeek/graphle-site-web."
last_updated: 2026-04-15
---

# Graphle Site Web

## Read This When

- you are changing the browser app served by `graphle dev`
- you are changing the site feature registration mounted in the generic shell
- you are changing package-built client assets, route loading, or inline
  authoring controls

## Current Contract

`@dpeek/graphle-site-web` builds the browser app that `@dpeek/graphle-local`
serves from package assets. The package imports `@dpeek/graphle-web-shell` for
generic shell composition and `@dpeek/graphle-web-ui` for browser primitives.

The first screen is the current website route preview. The app loads:

- `GET /api/health`
- `GET /api/session`
- `GET /api/site/route?path=<current-path>`

Those payloads drive shell status badges, the public preview, and local admin
visibility. When `/api/session` reports an authenticated local admin session,
the app also loads:

- `GET /api/site/pages`
- `GET /api/site/posts`

Authenticated sessions see inline page and post controls on the same public
route. Editors use browser-safe primitives from `@dpeek/graphle-web-ui`: inputs,
textareas, buttons, badges, and markdown rendering. Page and post lists live in
the inline authoring panel; there is no `/admin`, `/authoring`, or other
product route namespace.

Mutation helpers call only the local `/api/site/*` endpoints:

- `POST /api/site/pages`
- `PATCH /api/site/pages/:id`
- `POST /api/site/posts`
- `PATCH /api/site/posts/:id`

Publish and unpublish commands are represented as `status` changes in the same
patch payloads. `@dpeek/graphle-site-web` does not mutate graph state directly.

## Built Assets

`bun run build` emits server-side package modules under `out/` and browser
assets under `out/client/`. The local runtime imports the asset directory from
`@dpeek/graphle-site-web/assets` and serves those files directly. The default
`graphle dev` command doesn't run Vite in the user's current working directory.

## Boundary

This package may present site feature metadata, but it doesn't own the `site:`
schema. Schema stays in `@dpeek/graphle-module-site`; local route handling stays
in `@dpeek/graphle-local`.

The browser app does not import `@dpeek/graphle-app`, Better Auth providers,
query/workflow surfaces, deploy wiring, or user-project source files.
