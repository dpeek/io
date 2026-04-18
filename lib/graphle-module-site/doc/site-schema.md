---
name: Graph module site schema
description: "Personal-site MVP site namespace ownership for @dpeek/graphle-module-site."
last_updated: 2026-04-17
---

# Graph Module Site Schema

## Read This When

- you are changing the `site:` graph schema
- you are changing first-run item seed expectations
- you need the boundary between site definitions and local runtime persistence

## Current Contract

`@dpeek/graphle-module-site` publishes the minimal website content schema used by
the personal-site MVP:

- `site:path`: scalar for absolute site paths such as `/`, `/about`, and
  `/work/example`
- `site:visibility`: enum with `private` and `public`
- `site:icon`: named icon presets for common personal-site links
- `site:item`: title, optional path, optional absolute URL, optional markdown
  body, visibility, optional icon preset, `core:tag` references, optional sort
  order, created-at timestamp, and updated-at timestamp

The package exports the resolved `site` namespace, `siteItemSurface`,
`siteItemViewSurface`, and `siteManifest`. `siteItemSurface` is the authored
`RecordSurfaceSpec` for shared browser editing surfaces: icon/title/body/url/tags
content fields, path/visibility route fields, and created/updated metadata
fields. `siteItemViewSurface` is the authored read surface for route display:
title heading, created date, tags, and markdown body. The read surface keeps the
site-local `createdAt` display format at `Month DD, YYYY` in UTC, for example
`November 01, 2023`.
`site:item.sortOrder` stays in the schema for sidebar drag-and-drop ordering,
but it is intentionally not exposed in the item editor surface. The manifest
publishes both surfaces through `runtime.recordSurfaces` beside the schema
contribution.

Stable ids live in `../src/site.json`; package-local tests fail when authored
schema keys drift without an intentional id-map update.

The package also exports browser-safe helpers used by the local runtime and
site browser app:

- `parseSitePath`: validates exact public page paths
- `parseSiteAbsoluteUrl`: validates absolute URLs for item links
- `parseSiteVisibility`: accepts only `private` or `public`
- `parseSiteIconPreset`: accepts only the named icon preset set
- `parseSitePublicRoute`: validates exact item route paths
- `siteVisibilityIdFor` and `siteVisibilityForId`: translate between
  visibility keys and resolved graph enum ids
- `siteIconPresetIdFor` and `siteIconPresetForId`: translate between icon
  preset keys and resolved graph enum ids
- `siteItemMatchesSearch` and `compareSiteItems`: implement the flat sidebar
  search and deterministic item ordering rules

`compareSiteItems` treats explicit manual order as the strongest product
ordering signal: items with `site:item.sortOrder` sort before unordered items
by ascending value. Items without `sortOrder` continue to use the deterministic
fallback order: newer `createdAt`, newer `updatedAt`, then title.

## Minimal Core Dependency

The site module references `core:tag` for item tags. Local site boot widens the
minimal core slice with `core:tag` and the `core:color` scalar required by tag
records. It still avoids saved-query/view, workflow, identity, admission,
share, capability, and installed-module records.

## Boundary

This package defines schema, validation helpers, and route-read contracts only.
It does not open `graphle.sqlite`, seed default content, serve HTTP, render
markdown, own browser UI, deploy to Cloudflare, or sync local and remote graphs.
