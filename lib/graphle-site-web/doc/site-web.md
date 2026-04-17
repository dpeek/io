---
name: Graphle site web
description: "Assembled personal-site browser app, feature registration, and package-owned client assets for @dpeek/graphle-site-web."
last_updated: 2026-04-17
---

# Graphle Site Web

## Read This When

- you are changing the browser app served by `graphle dev`
- you are changing the site feature registration mounted in the generic shell
- you are changing the browser-safe graph client assembly for the local site
  graph
- you are changing package-built client assets, route loading, or inline
  authoring controls

## Current Contract

`@dpeek/graphle-site-web` builds the browser app that `@dpeek/graphle-local`
serves from package assets. The product path renders a site-owned frame, not
the generic Graphle shell chrome. It uses `@dpeek/graphle-web-ui` sidebar,
dropdown, dialog, form, tooltip, button, and markdown primitives plus
browser-safe item helpers from `@dpeek/graphle-module-site`.
Markdown typography comes from `@dpeek/graphle-web-ui`'s shared
Tailwind Typography-backed renderer; site-web only adds route-level layout
constraints.

The package also exports a browser-safe graph client seam:

- `graphleSiteGraphNamespace`
- `graphleSiteGraphDefinitions`
- `graphleSiteGraphBootstrapOptions`
- `createGraphleSiteHttpGraphClient(...)`

That seam assembles `site:item`, `core:tag`, `core:color`, and the minimal core
definitions needed by the local site graph, then wires them to
`@dpeek/graphle-client`'s standard `/api/sync` and `/api/tx` transport. It is
available for the generic authoring migration, but the visible Phase 4 UI is
not mounted on it yet.

The first screen is the current website route preview. The app loads:

- `GET /api/health`
- `GET /api/session`
- `GET /api/site/route?path=<current-path>`

Those payloads drive the public route content, the flat item sidebar, and local
admin visibility. When `/api/session` reports an authenticated local admin
session, the app also loads:

- `GET /api/site/items`

The first screen is the website preview with one left sidebar and centered
route content. Sidebar rows show only item icon and item title. Path-backed
items navigate to exact local routes with `history.pushState`; URL-only items
open their external URL in a new tab and do not create public permalinks.
`popstate` reloads the route through `/api/site/route?path=<path>`.

Authenticated sessions can edit either the current route item or a URL-only
item selected from the sidebar action menu. Edit mode keeps the same content
layout and swaps predicate display rows for predicate-backed draft controls
planned from `site:item` field metadata and `@dpeek/graphle-react` draft
primitives. Visible field labels are hidden, while controls keep accessible
names. There are no creation presets; the single `+` action calls the blank
create intent and enters edit mode on the returned private routed item.

Authenticated sessions can delete items through the sidebar action menu after a
confirmation dialog. Drag-and-drop ordering uses `@dnd-kit/sortable` and writes
normalized consecutive `site:item.sortOrder` values through one batch endpoint.

The local theme helper reads and writes `localStorage.graphle.theme`, supports
`light`, `dark`, and `system`, applies `light`/`dark` classes to
`document.documentElement`, and updates when the system preference changes. The
visible control is one icon-only sidebar button with a tooltip and accessible
label.

Current visible mutation helpers call only the local `/api/site/*` endpoints:

- `POST /api/site/items`
- `PATCH /api/site/items/:id`
- `DELETE /api/site/items/:id`
- `PATCH /api/site/items/order`

Visibility, tags, pins, sort order, URL, path, excerpt, and markdown body are
represented as item fields in the same payloads. These DTO helpers are
transitional; future site authoring should use the exported generic graph
client seam instead of adding new `/api/site/*` content routes.

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
