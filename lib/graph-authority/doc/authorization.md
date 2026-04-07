---
name: Graph authority authorization
description: "Request-bound policy evaluation, admission, share, and browser bootstrap contracts in @io/graph-authority."
last_updated: 2026-04-03
---

# Graph authority authorization

## Read this when

- you are changing `authorizeRead()`, `authorizeWrite()`, or `authorizeCommand()`
- you need to understand the graph-owned auth context, share contracts, or admission policy
- you are wiring browser bootstrap or principal summary data above the shared authority boundary

## Main source anchors

- `../src/authorization.ts`: request-time policy evaluator
- `../src/contracts.ts`: graph-owned auth, share, admission, and bootstrap contract types
- `../src/authorization.test.ts`: focused evaluator examples
- `../src/contracts.test.ts`: share, admission, and bootstrap contract coverage
- `./authority-stack.md`: broader cross-package authority model and command-lowering context

## Authorization context

`AuthorizationContext` is the request-bound snapshot the evaluator consumes:

- graph, principal, and session identity
- role keys
- capability grant ids
- `capabilityVersion`
- `policyVersion`

The shared evaluator does not refresh those snapshots. Callers must supply current request-bound data and fail closed when it is stale.

## Read policy

- `authorizeRead()` requires one predicate policy for the exact predicate id being evaluated.
- Missing or mismatched policy data is denied.
- Supported read audiences are:
  - `public`
  - `owner`
  - `graph-member`
  - `capability`
  - `authority`
- Shared reads are allowed only when:
  - `sharedRead` is set by the caller
  - the predicate policy is `shareable`
  - the predicate is still transport-visible as `replicated`

## Write policy

- `authorizeWrite()` reuses the same predicate policy contract and fail-closed stance.
- Supported write audiences are:
  - `owner-edit`
  - `graph-member-edit`
  - `capability`
  - `module-command`
  - `authority`
- Required write scope is checked after audience and capability checks.
- A predicate that requires `server-command` or `authority-only` fails closed when the caller presents a narrower write path.

## Command policy

- `authorizeCommand()` requires an explicit `GraphCommandPolicy`.
- Command-level required capabilities are checked first.
- Every touched predicate supplied by the caller must be declared in `touchesPredicates`.
- Every declared touched predicate must also be evaluated explicitly by the caller.
- Per-predicate command writes are delegated back through `authorizeWrite()` with `intent: "command"` and default `writeScope: "server-command"`.

This is the main fail-closed rule: command paths cannot silently skip protected predicate checks.

## Role interpretation

- authority context is granted for:
  - `principalKind === "service"`
  - `principalKind === "agent"`
  - principals holding `graph:authority`
- graph-member context also accepts `graph:member` and `graph:owner`
- owner context is derived from `authorization.principalId === target.ownerPrincipalId`

## Admission, share, and bootstrap contracts

- `defineAdmissionPolicy()` validates the graph-owned signup and bootstrap contract.
  - allowed email domains must be lowercase domains, not email addresses
  - first-user and open-signup paths must carry provisioning role keys
- `defineShareSurface()` and `validateShareSurface()` currently support one bounded surface kind: `entity-predicate-slice`
- `defineShareGrant()` and `validateShareGrant()` keep the share grant aligned with the underlying capability-grant projection and its root entity plus predicate constraints
- `defineWebPrincipalSession()`, `defineWebPrincipalSummary()`, and `defineWebPrincipalBootstrapPayload()` define the minimal browser/bootstrap contract the package owns

Provider-specific auth parsing, Better Auth integration, and request/session bridge code stay outside this package.

## Practical rules

- Fail closed when policy or capability metadata is missing. Do not invent defaults in the evaluator.
- Keep the shared evaluator request-bound and side-effect free.
- Use share grants only for replicated, explicitly shareable predicates.
- Keep auth-provider or cookie semantics in host code; this package owns only the graph-side contract.
