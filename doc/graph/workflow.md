# Workflow Schema

## Purpose

Describe the canonical Branch 6 schema surface for browser-first v1 workflow.

This doc now prioritizes the operator-facing contract from
[`../branch/06-workflow-and-agent-runtime.md`](../branch/06-workflow-and-agent-runtime.md)
and
[`../agent/browser-first-workflow-v1-plan.md`](../agent/browser-first-workflow-v1-plan.md).
The current package still carries broader repository and TUI-oriented records;
those remain valid only when they support the smaller v1 contract.

## Current Code Surface

The canonical workflow slice lives in `../../lib/graph-module-workflow/src/`.

Key exports:

- `schema.ts`: package export surface for `@io/graph-module-workflow`
- `type.ts`: workflow entities, enums, keys, and retained-record definitions
- `command.ts`: `workflow-mutation`, summaries, and commit finalization types
- `projection.ts`: workflow review projection metadata and invalidation helpers
- `query.ts`: project and commit-queue read contracts
- `client/session-feed.ts`: route-level workflow session feed contract used by
  browser workflow reads

`workflow:` remains package-owned in `@io/graph-module-workflow`. The built-in
`core:` namespace remains owned by `@io/graph-module-core`.

## V1 Priorities

The first browser milestone should keep the schema focused on these rules:

- one inferred `WorkflowProject`
- one attached `WorkflowRepository`
- one operator-visible `WorkflowBranch`: `main`
- a commit queue as the primary workflow surface
- explicit workflow sessions
- one `UserReview` gate
- authoritative retained session, artifact, and decision history
- no separate `WorkflowRun`

## Primary Entities

### `WorkflowProject`

`WorkflowProject` remains the logical root.

V1 expectation:

- exactly one operator-visible project per graph

### `WorkflowRepository`

`WorkflowRepository` remains the attached execution substrate.

V1 expectations:

- exactly one attached repository
- `main` is the default base branch for workflow commits

### `WorkflowBranch`

`WorkflowBranch` remains in the lineage, but it is secondary in v1.

V1 expectations:

- exactly one visible branch record: `main`
- branch context remains useful for prompt assembly
- branch inventory is not the primary browser workflow surface
- `type.ts` now codifies this browser-first contract in `workflowV1Branch`
  with required `slug`, `name`, `context`, and `references`

### `WorkflowCommit`

`WorkflowCommit` is the main operator-facing record.

Recommended v1 lifecycle:

```ts
type WorkflowCommitState = "Todo" | "Open" | "Done";
type WorkflowCommitGate = "None" | "UserReview";
```

Recommended operator-facing fields:

- `slug`
- `name`
- `order`
- `state`
- `gate`
- `context`
- `references`
- git metadata for branch name, worktree path, and final SHA

`type.ts` now codifies this operator-facing contract in `WorkflowCommit`,
`workflowV1Commit`, `workflowV1CommitStateValues`, and
`workflowV1CommitGateValues`.

### `WorkflowSession`

The product model should treat sessions explicitly:

```ts
type WorkflowSessionKind = "Plan" | "Review" | "Implement" | "Merge";
type WorkflowSessionStatus = "Todo" | "Open" | "Done";
```

Current storage note:

- `type.ts` still defines `AgentSession` and `AgentSessionEvent`
- that storage shape is acceptable while browser-first v1 ships
- the operator-facing contract should still speak in `WorkflowSession` terms
- what matters is commit-centric session selection, correct session-kind
  semantics, and retained recovery

The workflow module now makes that bridge explicit:

- `type.ts` exports `WorkflowSession`, `workflowV1Session`,
  `workflowV1SessionKindValues`, and `workflowV1SessionStatusValues`
- `session-append.ts` exports
  `retainedAgentSessionKindToWorkflowSessionKind` and
  `retainedAgentSessionRuntimeStateToWorkflowSessionStatus` so the retained
  runtime maps cleanly onto the smaller v1 session contract

### Retained outputs and implementation records

`WorkflowArtifact` and `WorkflowDecision` remain first-class retained outputs.

`RepositoryBranch`, `RepositoryCommit`, `ContextBundle`, and
`ContextBundleEntry` may still exist in the graph, but they are not the
primary operator contract for the first browser milestone. They support local
git execution, retained history, and future expansion.

## Current Code Vs V1 Simplification

The current code still exports broader state spaces:

- `WorkflowBranchState = backlog | ready | active | blocked | done | archived`
- `WorkflowCommitState = planned | ready | active | blocked | committed | dropped`
- `AgentSessionKind = planning | execution | review`
- repository branch and commit records still appear in summaries and queries

That is acceptable during the migration, but this broader storage model is now
transitional. Browser-facing and agent-facing workflow reads should collapse
those details down to the smaller v1 operator model:

- one visible `WorkflowBranch` record: `main`
- commit-first reads and mutations
- explicit review gating rather than overloading commit state
- session semantics that distinguish `Plan`, `Review`, `Implement`, and
  `Merge`

The workflow module now codifies that target product model directly even
though the broader stored enums and retained record names still exist
underneath.

Implementation rule:

- when broader stored enums remain, reads should project them down to the
  smaller operator contract instead of widening the product again

## Mutation Model

### Current typed workflow command

`command.ts` already defines `workflow-mutation` for:

- project and repository create or update
- branch and commit create or update
- commit state transitions plus explicit `UserReview` gate set and clear
- commit-scoped workflow session create or update
- `finalizeCommit`
- transitional repository-commit creation for local runtime realization

Stable failure codes:

