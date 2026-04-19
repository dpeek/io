# Graphle Deploy Cloudflare

`@dpeek/graphle-deploy-cloudflare` owns the Cloudflare public-site deployment
boundary for the personal-site MVP.

## Package Docs

- [`./doc/cloudflare-public-rendering.md`](./doc/cloudflare-public-rendering.md):
  Worker runtime, Durable Object baseline storage, Cloudflare provisioning,
  credential handling, cache policy, and publish handoff.

## What It Owns

- a small Cloudflare Worker fetch entrypoint for public `site:item` routes
- a Durable Object class that stores the current projected public graph baseline
- protected baseline replacement at `/api/baseline`
- public health at `/api/health` and JSON 404s for unknown `/api/*`
- SSR of public routes through `@dpeek/graphle-site-web`'s shared
  `renderPublicSiteRoute(...)`
- CDN cache headers for public HTML, missing routes, APIs, and static assets
- Cloudflare input validation, deterministic Worker naming, Worker bundle
  generation, Worker script upload metadata, Durable Object binding/migration
  metadata, packaged public stylesheet asset upload, workers.dev enablement, and
  account subdomain lookup
- graph-backed nonsecret deploy metadata schema for local persistence
- publish helpers that replace the remote baseline, verify health and `/`, and
  verify URL-only public item display when one exists, with bounded retries for
  workers.dev propagation after Worker uploads

## What It Does Not Own

- local auth, local `/api/sync`, or graph transactions
- remote authoring, remote login, Better Auth, workflow, saved-query, or
  installed-module routes
- Cloudflare API token persistence
- custom domains, zone routes, DNS, certificates, rollbacks, or continuous sync

## Validation

Run `turbo check --filter=@dpeek/graphle-deploy-cloudflare` from the repo root,
or `bun run check` in this package.
