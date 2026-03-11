# IO Stream Focus

## Objective

- Ship the current managed-stream write surfaces without requiring hand-edited parent briefs or focus docs.
- Keep repo docs, config, and agent behavior aligned around deterministic reruns.

## Current Focus

- Complete the managed parent brief, child backlog, and reply-comment write surfaces.
- Refresh the repo focus doc through `@io focus` using one stable markdown shape.
- Keep the `agent` module proof surfaces narrow and reviewable.

## Constraints

- Preserve human-authored content outside managed surfaces.
- Keep changes scoped to the write path and its contract tests.
- Run `bun check` and focused agent coverage before landing changes.

## Proof Surfaces

- ./agent/src/service.ts
- ./agent/src/tracker/linear.ts
- ./agent/src/context.ts
- ./io/topic/managed-stream-backlog.md
- ./io/topic/managed-stream-comments.md

## Deferred

- Non-`agent` module portability proofs beyond the current slice.
- Operator UI changes that are not required for the managed write surfaces.
