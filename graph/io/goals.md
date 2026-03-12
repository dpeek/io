# Graph Goals

## Objective

- Make graph sync transaction-stream-first in steady state while keeping total snapshots as the bootstrap and recovery path.
- Keep typed reads, validation, and explorer/devtool semantics coherent as authoritative state moves from snapshot replacement to cursored transaction delivery.

## Current Focus

- Persist authoritative transaction history and cursor progression beside the current snapshot-backed authority proof.
- Teach sync sessions and synced clients to pull and apply ordered transaction batches after a cursor without widening predicate-local invalidation.
- Expose enough runtime and explorer visibility to inspect pending writes, applied transactions, and snapshot fallback behavior.

## Constraints

- Reusable value semantics belong with scalar and enum definitions; predicate-specific rules belong with fields; runtime invariants stay centralized in validation/apply boundaries.
- Keep total snapshots as the bootstrap and reset path; do not introduce query-scoped partial sync in this slice.
- Preserve the existing typed client, predicate-ref, and validation contracts while delivery mechanics change under them.

## Proof Surfaces

- `../src/graph/store.ts`
- `../src/graph/sync.ts`
- `../src/graph/client.ts`
- `../../app/src/authority.ts`
- `../../app/src/graph/runtime.ts`
- `../../app/src/graph/sync.test.ts`
- `../../app/src/web/explorer.tsx`

## Deferred

- Query-scoped partial sync and per-query completeness surfaces.
- Persistence backend work beyond the current app authority proof.
- ACL, secrets, and server-action policy work.

## Related Docs

- `./overview.md`
- `../../app/io/goals.md`
- `../../io/overview.md`
- `../doc/overview.md`
- `../doc/big-picture.md`
- `../doc/validation.md`
- `../doc/sync.md`
- `../doc/typed-refs.md`
- `../doc/type-modules.md`
- `../doc/web-bindings.md`
- `../doc/schema-driven-ui.md`
- `../doc/schema-driven-ui-implementation-plan.md`
- `../doc/schema-driven-ui-backlog.md`
