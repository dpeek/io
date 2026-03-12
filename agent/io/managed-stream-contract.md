# Managed Stream Contract

## Purpose

This document is the entry point for agents working on managed parent detection, parent/child phase rules, or stream-level scheduling behavior.

## Current Managed Parent Contract

A parent issue is currently managed only when all of the following are true:

- it has no parent
- it has the `io` label
- it has exactly one label that matches a configured module id

Current meaning:

- `io` opts the parent into managed backlog refresh and `@io` comments
- the module label, not `io`, picks module identity
- child issues inherit stream membership from `parentId`
- ambiguous module identity blocks managed automation rather than guessing

## Current Stream Phase Model

The parent issue state is the automatic phase gate for the whole stream:

- `Todo`: backlog-authoring state; automatic backlog polling may still pick the parent
- `In Review`: post-backlog human hold; explicit `@io` commands still work here
- `In Progress`: execution-released state; runnable children may now execute
- `Done`: stream-complete state

Current scheduling rules:

- automatic backlog scheduling stops once the parent leaves `Todo`
- explicit backlog reruns and top-level `@io` comments can still target managed parents in non-terminal states
- child execution requires parent `In Progress`, no active blocker, and no other active issue in the same stream
- child completion does not advance the parent state automatically

## Current Module Boundaries

Module identity comes from `workflow.modules.<id>` in `io.ts`.

Current module fields already matter to managed streams:

- `path`: canonical module root
- `docs`: default module docs added to context
- `allowedSharedPaths`: extra repo roots that still count as in-bounds for module-scoped issue refs

Each managed child still keeps one primary module label even when it touches shared code.

## Current Ownership Split

Humans still own:

- the intended outcome
- acceptance judgment
- priority and release timing
- freeform decisions, approvals, and notes in the parent brief

The agent currently owns:

- refreshing the parent description toward the shared stream shape
- generating or updating speculative Todo child issues
- writing reply comments for handled `@io` commands

The code already assumes shared ownership of the parent description, not protected machine-only regions.

## Current Limits

- the model is still two levels: parent stream plus implementation children
- parent phase is the only automatic release gate; there is no separate planning-tier issue type
- only one child may execute automatically per stream at a time
- managed behavior is currently tuned for Linear issue states and relations

## Roadmap

- make stream state easier to inspect without widening the write surface
- decide whether managed backlog mutation should remain available after parent `Done`
- clarify whether any additional parent states deserve first-class meaning
- keep child payloads narrow unless a stronger planning model becomes necessary

## Future Work Suggestions

1. Add a compact matrix showing which parent states allow auto backlog, explicit backlog, and child execution.
2. Document the expected stability of module-label matching and ambiguity handling.
3. Add one example of a good managed parent brief after several reruns.
4. Clarify when cross-module work should stay a child-level exception versus become a separate stream.
5. Record which stream rules are specific to Linear today.
