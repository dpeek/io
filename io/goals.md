# Current Approach Stream

## Objective

- Make Linear the canonical source for evolving stream context, backlog order,
  and human review edits.
- Separate backlog grooming from child execution by parent stream phase without
  forcing the 3-level model yet.

## Current Focus

- Keep parent `Todo` as the only automatic backlog-entry phase for managed
  streams.
- Treat parent `In Review` as the safe bootstrap and post-backlog hold state
  for new streams until a human explicitly moves the stream to `In Progress`.
- Keep explicit managed-parent reruns available while the parent is in
  `In Review` without reopening automatic backlog scheduling.
- Seed new implementation children in `Todo` and rely on the parent-phase gate
  to keep them parked until the stream is released.
- Keep parent and child Linear transitions separate: backlog success returns
  the parent to `In Review`, while child execution still lands on `Done`.
- Keep repo docs terse and current while the parent Linear issue holds the
  evolving brief, child backlog, and operator notes.

## Constraints

- Preserve the existing 2-level parent/child hierarchy for this first pass.
- Keep the parent issue as the canonical stream context source and respect
  managed-marker ownership boundaries.
- Keep child issues scoped to implementation-step work; planning and review
  remain parent-owned.
- Do not auto-run managed backlog after a parent leaves `Todo`.
- Do not auto-run child issues unless their parent stream is `In Progress`.
- Keep one active child per stream and continue to respect `blockedBy` ordering.

## Proof Surfaces

- `../io.ts`
- `./overview.md`
- `../agent/io/module-stream-workflow-plan.md`
- `../agent/doc/stream-workflow.md`
- `../agent/src/types.ts`
- `../agent/src/issue-routing.ts`
- `../agent/src/service.ts`
- `../agent/src/tracker/linear.ts`
- `../agent/src/service.test.ts`
- `../agent/src/workspace.ts`
- `../agent/src/workspace.test.ts`

## Deferred

- A full 3-level stream/planning/implementation hierarchy.
- Stream merge or PR automation beyond parent-phase gating.
- Broader doc-layout cleanup outside the current routing, tracker, and
  scheduling slice.
