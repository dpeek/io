---
name: Graph projection module read scopes
description: "Named module read-scope definitions, registrations, and sync interop in @io/graph-projection."
last_updated: 2026-04-03
---

# Graph projection module read scopes

## Read this when

- you are changing named scoped-sync contracts
- you need to understand how requested and delivered module scopes differ
- you are wiring installed scope registrations into sync or authority code

## Main source anchors

- `../src/index.ts`: module read-scope types, builders, and registry helpers
- `../src/index.test.ts`: requested versus delivered scope examples
- `../../graph-sync/doc/sync-stack.md`: cross-package sync and authority wiring

## What this layer owns

- named module read-scope definitions
- scope registrations with explicit fallback behavior
- requested-scope and delivered-scope helper constructors
- registry and matching helpers over the shared sync scope contract

It does not own transport payloads or scope execution. Those stay in
`@io/graph-sync`, `@io/graph-authority`, and host code.

## Core model

`ModuleReadScopeDefinition` is the stable definition-time shape:

- `kind: "module"`
- `moduleId`
- `scopeId`
- `definitionHash`

`ModuleReadScopeRegistration` wraps that definition with one explicit fallback
contract:

- `fallback.definitionChanged`
- `fallback.policyChanged`

Those fallback reasons come from `@io/graph-sync` and are the fail-closed
signals callers use when an old scoped cursor is no longer compatible.

## Requested versus delivered scope

The package keeps requested scope identity smaller than delivered scope
identity.

Requested scope:

- `createModuleReadScopeRequest(...)`
- `createRegisteredModuleReadScopeRequest(...)`
- shape: `{ kind: "module", moduleId, scopeId }`

Delivered scope:

- `createModuleReadScope(...)`
- `createRegisteredModuleReadScope(...)`
- shape: `{ kind: "module", moduleId, scopeId, definitionHash, policyFilterVersion }`

Important rule:

- callers request by module and scope id
- authorities deliver a stronger identity that includes scope-definition and
  policy compatibility

## Matching helpers

The package exposes two levels of matching:

- `matchesModuleReadScopeRequest(...)` matches on `{ moduleId, scopeId }`
- `matchesModuleReadScope(...)` also requires the delivered `definitionHash`

Registration matching stays request-shaped:

- `matchesModuleReadScopeRegistration(...)`
- `findModuleReadScopeRegistration(...)`

That lets hosts find the installed definition for an incoming request before
they compute the delivered scope metadata.

## Registry rules

`defineModuleReadScopeRegistry(...)` is non-empty and fail-closed.

Important behavior:

- each registration is normalized through
  `defineModuleReadScopeRegistration(...)`
- definitions must be unique by
  `{ moduleId, scopeId, definitionHash }`
- empty registries throw

The registry is a shipped set of installed scopes, not an open-ended mutable
bag.

## Practical rules

- Change `definitionHash` when previously retained scoped state should no longer
  be reused.
- Keep fallback behavior explicit through registrations rather than inferring
  it from scope shape.
- Match requests by module and scope id first, then compare delivered hashes
  and policy version later in sync or authority code.
