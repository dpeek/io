# Environment Variables

## Purpose

Describe the canonical `app:` env-var schema, its relationship to the
core-owned `secretHandle` type, and the authority boundary that keeps plaintext
secret material out of the replicated graph.

Environment variables are created as ordinary graph entities through the shared
explorer and delegate secret-aware writes to the generic web authority command
at `POST /api/secret-fields`.

## Graph Shape

The canonical app slice lives alongside this doc under
`../../../../src/graph/schema/app/env-vars/`. The slice is intentionally flat:
`env-var.ts` defines the env-var type and validation helpers, and `index.ts`
re-exports the public env-var surface plus the app-specific
`buildSecretHandleName(...)` helper. The referenced secret-handle type now lives
under `../../../../src/graph/schema/core/secret/`.

Together, the env-var proof models:

- `envVar`
- `secretHandle`

`envVar` carries the replicated operator-facing metadata:

- `name`: required env-var name, validated as uppercase letters, numbers, and
  underscores with a leading letter
- `description`: optional safe description from `core.node.fields`
- `createdAt` / `updatedAt`: inherited safe timestamps from `core.node.fields`
- `secret`: optional reference to the current `core:secretHandle`

`secretHandle` is a core-owned opaque graph type for the secret-backed value:

- `name`: operator-facing label, with env vars typically using
  `OPENAI_API_KEY secret`
- `version`: monotonically increasing secret version
- `lastRotatedAt`: timestamp for the last accepted rotation
- `createdAt` / `updatedAt`: inherited metadata from `core.node.fields`

The graph never stores plaintext secret values. Sync replicates only the env-var
metadata and the safe secret-handle metadata needed for the explorer to show
presence, version, and rotation timing.

## Authority Contract

The authority boundary is the web Worker/Durable Object command
`POST /api/secret-fields`.

The contract is:

- env-var entity creation stays a normal graph mutation for safe metadata such
  as `name` and `description`
- secret write: accepts `entityId`, `predicateId`, and non-empty plaintext,
  then creates or updates the referenced `secretHandle`
- rotation: updates the existing `secretHandle` when the submitted plaintext
  differs from the authority-held plaintext
- idempotent resubmission: if the submitted plaintext matches the current
  authority-held plaintext, the handle metadata may be normalized but
  `secretHandle.version` and `lastRotatedAt` do not advance

Accepted mutations write two different surfaces:

- graph state: `envVar`, `core:secretHandle`, and the safe metadata used by
  sync/UI
- authority-only state: `io_secret_value[secretId].value = plaintext`

That split keeps the explorer explicit:

- the client may list env vars and inspect safe metadata after sync
- the client never receives plaintext through the graph payload
- secret writes cross one explicit authority command before syncing back as
  opaque metadata