- `repository-missing`
- `branch-lock-conflict`
- `commit-lock-conflict`
- `invalid-transition`
- `subject-not-found`

### Required v1 mutation surface

The v1 workflow contract should interpret or extend those seams to cover:

- singleton project, repository, and `main` branch provisioning
- commit create or update as the main operator action
- commit context and reference updates from `Plan` and `Review`
- session create or update and follow-on session creation
- setting and clearing `UserReview`, plus gate reason and provenance
- commit finalization by `committed | blocked | dropped`
- separate retained session append, decision write, and artifact write commands

Rules:

- keep workflow writes behind typed commands
- do not teach the browser or agent to manipulate raw workflow entities
  directly
- keep repository branch and commit writes as local-runtime and authority
  implementation details
- while broader stored enums remain, the current `UserReview` gate may still
  persist through the stored blocked commit state as long as reads and mutation
  summaries project that back to the gate-oriented v1 contract

Current retained-storage note:

- `createSession` and `updateSession` map onto `AgentSession`
- the narrowed mutation surface currently supports the v1 session kinds with a
  distinct retained mapping today: `Plan | Review | Implement`
- queued `Todo` sessions and distinct retained `Merge` session storage remain
  deferred until the stored session model grows beyond the current retained
  runtime shape

### Commit finalization

`finalizeCommit` stays commit-centric.

Canonical outcomes:

- `committed`: persist the final git result and mark the workflow commit done
- `blocked`: finalize the current attempt without producing a landed git commit
- `dropped`: stop the commit without landing it

The outcome is about the workflow commit. `RepositoryCommit` remains a concrete
git record, not the primary operator-facing unit of work.

## Read Model

### Primary browser read: commit queue

`CommitQueueScope` should be the primary browser workflow read.

V1 expectations:

- one selected visible branch: `main`
- ordered commit queue rows
- selected commit detail
- current gate state
- latest or next session summary for the selected commit

### Secondary read: branch summary

`ProjectBranchScope` may remain in the package, but it is secondary in v1.

Use it for:

- project and branch header context
- lightweight inspection
- TUI and transition-period surfaces

Do not use it as the primary navigation model for the first browser-launched
session.

Current scoped review-sync notes:

- review-scope registrations compile to
  `scope:workflow:review`,
  `projection:workflow:project-branch-board`, and
  `projection:workflow:branch-commit-queue`
- any accepted write that touches a workflow entity type conservatively emits
  that full dependency-key set, even when only one workflow projection may have
  changed
- `createWorkflowReviewInvalidationEvent(...)` currently emits only
  `cursor-advanced` delivery with the workflow review scope id and both
  workflow projection ids attached; direct scoped deltas stay out of scope for
  the current proof
- `compileWorkflowReviewScopeDependencyKeys()` is the shared dependency-key
  planner used by the first live registration proof, so the authority and
  router agree on the scope and projection fan-out set
- the current web proof delivers those invalidations through
  `workflow-review-pull`, so callers react by scoped `/api/sync` re-pull, and
  only re-register from their current scoped cursor when a pull reports
  `active: false`
- the same package-root surface now also exports
  `workflowReviewModuleReadScopeRegistration` and
  `workflowReviewRetainedProjectionProviderRegistration`, so the host installs
  workflow review through the shared Branch 3 registration seam instead of
  editing hard-coded scope/projection branches in
  `../../lib/app/src/web/lib/authority.ts`

### Primary retained-session read

The workflow session feed is part of the core v1 contract.

The route and read shape now live in:

- `../../lib/graph-module-workflow/src/client/session-feed.ts`
- `../../lib/app/src/web/lib/workflow-session-feed.ts`

V1 rules:

- branch selection remains the outer route context
- commit selection is the primary browser session subject
- when `session` is absent, read the latest session for that selected subject
- when `session` is present, stay pinned to that session instead of silently
  switching
- authoritative graph history is the recovery source after reload or reconnect

### TUI boundary

The TUI may keep consuming broader branch-board helpers during the transition,
but that does not change the browser-first v1 contract. Query and projection
helpers should move toward the same commit-first semantics instead of
maintaining separate product models.

## Git And Retained Execution Model

The graph still needs concrete git realization records, but they are secondary
to the operator-facing contract.

- `RepositoryBranch` and `RepositoryCommit` record real git state when the
  local runtime needs it
- each `WorkflowCommit` owns one git branch and one worktree
- one eventual git commit maps back to one `WorkflowCommit`
- `AgentSession` and `AgentSessionEvent` remain the authoritative retained
  runtime history until or unless the storage names are narrowed later
- browser-first v1 currently maps retained `planning -> Plan`,
  `review -> Review`, and `execution -> Implement`
- retained runtime states map to `WorkflowSession.status` as
  `running | awaiting-user-input | blocked -> Open` and
  `completed | failed | cancelled -> Done`
- `WorkflowArtifact` and `WorkflowDecision` keep session and commit provenance
  on durable outputs
- `ContextBundle` may remain a retained implementation detail until direct
  branch, commit, and session context assembly needs immutable snapshots

## Field And Naming Conventions

- stable keys stay explicit: `project:`, `repo:`, `branch:`, `commit:`,
  `session:`, and `bundle:`
- keep one-parent lineage stable: repository -> project, branch -> project,
  commit -> branch
- `main` is the only operator-visible branch key in v1
- commit and session context should live on explicit workflow fields or
  workflow-owned docs, not in ad hoc browser-only state
- the schema should not reintroduce a separate `WorkflowRun` unless later retry
  or detached finalization behavior proves it necessary
