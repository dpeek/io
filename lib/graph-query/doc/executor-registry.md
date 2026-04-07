---
name: Graph query executor registry
description: "Installed-surface to executor resolution and fail-closed version checks in @io/graph-query."
last_updated: 2026-04-02
---

# Graph query executor registry

## Read this when

- you are changing `createQueryExecutorRegistry(...)`
- you need to understand how installed surfaces resolve to collection or scope executors
- you are debugging missing, stale, or ambiguous executor registrations

## Main source anchors

- `../src/serialized-query-executor-registry.ts`: registry types and resolution rules
- `../src/serialized-query-executor-registry.test.ts`: unregistered, missing, stale, and ambiguous coverage
- `../src/query-surface-registry.ts`: installed-surface shape consumed by executor resolution
- `../../app/src/web/lib/registered-serialized-query-executors.ts`: app-owned contributor composition over active modules
- `./query-stack.md`: broader query execution architecture

## What this layer owns

- the installed executor registry keyed by installed surfaces
- typed execution context shapes for collection and scope executors
- fail-closed resolution for missing, stale, or ambiguous executor matches

It does not own query normalization, authority execution, or app-specific module activation.

## Resolution model

- collection queries resolve directly from `query.indexId`
- scope queries may resolve from an explicit `scopeId`
- scope queries may also resolve from a normalized module definition when it points at exactly one installed module scope surface and does not request projection roots

Possible failures stay explicit:

- `unregistered-surface`: no installed surface matched
- `missing-executor`: the surface exists but no executor was registered for it
- `stale-executor`: the executor was registered for the right surface id but the wrong `surfaceVersion`
- `ambiguous-surface`: more than one installed scope surface matched the normalized scope request

## Version boundary

- executor registrations must have non-empty `surfaceId` and `surfaceVersion`
- registrations are unique per `queryKind + surfaceId`
- `surfaceVersion` is the compatibility boundary between installed surface metadata and executor logic

That means executor routing can fail closed on drift without trying to guess whether a changed surface is still "close enough."

## Practical rules

- Keep this layer as pure routing. Module packages own the executor implementations.
- Preserve explicit ambiguity for scope matching; do not add silent tie-breaks.
- If you widen scope matching rules, update the ambiguity tests first.
