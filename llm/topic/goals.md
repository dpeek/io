# Managed Stream Write Surfaces

## Objective

- Ship the managed-stream comment write surfaces without hand-editing parent issues or the focus doc.
- Keep focus refresh, parent brief writeback, and child backlog maintenance aligned.

## Current Focus

- Refresh `@io focus` against the stable repo-wide focus-doc shape.
- Let `@io backlog` reuse and relink speculative Todo children deterministically.
- Keep docs, config, and tests aligned on `./llm/topic/goals.md`.

## Constraints

- Preserve human-authored content outside managed issue sections and agent reply comments.
- Treat equivalent reruns as no-ops across issue-body, child-issue, and focus-doc writes.
- Keep the implementation narrow to the `agent` module for this slice.

## Proof Surfaces

- ./agent/src/service.ts
- ./agent/src/tracker/linear.ts
- ./agent/src/context.ts
- ./io/topic/goals.md
- ./io/topic/managed-stream-backlog.md
- ./io/topic/managed-stream-comments.md

## Deferred

- Proving the managed stream flow on a non-`agent` module.
- Operator UI changes beyond the reporting needed for the new write surfaces.
