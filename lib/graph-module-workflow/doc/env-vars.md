---
name: Graph module workflow env vars
description: "The workflow:envVar slice as a consumer of the shared secret-handle contract in @io/graph-module-workflow."
last_updated: 2026-04-03
---

# Graph module workflow env vars

## Read this when

- you are changing the `workflow:envVar` slice
- you need to understand how workflow env vars consume the shared secret-field
  contract
- you are tracing env-var naming or secret-handle behavior

## Main source anchors

- `../src/env-var.ts`: the workflow env-var slice
- `./workflow-stack.md`: cross-package workflow product contract
- `../../graph-module/doc/secret-stack.md`: cross-package secret-handle contract

## What this layer owns

- the `workflow:envVar` graph type
- env-var name validation
- workflow-specific secret-handle labeling helpers

It does not own secret storage or authority-side plaintext handling.

## Graph shape

`workflow:envVar` currently stores:

- inherited node fields
- `name`
- `secret`

The naming contract is explicit:

- names must not be blank
- names must start with an uppercase letter
- names may contain only uppercase letters, numbers, and underscores

## Secret-field contract

The `secret` field is authored through `defineSecretField(...)` over the
built-in `core:secretHandle` type.

Current workflow-owned additions are:

- label `Secret`
- `revealCapability: "secret:reveal"`
- `rotateCapability: "secret:rotate"`

Inherited shared defaults still apply:

- `visibility: "replicated"`
- `write: "server-command"`
- `authority.secret.kind: "sealed-handle"`

That means this slice consumes the shared secret-handle contract. It does not
redefine it.

## Helper

`buildSecretHandleName(...)` is the package-local naming helper for secret
handles associated with one env var.

## Practical rules

- Keep secret-field authoring here and shared secret semantics in
  `@io/graph-module`.
- Keep authority-side plaintext storage and write routing outside this package.
