---
name: Graph module workflow commands
description: "Workflow mutation, retained session append, artifact write, and decision write commands in @io/graph-module-workflow."
last_updated: 2026-04-02
---

# Graph module workflow commands

## Read this when

- you are changing workflow write surfaces
- you need to understand which writes are packaged as typed server commands
- you are tracing the bridge between retained session storage and the v1
  workflow-session contract

## Main source anchors

- `../src/command.ts`: `workflow:mutation` and the typed workflow action union
- `../src/session-append.ts`: `workflow:agent-session-append`
- `../src/artifact-write.ts`: `workflow:artifact-write`
- `../src/decision-write.ts`: `workflow:decision-write`
- `../src/server/mutation.ts`: packaged helper for authoritative mutation
  execution
- `../src/session-append.test.ts`: retained append coverage

## What this layer owns

- the typed workflow mutation command
- the retained session append command
- retained artifact and decision write commands
- validation helpers for those command envelopes

It does not own the app-specific authority handler implementations.

## workflow:mutation

`workflow:mutation` is the main typed server-command write surface for workflow
state.

Current action families are:

- project create or update
- repository create or update
- branch create or update
- branch state changes and repository-target attachment
- commit create or update
- commit state changes and explicit `UserReview` gate set or clear
- session create or update
- repository-commit creation
- commit finalization

Important current constraints:

- mutable session writes stay narrowed to `Plan`, `Review`, and `Implement`
- mutable session status stays narrowed to `Open` and `Done`
- commit finalization outcomes are `committed`, `blocked`, and `dropped`

The command publishes stable failure codes:

- `repository-missing`
- `branch-lock-conflict`
- `commit-lock-conflict`
- `invalid-transition`
- `subject-not-found`

## Retained session append

`workflow:agent-session-append` keeps `AgentSession` and `AgentSessionEvent` as
the authoritative retained store while the operator-facing contract shifts to
`WorkflowSession`.

The important bridge exports are:

- `retainedAgentSessionKindToWorkflowSessionKind`
- `retainedAgentSessionRuntimeStateToWorkflowSessionStatus`
- `resolveWorkflowSessionKindFromAgentSessionKind(...)`
- `resolveWorkflowSessionStatusFromAgentSessionRuntimeState(...)`

Current mapping rules:

- `planning -> Plan`
- `review -> Review`
- `execution -> Implement`
- `running | awaiting-user-input | blocked -> Open`
- `completed | failed | cancelled -> Done`

The append validator is fail closed:

- missing subjects reject
- skipped or conflicting event sequences reject
- oversized events reject
- exact retries acknowledge as duplicates without advancing sequence state

## Artifact and decision writes

`workflow:artifact-write` persists retained workflow outputs tied to one
session.

Current content rule:

- a write must provide either `bodyText` or `blobId`, but not both

`workflow:decision-write` persists retained decisions tied to one session.

Current validation rule:

- `summary` must be non-empty
- `blocker` decisions must also provide non-empty `details`

Both command surfaces are `serverOnly` and publish explicit predicate-touch
policy metadata.

## Packaged server helper

`runWorkflowMutationCommand(...)` is the package-local helper that runs one
workflow mutation through an authoritative store.

It:

- plans the graph transaction against a snapshot
- skips authority writes when the mutation is a no-op
- applies server-command writes through the provided authority
- threads back `cursor` and `replayed` onto the result

That helper is transport-neutral. It is not a web route handler.

## Practical rules

- Keep workflow writes behind these typed commands.
- Keep retained session history append-only and sequence-checked.
- Keep host-specific transport or authorization wiring outside this package.
