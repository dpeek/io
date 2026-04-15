# Graph Module Site

`@dpeek/graphle-module-site` owns the built-in `site:` namespace for the
personal-site MVP.

## Package Docs

- [`./doc/site-schema.md`](./doc/site-schema.md): site schema ownership,
  minimal-core dependency, stable ids, and current non-goals.

## What It Owns

- the `site:path` scalar for absolute website paths
- the `site:status` enum with `draft` and `published`
- the `site:page` and `site:post` entity definitions
- stable ids for every site type, predicate, enum option, and field-tree node
- `siteManifest` for the built-in site schema contribution

## What It Does Not Own

- local server startup or SQLite persistence
- browser shell, authoring UI, markdown rendering polish, deploy, or sync
- `core:` schema records beyond consuming the minimal core boot slice
- Better Auth, `AUTH_DB`, identity, sharing, workflow, saved-query, or app-owned
  records

## Validation

Run `turbo check --filter=@dpeek/graphle-module-site` from the repo root, or
`bun run check` in this package.
