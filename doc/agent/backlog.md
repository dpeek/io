# Linear Workflow

We are updating out backlog in Linear using MCP

## Issue types

1. `Branch`: long-lived workstream for a subsystem
2. `Commit`: commitable chunk of work within a branch
3. `Session`: one execution session inside a commit

## Workflow

1. Read the backlog + docs + code
2. Ask questions if there is ambiguity

When I say:

- "update branch" update branch issue description
- "add commits" create next commit issue
- "add sessions" create session issues under next commit issue

## Issues

- Project "IO"
- Status "Todo"
- No labels / dependencies

## Branch description

```
## Summary

- what surface this stream owns
- why it matters now

## Focus

- the current decision or delivery focus
- what is intentionally not in focus yet

## Goals

- concrete outcomes this stream must achieve
- user-visible or integration-visible success conditions

## Roadmap

1. feature-sized milestones in likely delivery order
2. notes on where parallel feature work is safe
3. known sequencing constraints

## Guardrails

- architectural constraints
- compatibility or rollout constraints
- merge/conflict concerns the user should be aware of

## References

- issue links
- docs
- code surfaces
```

## Commit expectations

- each commit should have a detailed description
- include scope, acceptance criteria, expected outcome, and key references
- commits are backlog/planning containers plus branch owners
- sessions should roll up cleanly into exactly one feature

## Session expectations

- sessions are narrow execution sessions
- each session should be independently completable in one agent run
- sessions should not duplicate acceptance criteria already owned by the commit
