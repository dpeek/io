# Legacy Managed Stream Contract

## Status

This document describes retained implementation details for the older
managed-stream automation. It is not the current default workflow surface.
Start with `../../io/backlog.md` and `./module-stream-workflow-plan.md` for the
current `Stream -> Feature -> Task` model.

## Historical Contract

A top-level issue enters the retained managed-stream path only when all of the
following are true:

- it has no parent
- it has the `io` label
- it has exactly one label that matches a configured module id

Legacy meaning:

- `io` opts the issue into retained backlog refresh and `@io` comment handling
- the module label, not `io`, determines module identity
- direct children inherit stream membership from `parentId`
- ambiguous module identity blocks the retained automation rather than guessing

## Historical Phase Model

The retained automation still interprets top-level issue state as the release
gate for direct child execution:

- `Todo`: retained backlog-authoring state
- `In Review`: post-refresh hold state for manual review
- `In Progress`: execution-released state for direct children
- `Done`: terminal state

Retained scheduling rules:

- automatic backlog scheduling stops once the top-level issue leaves `Todo`
- explicit backlog reruns and top-level `@io` comments can still target eligible issues in non-terminal states
- direct child execution requires the top-level issue to be `In Progress`, no active blocker, and no other active issue in the same stream
- child completion does not advance the top-level issue automatically

## Historical Module Boundaries

Module identity still comes from `workflow.modules.<id>` in `io.ts`.

Retained fields:

- `path`: canonical module root
- `docs`: default module docs added to context
- `allowedSharedPaths`: extra repo roots that still count as in-bounds for module-scoped issue refs

Each retained direct child still keeps one primary module label even when it
touches shared code.

## Historical Ownership Split

Humans still own:

- the intended outcome
- acceptance judgment
- priority and release timing
- freeform decisions, approvals, and notes in the stream brief

The retained automation still owns:

- refreshing the stream description toward the current shared stream template
- generating or updating speculative direct child issues
- writing reply comments for handled `@io` commands

The code path still assumes shared ownership of the top-level description
rather than machine-protected sections.

## Retained Limits

- this implementation is still two levels: top-level stream issue plus direct children
- the top-level phase is the only automatic release gate
- only one direct child may execute automatically per stream at a time
- the retained behavior is tuned to Linear issue states and relations
