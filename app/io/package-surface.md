# App Package Surface

## Purpose

Define the kept boundary for `@io/app` after the app-surface cleanup. `OPE-202`
lands this shape: `@io/app` exports only app-owned proof contracts, and
graph-engine callers import from `@io/graph` directly.

The inventory below keeps the original app-owned versus graph-owned
classification explicit even though the passthrough removals are now complete.

## Kept `@io/app` Surface After Cleanup

`@io/app` should expose app-owned proof contracts only:

- `app`
- `company`
- `person`
- `status`
- `block`
- `createExampleRuntime()`
- `type ExampleSyncedClient`

Those symbols already come from:

- `../src/graph/app.ts`
- `../src/graph/runtime.ts`

Everything graph-engine related should come from `@io/graph` instead:

- schema/bootstrap/client/store/sync primitives
- `core`
- type-module authoring helpers
- relationship/web-policy helpers
- built-in scalar, enum, and address/country modules

## Inventory

### Root export

| Path               | Classification     | Cleanup action                                                       |
| ------------------ | ------------------ | -------------------------------------------------------------------- |
| `app/src/index.ts` | compatibility-only | Keep the file and re-export only the app-owned symbols listed above. |

### `app/src/graph/*`

| Path                            | Classification          | Cleanup action                                                                |
| ------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `app/src/graph/app.ts`          | app-owned               | Keep. This is the app schema surface.                                         |
| `app/src/graph/runtime.ts`      | app-owned               | Keep. This is the example runtime/bootstrap proof surface.                    |
| `app/src/graph/example-data.ts` | app-owned               | Keep as internal support for `runtime.ts`; do not add it to the package root. |
| `app/src/graph/bootstrap.ts`    | graph-owned passthrough | Removed. Import from `@io/graph`.                                             |
| `app/src/graph/client.ts`       | graph-owned passthrough | Removed. Import from `@io/graph`.                                             |
| `app/src/graph/core.ts`         | graph-owned passthrough | Removed. Import from `@io/graph`.                                             |
| `app/src/graph/schema.ts`       | graph-owned passthrough | Removed. Import from `@io/graph`.                                             |
| `app/src/graph/store.ts`        | graph-owned passthrough | Removed. Import from `@io/graph`.                                             |
| `app/src/graph/sync.ts`         | graph-owned passthrough | Removed. Import from `@io/graph`.                                             |
| `app/src/graph/type-module.ts`  | compatibility-only      | Removed. Import from `@io/graph`.                                             |
| `app/src/graph/web-policy.ts`   | compatibility-only      | Removed. Import from `@io/graph`.                                             |

### `app/src/type/*`

| Path                            | Classification          | Cleanup action                              |
| ------------------------------- | ----------------------- | ------------------------------------------- |
| `app/src/type/status/index.ts`  | app-owned               | Keep. This is the app-specific enum module. |
| `app/src/type/status/type.ts`   | app-owned               | Keep.                                       |
| `app/src/type/status/meta.ts`   | app-owned               | Keep.                                       |
| `app/src/type/status/filter.ts` | app-owned               | Keep.                                       |
| `app/src/type/address/index.ts` | graph-owned passthrough | Removed. Import from `@io/graph`.           |
| `app/src/type/boolean/index.ts` | graph-owned passthrough | Removed. Import from `@io/graph`.           |
| `app/src/type/country/index.ts` | graph-owned passthrough | Removed. Import from `@io/graph`.           |
| `app/src/type/email/index.ts`   | graph-owned passthrough | Removed. Import from `@io/graph`.           |
| `app/src/type/enum-module.ts`   | graph-owned passthrough | Removed. Import from `@io/graph`.           |
| `app/src/type/number/index.ts`  | graph-owned passthrough | Removed. Import from `@io/graph`.           |
| `app/src/type/slug.ts`          | graph-owned passthrough | Removed. Import from `@io/graph`.           |
| `app/src/type/string/index.ts`  | graph-owned passthrough | Removed. Import from `@io/graph`.           |
| `app/src/type/url/index.ts`     | graph-owned passthrough | Removed. Import from `@io/graph`.           |

## Import, Test, And Doc Updates For Cleanup

The cleanup pass should make these changes together:

- Switch app schema/runtime sources to `@io/graph` for graph-owned APIs:
  - `app/src/graph/app.ts`
  - `app/src/graph/example-data.ts`
- Switch graph-contract tests from local wrappers to `@io/graph`:
  - `app/src/graph/client-enum.test.ts`
  - `app/src/graph/client-validation.test.ts`
  - `app/src/graph/schema-range.test.ts`
  - `app/src/graph/type-module.test.ts`
  - `app/src/graph/validation-lifecycle.test.ts`
- Stop using `#graph` as an ambiguous alias in web proofs:
  - `app/src/web/company-proof.tsx`
  - `app/src/web/company-query-proof.tsx`
  - `app/src/web/explorer.tsx`
  - `app/src/web/runtime.tsx`
  - `app/src/web/relationship-proof.tsx`
- Keep app-owned imports local:
  - `../graph/app.js`
  - `../graph/runtime.js`
  - `../type/status/index.js`
- Update `app/io/overview.md` to describe `@io/app` as an app-owned surface only.
- With the imports above switched, remove the passthrough files and delete the
  `#graph` alias from `app/package.json`.
