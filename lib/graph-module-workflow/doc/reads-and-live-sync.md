---
name: Graph module workflow reads and live sync
description: "Scope reads, read-client request kinds, session-feed contract, and live refresh in @io/graph-module-workflow."
last_updated: 2026-04-02
---

# Graph module workflow reads and live sync

## Read this when

- you are changing workflow scope result contracts
- you need to understand the packaged client read or live-sync surfaces
- you are wiring browser session-feed reads or mutation-time scope refresh

## Main source anchors

- `../src/query.ts`: workflow scope query and result contracts
- `../src/client/read.ts`: packaged workflow read request and response surface
- `../src/client/session-feed.ts`: session-feed selection and read contract
- `../src/client/live.ts`: live review-scope refresh client
- `../src/query-executors.ts`: executor planning for built-in workflow surfaces

## What this layer owns

- the typed scope read contracts for workflow projections
- the packaged browser read request and response envelope
- the session-feed route contract and selection logic
- the live review-scope refresh client

It does not own the actual app route implementations.

## Scope result contracts

The package currently publishes three main scope read models:

- `ProjectBranchScope`
- `CommitQueueScope`
- `MainCommitWorkflowScope`

Their role split is:

- `ProjectBranchScope`: project-level branch board and repository observations
- `CommitQueueScope`: one branch detail plus ordered commit queue
- `MainCommitWorkflowScope`: commit-first browser view over one project's main
  branch

The read contracts also keep freshness explicit through projected-at and
projection-cursor metadata rather than hiding stale retained state.

## Read-client surface

`client/read.ts` packages the browser read transport contract.

Current request kinds are:

- `main-commit-workflow-scope`
- `project-branch-scope`
- `commit-queue-scope`
- `session-feed`

`requestWorkflowRead(...)` is the transport-neutral client helper:

- POSTs JSON to the workflow-read path
- decodes the typed result on success
- throws `WorkflowReadClientError` on non-OK responses

It is a client contract, not the route implementation.

## Session-feed contract

`client/session-feed.ts` packages the browser contract for retained workflow
session history.

Important rules:

- branch selection remains the outer route context
- commit selection is the primary browser session subject
- if no `session` is configured, the feed reads the latest session for the
  selected subject
- if `session` is configured, the feed stays pinned instead of silently
  switching
- stale commit or session selections surface explicitly as stale-selection
  states

The feed result also keeps history and finalization state explicit instead of
flattening retained execution into one generic transcript blob.

## Live refresh

`createWorkflowReviewLiveSync(...)` builds the packaged live refresh client for
the workflow review scope.

It wraps `createModuleLiveScopeRefreshController(...)` over
`workflowReviewModuleReadScope` and defaults to the workflow live path.

That makes the live client package-owned while leaving the actual live endpoint
implementation outside the package.

## Practical rules

- Change `query.ts` when the packaged workflow read model changes.
- Change `client/read.ts` when the public workflow read request kinds change.
- Keep app route handling and Durable Object wiring outside the package.
