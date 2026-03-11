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

## Implementation Order

1. validate managed parent identity as `io` plus exactly one configured module
   label, and surface ambiguity clearly
2. persist and refresh the repo-wide focus doc using the accepted
   `./llm/topic/goals.md` shape
3. ingest `@io backlog`, `@io focus`, `@io status`, and `@io help` comments
   through the tracker layer
4. connect comment commands to the allowed write surfaces without rewriting
   human-owned issue prose
5. keep operator-visible summaries stable across issue body updates, child
   backlog maintenance, and comment replies

## Out Of Scope For This Slice

- free-form natural-language comment parsing
- multiple active child runs inside one stream
- replacing Linear parent or `blockedBy` semantics
- inventing new managed marker ids beyond the reserved set in `./goals.md`

## Done Means

The stream is coherent when routing, parent writeback, child backlog
maintenance, focus-doc refresh, and comment-triggered updates all target the
same label rules, marker ids, and ownership boundaries.

