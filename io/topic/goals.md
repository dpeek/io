# Repo-Wide Goals

## Purpose

This document is the shared planning anchor for managed module streams in the
IO monorepo.

A backlog run for any `io`-managed parent issue should read this file before it
proposes work, rewrites the parent issue, or tops up child issues.

## Current Priorities

### 1. Make managed Linear streams practical

The repo's highest planning priority is turning the current stream-aware agent
runtime into something that works cleanly with:

- `io`-labeled managed parent issues
- package labels such as `agent`
- `@io ...` comment commands
- durable parent issue briefs
- a small, high-quality queue of ready child issues

Good work in this area improves:

- backlog quality
- operator trust
- human steering
- issue-to-stream coherence

### 2. Preserve operator visibility

IO should not become "more autonomous" at the cost of legibility.

Changes are better when they make it easier to understand:

- why the agent chose a direction
- which docs and context were used
- what changed in the parent issue
- which child issues are ready next
- whether a stream is blocked, stale, or drifting

### 3. Keep execution slices rebase-friendly

Long-lived stream branches are acceptable only if child work stays narrow.

Planning should bias toward:

- module-local changes
- explicit cross-module exceptions
- shared-interface work split into its own stream when needed
- avoiding repo-wide cleanup inside module streams

## What To Deprioritize

For now, backlog runs should deprioritize:

- broad autonomy features with weak operator visibility
- large-scale repo cleanup that is not tied to a managed stream goal
- speculative schema or UI work unrelated to the active stream direction
- backlog churn that rewrites stable child issues without a clear reason

## Shared Constraints

All managed module streams should respect these constraints:

- the human can write freeform issue descriptions and comments
- the agent owns only clearly managed sections
- the parent issue is a durable stream brief, not disposable planning text
- child issues should be execution-ready and ordered through `blockedBy`
- the backlog should stay shallow and current; target about 5 ready tasks

## Current Monorepo Focus

The first stream to prove this model should be the `agent` package.

Reason:

- the `agent` package already owns issue routing, context assembly, tracker
  interaction, stream scheduling, and operator output
- the missing workflow pieces mostly belong there
- proving the model in `agent` gives the repo a reusable pattern for later
  streams such as `graph`, `app`, and `cli`

## Key References

- `./io/topic/module-stream-workflow-plan.md`
- `./io/topic/managed-stream-comments.md`
- `./io/topic/agent.md`
- `./agent/doc/stream-workflow.md`
