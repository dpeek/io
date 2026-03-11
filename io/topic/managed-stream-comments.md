# Managed Stream Comments

## Purpose

This document defines the preferred operator workflow for managed module
streams in Linear.

The model is:

- labels identify what the issue is
- comments tell the agent what to do next

## Managed Issue Identity

A parent issue is managed when it has:

- the label `io`
- exactly one package label such as `agent`

The package label resolves to the module path through a checked-in registry.

Examples:

- `agent` -> `./agent`
- `graph` -> `./graph`
- `app` -> `./app`

## User Workflow

The intended operator flow is:

1. create a parent issue in Linear
2. add the labels `io` and the package label
3. write whatever freeform description is useful
4. comment `@io ...` with the request
5. let the agent reorganize managed sections and child backlog state

Examples:

- `@io backlog`
- `@io review this stream and clean up the parent brief`
- `@io expand the runtime/context direction into subtasks`
- `@io top this stream back up to 5 ready tasks`

## Description Ownership

The issue description should have two conceptual layers:

- human-authored notes, constraints, references, and intent
- agent-owned managed sections

The agent should rewrite only the managed sections.

Recommended managed sections:

- current summary
- current focus
- proposal options
- selected direction
- child backlog state
- latest action summary

## Comment Semantics

Any comment containing `@io` is a request to the agent.

Interpretation rules:

- `@io` is the trigger
- the rest of the comment is freeform intent
- the agent should interpret the request in the context of the parent issue,
  labels, child issues, and repo docs

This should stay natural-language oriented.

Do not require a strict slash-command grammar for the first version.

## Event Handling

The clean implementation path is:

- subscribe to Linear comment events
- detect comments containing `@io`
- fetch the full issue plus children and relations
- perform the requested planning action
- reply in the thread with a short action summary

The first version should probably process:

- comment creation events only

Later versions can optionally process:

- edited comments when the body changes and still contains `@io`

## Tracking Seen Comments

The runtime needs durable state for handled comments.

Track at least:

- `commentId`
- `issueId`
- `bodyHash`
- `createdAt`
- `updatedAt`
- `handledAt`
- `result`

Why:

- webhook retries must not cause duplicate work
- comment edits need a deliberate policy
- operators need a replay/debug trail when the backlog changes

Prefer tracking by comment ID rather than only by timestamp.

## Agent Behavior

When handling `@io ...` on a managed parent issue, the agent should:

- resolve the module path from the package label
- read `./io/topic/goals.md`
- read the module-specific docs and relevant code
- inspect the current parent issue and child backlog state
- interpret the user request
- update the managed sections of the parent issue
- create, update, or reorder child issues if needed
- post a reply comment summarizing what changed

## Guardrails

Keep the workflow tight:

- only `io`-labeled issues are managed this way
- only one package label should define the module identity
- active child issues should not be rewritten except for clarifications
- child issues should stay module-local unless explicitly marked
- the backlog target should stay around 5 ready tasks

## Key References

- `./io/topic/goals.md`
- `./io/topic/module-stream-workflow-plan.md`
- `./io/topic/agent.md`
- `./agent/doc/stream-workflow.md`
