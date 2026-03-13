# Legacy Managed Stream Backlog Refresh

## Status

This document describes the retained direct-child backlog sync path. It is not
the default planning workflow. The current planning contract is the interactive
stream workflow in `../../io/backlog.md`.

## Historical Stream Brief Shape

The retained backlog refresh still rewrites top-level stream descriptions
toward one shared shape:

- `Summary`
- `Focus`
- `Goals`
- `Roadmap`
- `Guardrails`
- `References`

Retained behavior:

- the refresh rewrites the stream description directly instead of maintaining protected blocks
- useful human-authored sections such as decisions, approvals, risks, and notes are preserved when possible
- `Roadmap` items remain the canonical input for rebuilding speculative direct-child backlog
- repo-relative references are preferred because they are useful for both humans and later reruns

## Historical Child Payload

Retained direct child issues still use a stable execution-step description shape:

- `Outcome`
- `Scope`
- `Acceptance Criteria`
- `Module Scope`
- `Dependencies And Docs`
- `Out Of Scope`

Retained child defaults:

- state starts at `Todo`
- priority inherits from the top-level stream issue unless explicitly changed
- one primary module label is retained
- dependency ordering is expressed through `blockedBy`
- docs requested by the refresh or `@io backlog` are attached to the child payload

## Historical Rerun Behavior

The retained maintenance loop still distinguishes between durable work and
speculative tail work:

- active, in-review, and done children are preserved
- untouched `Todo` children are the main rewrite surface
- matching existing `Todo` children are reused before creating new ones
- dependency edges are relinked when ordering changes
- the backlog is usually topped back up to a short tail rather than replanned from scratch

## Historical Bootstrap And Release

- a successful retained backlog pass moves the top-level issue to `In Review`
- new or refreshed direct child issues remain `Todo`
- the top-level issue must move to `In Progress` before child execution can start
- child success moves only the child to `Done`

This retained planning path still uses one top-level stream issue plus direct
children, so it does not model the current feature tier.

## Retained Guardrails

- child issues should stay centered on one primary module surface
- cross-module work should be explicit in the child description rather than implied
- backlog refresh should avoid destructive rewrites of already active or completed children
- the agent should report created, reused, updated, and relinked backlog state clearly enough for operator review
