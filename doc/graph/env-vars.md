# Env Var Secret Consumer

## Purpose

Describe `ops:envVar` as one consumer of the shared Branch 1 secret-handle
contract.

The env-var slice does not define that contract. It uses the core-owned
`core:secretHandle` type plus `defineSecretField(...)`.

## Current Graph Shape

- `ops:envVar.name`: required uppercase env-var name
- `ops:envVar.description`: optional safe description
- `ops:envVar.createdAt` / `updatedAt`: inherited safe timestamps
- `ops:envVar.secret`: optional `core:secretHandle` reference authored through
  `defineSecretField(...)`

The env-var secret field currently carries:

- `visibility: "replicated"`
- `write: "server-command"`
- `secret.kind: "sealed-handle"`
- `revealCapability: "secret:reveal"`
- `rotateCapability: "secret:rotate"`

Those capability keys are shared schema metadata in Branch 1. They are not yet
principal-aware enforcement rules.

## Current Authority Flow

The shipped web proof writes env-var secrets through the generic
`write-secret-field` command in `../../../../web/lib/authority.ts`.

Behavior today:

- first write creates a `core:secretHandle` and stores plaintext in
  authority-only side storage
- changed plaintext increments `secretHandle.version` and updates
  `lastRotatedAt`
- repeated plaintext keeps the existing version
- retracting `ops:envVar.secret` removes the replicated reference; retained
  authority-only rows are ignored during bootstrap unless the current graph
  still references that handle, and the Durable Object adapter prunes orphaned
  rows during cleanup

## Explicitly Provisional

- reveal flows
- provider-specific metadata semantics
- external KMS integration
- principal-aware enforcement of `revealCapability` / `rotateCapability`

## Canonical Docs

- `../../../../../doc/graph/env-vars.md`
- `../../../../../src/graph/secrets.md`
