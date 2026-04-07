---
name: Graph module reference and secret fields
description: "Reference-field helpers, existing-entity metadata, and shared secret-field authoring in @io/graph-module."
last_updated: 2026-04-03
---

# Graph module reference and secret fields

## Read this when

- you are changing authored reference-field helpers
- you need to understand the existing-entity reference metadata contract
- you are tracing the shared secret-field authoring boundary

## Main source anchors

- `../src/type.ts`: `defineReferenceField(...)`, `defineSecretField(...)`, and reference input types
- `../src/reference.ts`: existing-entity reference metadata and field helper
- `../src/index.test.ts`: secret-field defaults and existing-entity metadata coverage
- `../src/index.typecheck.ts`: secret-authority and reference authoring boundary checks
- `./secret-stack.md`: cross-package secret-handle contract

## What this layer owns

- freeze-only reference-field authoring helpers
- the shared host-neutral metadata contract for existing-entity selection fields
- the shared secret-field authoring helper for predicates that point at `core:secretHandle`

It does not own secret storage, secret write transport, or reference picker runtime behavior.

## Reference fields

`defineReferenceField(...)` is intentionally small:

- it accepts a `ReferenceFieldInput`
- it returns that authored field unchanged

That is the point. It freezes the contract without sneaking runtime behavior into the authoring layer.

## Existing-entity reference policy

`existingEntityReferenceFieldMeta(...)` produces the shared metadata payload for reference fields that only allow selecting existing entities.

The metadata contract includes:

- `reference.selection: "existing-only"`
- whether the UI may create-and-link new entities
- optional `excludeSubject`
- optional editor kind
- optional ordered or unordered collection hint

`existingEntityReferenceField(...)` just threads that metadata into a normal reference field through `defineReferenceField(...)`.

## Secret-field authoring

`defineSecretField(...)` authors a secret-backed reference field with one guaranteed `authority.secret` payload.

Defaults:

- `visibility: "replicated"`
- `write: "server-command"`
- `authority.secret.kind: "sealed-handle"`

Important rule:

- `metadataVisibility` defaults to the resolved field visibility unless the caller sets it explicitly

That is why an authority-only secret field also defaults its metadata visibility to authority-only unless the author opts back into replicated metadata.

Optional capability keys:

- `revealCapability`
- `rotateCapability`

Those are schema metadata. They are not a published reveal or rotation transport.

## Boundary rules

- secret fields still point at a normal range ref, typically the built-in `core:secretHandle`
- command envelopes, request routing, and durable plaintext storage stay outside this package
- existing-entity reference metadata is host-neutral authoring data, not a browser widget registry

## Practical rules

- Use `defineReferenceField(...)` when you only need a stable authored contract.
- Use `existingEntityReferenceField(...)` when selection should stay limited to existing entities.
- Use `defineSecretField(...)` for any secret-backed predicate instead of recreating the `authority.secret` shape by hand.
