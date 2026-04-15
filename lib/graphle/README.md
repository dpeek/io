# Graphle

`@dpeek/graphle` is the public command package for Graphle.

The first product command is:

```sh
bunx @dpeek/graphle dev
```

That command delegates to `@dpeek/graphle-local`, which prepares the current
working directory, opens `graphle.sqlite`, starts the local Bun server, and opens
the browser through the local admin init flow.

## What It Owns

- the public `graphle` binary entrypoint
- top-level dispatch for the product command surface
- delegation of `graphle dev` to `@dpeek/graphle-local`

## What It Does Not Own

- the existing operator and automation command groups in `@dpeek/graphle-cli`
- local server route handling, project `.env` management, or SQLite bootstrap
- browser UI bundles, Better Auth, Cloudflare deploy, or sync

## Validation

Run `turbo check --filter=@dpeek/graphle` from the repo root, or
`bun run check` in this package.
