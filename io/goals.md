# Current Approach Stream

## Objective

- Make Linear the canonical source for evolving stream context, backlog order,
  and human review edits.
- Separate backlog grooming from child execution by parent stream phase without
  forcing the 3-level model yet.

## Current Focus

- Carry parent stream state into child scheduling so only parents in
  `In Progress` can release child execution.
- Keep managed parent `Todo` as the backlog-grooming phase, then move
  successful backlog runs to `In Review` for human editing and approval.
- Keep repo docs terse and current while the parent Linear issue holds the
  evolving brief, child backlog, and operator notes.

## Constraints

- Preserve the existing 2-level parent/child hierarchy for this first pass.
- Keep the parent issue as the canonical stream context source and respect
  managed-marker ownership boundaries.
- Do not create or auto-run child issues in active execution states before the
  parent-phase gate exists.
- Keep one active child per stream and continue to respect `blockedBy` ordering.

## Proof Surfaces

- `../io.ts`
- `./overview.md`
- `../agent/io/module-stream-workflow-plan.md`
- `../agent/src/types.ts`
- `../agent/src/issue-routing.ts`
- `../agent/src/service.ts`
- `../agent/src/tracker/linear.ts`
- `../agent/src/service.test.ts`

## Deferred

- A full 3-level stream/planning/implementation hierarchy.
- Stream merge or PR automation beyond parent-phase gating.
- Broader doc-layout cleanup outside the current routing, tracker, and
  scheduling slice.
