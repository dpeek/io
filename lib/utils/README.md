# Utils

`@io/utils` owns the generic runtime helpers that are shared across packages.

## What It Owns

- environment-variable helpers
- structured logging helpers
- process exit handling helpers

## What It Does Not Own

- operator/runtime config loading, which stays in `@op/cli/config`
- graph or web application surfaces

## Validation

Run `turbo check --filter=@io/utils` from the repo root, or `bun run check` in
this package, for the package-local lint/format/type/test pass. Run
`turbo check` from the repo root before landing repo-wide changes.
