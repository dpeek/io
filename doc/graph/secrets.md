# Graph Secrets

## Purpose

Publish the shared Branch 1 secret-handle contract beside the graph code.

Env vars consume this contract, but they do not define it.

## Stable Branch 1 Contract

- `core:secretHandle` is the canonical graph-visible handle type for
  secret-backed fields.
- `defineSecretField(...)` is the shared authoring helper for any secret-backed
  predicate that points at `core:secretHandle`.
- `GraphSecretFieldAuthority` publishes `kind: "sealed-handle"` plus optional
  `metadataVisibility`, `revealCapability`, and `rotateCapability`.
- The graph replicates only safe handle metadata such as name, version, and
  last rotation time. Plaintext does not live in graph facts, sync payloads, or
  MCP/entity reads.
- The default shared secret-field policy is `visibility: "replicated"` and
  `write: "server-command"` unless a caller narrows it explicitly.
- The current web authority proof lowers secret writes to the shared
  `server-command` write boundary and stores plaintext in authority-only side
  storage.
- Repeating the same plaintext keeps the current handle version. Retracting the
  last live reference to a secret handle prunes the authority-only plaintext
  row at the same durable cleanup point.
- Restart bootstrap prunes orphaned plaintext rows automatically, but missing
  or version-skewed side rows for live secret handles fail closed instead of
  being guessed or silently rewritten.

## Consumer-Owned Proof

The shipped plaintext write path is still consumer-owned:

- command envelope: `write-secret-field`
- authority implementation: `../../src/web/lib/authority.ts`
- durable side storage: `io_secret_value` in
  `../../src/web/lib/graph-authority-do.ts`

That proof works for any secret-backed predicate. `workflow:envVar` is one consumer
of it.

## Explicitly Provisional

- reveal flows
- provider-specific semantics for `provider`, `fingerprint`, and
  `external_key_id`
- external KMS integration
- principal-aware enforcement of `revealCapability` / `rotateCapability`

## Relevant Files

- `../../src/graph/index.ts`
- `../../src/graph/type-module.ts`
- `../../src/graph/modules/core/secret/type.ts`
- `../../src/graph/modules/workflow/env-var/type.ts`
- `../branch/01-graph-kernel-and-authority.md`
- `../graph/env-vars.md`
