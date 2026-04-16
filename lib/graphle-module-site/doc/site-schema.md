---
name: Graph module site schema
description: "Personal-site MVP site namespace ownership for @dpeek/graphle-module-site."
last_updated: 2026-04-15
---

# Graph Module Site Schema

## Read This When

- you are changing the `site:` graph schema
- you are changing first-run page or post seed expectations
- you need the boundary between site definitions and local runtime persistence

## Current Contract

`@dpeek/graphle-module-site` publishes the minimal website content schema used by
the personal-site MVP:

- `site:path`: scalar for absolute site paths such as `/`, `/about`, and
  `/work/example`
- `site:status`: enum with `draft` and `published`
- `site:page`: title, path, markdown body, status, and updated-at timestamp
- `site:post`: title, slug, markdown body, excerpt, optional published-at
  timestamp, status, and updated-at timestamp

The package exports the resolved `site` namespace and `siteManifest`. Stable ids
live in `../src/site.json`; package-local tests fail when authored schema keys
drift without an intentional id-map update.

The package also exports browser-safe helpers used by the local runtime and
site browser app:

- `parseSitePath`: validates exact public page paths
- `parseSiteSlug`: normalizes and validates post slugs
- `parseSitePublicationStatus`: accepts only `draft` or `published`
- `parseSitePublicRoute`: maps `/posts/:slug` to post routes and all other
  valid public paths to page routes
- `siteStatusIdFor` and `siteStatusForId`: translate between public status keys
  and resolved graph enum ids

## Minimal Core Dependency

The site module is booted with `minimalCore` from `@dpeek/graphle-module-core`.
That path includes only the core schema anchors and scalar contracts needed to
materialize typed records for this MVP. It intentionally avoids icon, SVG,
saved-query/view, workflow, identity, admission, share, capability, and
installed-module records.

## Boundary

This package defines schema, validation helpers, and route-read contracts only.
It does not open `graphle.sqlite`, seed default content, serve HTTP, render
markdown, own browser UI, deploy to Cloudflare, or sync local and remote graphs.
