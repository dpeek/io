# Managed Module Stream Workflow Plan

Status: Active implementation plan.

## Purpose

This plan keeps the managed-module-stream work narrow. The main contracts are
now defined elsewhere; follow-on work should implement them in order instead of
reopening the contract on each issue.

## Stable Contract Sources

- label and parent ownership contract:
  [`./goals.md`](./goals.md)
- parent brief and child backlog shape:
  [`./managed-stream-backlog.md`](./managed-stream-backlog.md)
- `@io` comment trigger model:
  [`./managed-stream-comments.md`](./managed-stream-comments.md)
- branch, worktree, and landing lifecycle:
  [`../../agent/doc/stream-workflow.md`](../../agent/doc/stream-workflow.md)

## Phase 1 Landed

The first managed-stream slice is now in place for the `agent` module:

1. managed parent identity comes from `io` plus exactly one configured module
   label
2. module docs and allowed shared paths come from `modules.<id>` in `io.ts`
3. `@io` comments are parsed and tracked through the Linear adapter
4. parent managed-brief writeback has a stable marker shape
5. stream-aware scheduling and workspaces already serialize child execution per
   parent stream

## Next Expansion Priorities

1. finish the remaining comment-owned write surfaces:
   implement the repo-wide focus doc refresh, align the canonical focus-doc
   path, and make `@io backlog` own child-backlog refresh as well as parent
   brief writeback
2. prove the contract on one non-`agent` module:
   use `graph` as the first portability proof so module-local planning,
   context, and backlog expansion stop depending on `agent`-specific
   assumptions
3. surface module-stream state for operators:
   show module identity, stream occupancy, and scheduling/blocked reasons
   clearly enough that multiple package streams can run in parallel without
   hidden routing decisions

## Execution Order

1. close the write-surface gaps so the contract is complete on one module
2. prove the same flow on `graph` and capture any module-portability fixes
3. upgrade operator-visible state once multiple module streams can exist at the
   same time

## Out Of Scope For This Slice

- free-form natural-language comment parsing
- multiple active child runs inside one stream
- replacing Linear parent or `blockedBy` semantics
- inventing new managed marker ids beyond the reserved set in `./goals.md`

## Done Means

The stream is coherent when routing, parent writeback, child backlog
maintenance, focus-doc refresh, comment-triggered updates, non-`agent`
portability, and operator-visible stream state all target the same label
rules, marker ids, and ownership boundaries.
