---
name: Graph authority replication
description: "Transport visibility filtering, authority-owned read filtering, and write-scope enforcement in @io/graph-authority."
last_updated: 2026-04-02
---

# Graph authority replication

## Read this when

- you are changing authority-side replication filtering
- you need to understand how field visibility and write policy are enforced
- you are debugging why a predicate disappears from total or incremental sync output

## Main source anchors

- `../src/replication.ts`: field-policy indexing, replicated snapshot filtering, and write-policy checks
- `../src/definitions.ts`: required `node.type` lookup used to recover subject type ids
- `../src/session.ts`: total and incremental payload helpers that call into replication filtering
- `../src/validation.ts`: authoritative validation paths that consume the same write-policy checks

## Policy source

- The authority layer derives per-predicate behavior from schema metadata already owned by `@io/graph-kernel`.
- `createFieldAuthorityPolicyIndex()` walks resolved entity definitions and indexes:
  - transport visibility from `fieldVisibility(...)`
  - required write scope from `fieldWritePolicy(...)`
- The runtime key is `(subject type id, predicate id)`, not just predicate id. The same predicate id may mean different things on different subject types.

## Definitions requirement

- Authority replication needs the built-in core `node.type` predicate in the provided definitions.
- `readAuthoritativeNodeTypePredicateId()` fails fast if the definitions do not include that core node contract.
- In practice, callers should pass definitions that already include `core`.

## Snapshot filtering

- `filterReplicatedSnapshot()` starts from `store.snapshot()`.
- It drops any edge whose predicate policy resolves to non-replicated visibility.
- It then applies the optional `authorizeRead` callback to the remaining predicate targets.
- Retracted edge ids are trimmed down to the visible edge set so callers do not receive tombstones for hidden facts.

## Incremental filtering

- `filterReplicatedWriteResult()` filters one accepted write result operation by operation.
- Assert operations resolve their target from the asserted edge.
- Retract operations try to resolve through the prebuilt edge index.
- Unresolved retracts are kept intentionally so incremental callers can still converge when retained history only has the edge id.
- If every operation is filtered out, the whole write result is omitted from incremental replication.

## Write-scope enforcement

- `validateAuthoritativeFieldWritePolicies()` compares the caller write scope to the required field write policy.
- The current ordering is:
  - `client-tx`
  - `server-command`
  - `authority-only`
- Narrower write paths fail with `sync.tx.op.write.policy`.

This check is part of authoritative transaction validation. It is not a separate post-commit audit step.

## Practical rules

- Keep replication filtering read-only. It must not mutate stored authority state or retained history.
- Keep unresolved retracts visible in incremental output unless the contract changes deliberately across packages.
- Do not infer subject type ids without `node.type`; fail closed instead.
- If a predicate vanishes from sync output, check transport visibility first, then the optional `authorizeRead` callback.
