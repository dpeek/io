# Env Vars And Secret Refs

## Purpose

Define the app-owned graph shape for environment variables and the authority
boundary where plaintext handling starts.

This is the proof contract the routed operator UI builds on top of. It keeps
the synced graph explicit about what is safe metadata versus authority-only
secret material.

## Graph Shape

The app graph models two entities:

- `envVar`
- `secretRef`

`envVar` carries the replicated operator-facing metadata:

- `name`: required env-var name, validated as uppercase letters, numbers, and
  underscores with a leading letter
- `description`: optional safe description from `core.node.fields`
- `createdAt` / `updatedAt`: inherited safe timestamps from `core.node.fields`
- `secret`: optional reference to the current `secretRef`

`secretRef` is the opaque graph-level handle for the secret-backed value:

- `name`: derived label such as `OPENAI_API_KEY secret`
- `version`: monotonically increasing secret version
- `lastRotatedAt`: timestamp for the last accepted rotation
- `createdAt` / `updatedAt`: inherited metadata from `core.node.fields`

The graph never stores the plaintext secret value. Sync payloads replicate only
the `envVar` metadata and `secretRef` metadata needed for the browser UI to
show presence, version, and rotation timing.

## Authority Contract

The authority boundary is `AppAuthority.saveEnvVar()` and its routed wrapper at
`POST /api/env-vars`.

The contract is:

- create: requires `name` and a non-empty `secretValue`
- metadata update: allows `name` and `description` changes without a new
  plaintext secret
- rotation: accepts a non-empty `secretValue` and updates the existing
  `secretRef` when the submitted plaintext differs from the current
  authority-held plaintext
- idempotent resubmission: if the submitted plaintext matches the current
  authority-held plaintext, the env var may still update metadata but the
  `secretRef.version` and `lastRotatedAt` do not change

Accepted mutations write two different surfaces:

- graph state: `envVar`, `secretRef`, and safe metadata used by sync/UI
- authority-only state: `secretValues[secretId] = plaintext`

That split is what makes the browser route explicit:

- the client may list env vars and inspect safe metadata after sync
- the client never receives plaintext through the graph payload
- secret writes cross one authority-only mutation path before syncing back as
  opaque metadata

## Current Proof Storage

The current proof persists authority state in one JSON snapshot file:

- `snapshot`: the authoritative graph snapshot
- `writeHistory`: sync cursor history
- `secretValues`: authority-only plaintext indexed by `secretRef` id

This is a local proof convenience, not the intended production storage model.
It demonstrates the graph/authority split but does not yet provide encrypted
secret storage.

## Follow-On Gaps

The current app proof still depends on graph-owned or runtime-owned follow-on
work:

- predicate-level replication and read/write policy are not yet declared in the
  graph schema, so the secret boundary is enforced by the app runtime contract
  rather than a general graph policy layer
- plaintext secret storage is still an in-process string map persisted in the
  authority snapshot; a real secret backend, encryption, and audit trail are
  still missing
- the proof defines write and rotation flows, but not an explicit unseal/read
  contract for authority-approved secret access
- actor identity, capability checks, and per-rotation history are not yet part
  of the env-var mutation contract
