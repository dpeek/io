---
name: Graphle Cloudflare public rendering
description: "Cloudflare Worker public-site rendering, public graph baseline storage, and publish handoff for @dpeek/graphle-deploy-cloudflare."
last_updated: 2026-04-18
---

# Cloudflare Public Rendering

## Read This When

- you are changing the deployed personal-site Worker runtime
- you are changing public baseline replacement or validation
- you are changing Cloudflare cache behavior for public HTML
- you are changing Cloudflare provisioning, Worker upload metadata, or deploy
  input validation
- you are wiring deploy or sync publishing into the remote runtime

## Current Contract

The Cloudflare runtime is a public-site renderer, not a hosted copy of the
Graphle app. It imports the site module and shared site renderer, but it does
not import `@dpeek/graphle-app`, Better Auth, workflow, saved-query,
installed-module, local admin auth, or app shell routes.

The Worker delegates public rendering to one Durable Object instance named
`public-site-baseline`. That object stores the current
`PublicSiteGraphBaseline` under one storage key. The baseline must match the
installed `siteItemPublicProjectionSpec.projectionId` and `definitionHash`
before it is accepted or rendered. Replacement also rejects private
`site:item` records and unreferenced or private-only `core:tag` records, so a
deploy bug cannot turn a compatible-but-unsanitized snapshot into public HTML.
Missing or incompatible baselines are recoverable by replacing the remote
baseline from the projected public graph; the runtime does not reinterpret older
projection definitions.

The remote API surface is intentionally narrow:

- `GET /api/health` returns no-store JSON with baseline status.
- `PUT /api/baseline` and `POST /api/baseline` replace the baseline when the
  request presents the configured deploy secret.
- unknown `/api/*` paths return no-store JSON 404s.
- non-API `GET` and `HEAD` requests server-render public routes.

The baseline replacement secret is supplied by the Worker environment as
`GRAPHLE_DEPLOY_SECRET`. A replacement request may send the secret as
`Authorization: Bearer <secret>` or `x-graphle-deploy-secret: <secret>`. If the
secret is not configured, baseline replacement is unavailable.

## Cloudflare Deploy Contract

The package owns the Cloudflare API boundary for Phase 5. Local callers pass a
project ID, account ID, API token, optional Worker name, and a projected
`PublicSiteGraphBaseline`; this package validates the inputs, derives the
default Worker name as `graphle-<project-slug>-<hash>`, builds the public Worker
bundle from the existing runtime, and uploads it through Cloudflare's multipart
Worker module API. Upload metadata declares:

- `main_module` for module Worker syntax
- `PUBLIC_SITE_BASELINE` as a Durable Object namespace binding
- `GraphlePublicSiteBaselineDurableObject` as the Durable Object class
- a one-run `GRAPHLE_DEPLOY_SECRET` secret binding
- a first-deploy Durable Object SQLite migration tag

The deployment path uploads the packaged `@dpeek/graphle-site-web` client asset
files when the local runtime provides an asset root, binds them as `ASSETS`,
sets `GRAPHLE_PUBLIC_SITE_STYLES` from the Vite manifest CSS entry, enables the
Worker on `workers.dev`, reads the account subdomain, publishes the baseline
through `publishPublicSiteBaseline(...)`, and verifies that `/api/health`, `/`,
and any existing URL-only public item render from the remote Worker URL. The
remote public Worker intentionally injects stylesheet tags only; the current
site-web JavaScript entry is the local authoring shell, not a public hydration
entry.

`publishPublicSiteBaseline(...)` uses bounded retries around baseline
replacement, health, and home verification because `workers.dev` can briefly
serve the previous Worker after a successful upload. Replacement retries include
400 and 401 responses so previous-version baseline validation or deploy secret
mismatch can recover once the new Worker version reaches the subdomain. The
default retry window is deliberately over a minute because Cloudflare can report
a successful upload before every `workers.dev` edge has the new validation code
and deploy secret. Final failures include the upstream HTTP status and a
trimmed, secret-redacted response body.

Cloudflare API tokens are only process inputs. They are never returned in
status payloads, logged, stored as graph facts, or persisted in deploy metadata.
Cloudflare and publish failures are normalized to sanitized errors with a code,
message, optional upstream status, and retryability flag.

The graph-backed metadata schema in this package stores only nonsecret remote
state: account ID, Worker name, Worker URL, Durable Object binding/class,
source cursor, baseline hash, deploy time, status, and sanitized error summary.

Public route rendering uses this flow:

```text
request path
  -> Durable Object reads PublicSiteGraphBaseline
  -> createGraphlePublicSiteRuntimeFromBaseline(...)
  -> resolve exact site:item.path
  -> renderPublicSiteRoute(...)
  -> full HTML document
```

`renderPublicSiteRoute(...)` comes from
`@dpeek/graphle-site-web/public-runtime`, so local and cloud rendering share
route resolution, sidebar item ordering, URL-only item display, missing-route
behavior, and static public item rendering without bundling Node-only local
asset helpers or browser authoring controls into the Worker.

## Cache Policy

The first runtime uses path purge rather than a custom Cloudflare cache key.
`definitionHash` remains compatibility metadata and is not used as freshness
state.

- public route HTML: `public, s-maxage=300, max-age=0, must-revalidate`
- missing public routes: `public, s-maxage=60, max-age=0, must-revalidate`
- static assets served through an `ASSETS` binding: `public, max-age=31536000,
immutable`
- all `/api/*` responses: `no-store`
- missing or incompatible baseline responses: `no-store`

Rendered HTML includes the public baseline hash in a response header and a meta
tag. Deploy attaches packaged site CSS by uploading `/assets/*` files through
Cloudflare's static asset upload flow, binding them as `ASSETS`, and passing a
JSON-array of stylesheet paths through `GRAPHLE_PUBLIC_SITE_STYLES`; the Worker
will include those stylesheet tags and serve matching `/assets/*` responses
through the `ASSETS` binding when the request reaches Worker code. Deploy and
later sync publishers should still purge known public paths after baseline
replacement for the MVP.

## Publish Handoff

`publishPublicSiteBaseline(...)` is the deploy/sync handoff. It:

1. uploads the new baseline to `/api/baseline`
2. derives known public paths from the accepted baseline
3. calls an optional purge callback with those paths
4. verifies `GET /api/health`
5. verifies `GET /` with a no-cache request

That keeps invalidation independent from the mechanism that created the
baseline. Phase 5 deploy does not attach a custom domain or zone purge; Phase 6
sync can reuse the same publish handoff and add cache-tag/versioned
invalidation or custom-domain purge without changing route rendering.
