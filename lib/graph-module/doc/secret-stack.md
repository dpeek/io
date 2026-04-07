---
name: Graph secret stack
description: "Cross-package ownership for secret handles, secret-field authoring, authority writes, and web-side storage centered on @io/graph-module."
last_updated: 2026-04-03
---

# Graph secret stack

## Read this when

- the question spans `defineSecretField(...)`, `core:secretHandle`,
  authority-side secret writes, or web-side secret storage
- you need the shared secret-handle boundary before changing a secret-backed
  field or runtime path
- you want the owning package doc before editing a secret-related area

## Main source anchors

- `../src/type.ts`: `defineSecretField(...)` and shared secret-field defaults
- `../../graph-module-core/src/core/secret.ts`: built-in `core:secretHandle`
  contract
- `../../graph-module-workflow/src/env-var.ts`: workflow env-var as one
  consumer of the shared secret-handle contract
- `../../graph-authority/src/session.ts`: authoritative apply seam that
  carries secret-backed writes through shared write contracts
- `../../app/src/web/lib/authority.ts`: current web authority implementation
  for secret write lowering
- `../../app/doc/authority-storage.md`: current authority-side durable
  plaintext storage and cleanup behavior

## What this doc owns

- the cross-package ownership map for the shipped secret-handle stack
- stable seams between shared secret-field authoring, graph-visible handle
  metadata, authority-only plaintext storage, and consumer-owned secret use
- redirects to the package-local docs that own current runtime behavior

It does not own reveal UX, provider-specific KMS integration, or auth-provider
session policy.

## Current ownership

- `@io/graph-module` owns the shared `defineSecretField(...)` authoring helper
  and the schema metadata that marks a field as secret-backed
- `@io/graph-module-core` owns the graph-visible `core:secretHandle` type
- consumer packages such as `@io/graph-module-workflow` own secret-backed field
  consumers like `workflow:envVar`
- `@io/graph-authority` owns the shared authoritative write boundary consumed by
  secret-backed fields
- app-owned web authority code owns the current secret write command,
  plaintext side storage, orphan pruning, and restart validation

## Stable contracts

### Secret handles, not plaintext graph values

The shared Branch 1 contract stays explicit:

- `core:secretHandle` is the canonical graph-visible handle type for
  secret-backed fields
- graph facts, sync payloads, and ordinary entity reads carry only safe handle
  metadata, not plaintext
- plaintext lives only in authority-owned storage paths

That is the line that keeps one logical graph model without pretending secrets
are ordinary replicated scalar values.

### Shared secret-field authoring

`defineSecretField(...)` is the shared authoring helper for any predicate that
points at `core:secretHandle`.

Stable defaults:

- `visibility: "replicated"`
- `write: "server-command"`
- `authority.secret.kind: "sealed-handle"`

Important rule:

- `metadataVisibility` defaults to the resolved field visibility unless the
  author overrides it explicitly

Optional `revealCapability` and `rotateCapability` values are schema metadata.
They are not a published reveal or rotation transport by themselves.

### Current web authority proof

The shipped secret write path is still consumer-owned:

- command envelope: `write-secret-field`
- authority implementation: `lib/app/src/web/lib/authority.ts`
- durable side storage: `io_secret_value`

Stable current behavior:

- the web proof lowers secret writes through the shared `server-command`
  boundary
- repeating the same plaintext keeps the current handle version
- retracting the last live reference prunes the authority-only plaintext row at
  the same durable cleanup point
- restart bootstrap prunes orphaned plaintext rows automatically
- missing or version-skewed side rows for live secret handles fail closed

Those storage details belong with the app-owned web authority path, not with
the shared authoring package.

### Explicitly provisional

These areas are still intentionally provisional:

- reveal flows
- provider-specific semantics for `provider`, `fingerprint`, and
  `externalKeyId`
- external KMS integration
- principal-aware enforcement of `revealCapability` or `rotateCapability`

Do not describe those as if the repo already shipped a stable cross-package
protocol for them.

## Where current details live

- `./reference-and-secret-fields.md`: shared secret-field authoring and
  reference-field helpers
- `../../graph-module-workflow/doc/env-vars.md`: `workflow:envVar` as one
  consumer of the shared secret-handle contract
- `../../graph-authority/doc/authority-stack.md`: authority boundary and the
  current MCP or command direction
- `../../graph-authority/doc/write-session.md`: authoritative apply and replay
  on top of shared write contracts
- `../../app/doc/authority-storage.md`: current Durable Object storage,
  `io_secret_value`, startup validation, and prune semantics

## Related docs

- `./module-stack.md`: built-in module ownership and manifest-to-installed-module
  lifecycle
- `../../graph-module-workflow/doc/workflow-stack.md`: browser-first workflow
  contract that consumes secret-backed env vars

Keep this doc narrow. Current-state package behavior belongs in the package docs
listed above.
