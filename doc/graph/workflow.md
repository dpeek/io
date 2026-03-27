# Workflow Schema

## Purpose

Describe the canonical `workflow` schema slice for graph-native workflow
planning and repository-backed execution state.

This slice is the first Branch 6 schema surface. It establishes the stable type
and predicate ids for logical workflow roots plus the repository branch and
commit records that map that logical work onto git reality.

## Graph Shape

The canonical workflow slice now lives in
`../../lib/graph-module-workflow/src/`.

The exported surface is:

- `schema.ts`: backs `@io/graph-module-workflow` and re-exports the
  workflow entity, enum, mutation, and read-contract definitions
- `type.ts`: owns the entity families, state enums, reference wiring, key
  validators, and default lifecycle values
- `command.ts`: defines the stable `workflow-mutation` command envelope,
  summary shapes, and failure codes consumed by the authority layer
- `projection.ts`: defines the canonical workflow review scope descriptor plus
  the first Branch 3 projection ids, `definitionHash` values, dependency-key
  compilation helpers, and conservative invalidation-event builder shared
  across workflow reads and the web authority proof
- `query.ts`: defines the stable `ProjectBranchScope` branch-board contract and
  the stable `CommitQueueScope` branch-detail and commit-queue contract,
  plus the rebuildable in-memory projection helpers that materialize those
  reads from workflow, repository, and session records
  consumed by projections and operator surfaces

`workflow:` is now package-owned in `@io/graph-module-workflow`. The built-in
`core:` namespace remains owned by `@io/graph-module-core`.

The first workflow slice currently defines:

- workflow lineage entities:
  `WorkflowProject`, `WorkflowRepository`, `WorkflowBranch`, and
  `WorkflowCommit`
- repository execution entities: `RepositoryBranch` and `RepositoryCommit`
- retained execution entities:
  `AgentSession`, `AgentSessionEvent`, `WorkflowArtifact`,
  `WorkflowDecision`, `ContextBundle`, and `ContextBundleEntry`
- workflow and retained enums:
  `WorkflowBranchState`, `WorkflowCommitState`, `RepositoryCommitState`,
  `RepositoryCommitLeaseState`, `AgentSessionSubjectKind`,
  `AgentSessionKind`, `AgentSessionRuntimeState`, `AgentSessionEventType`,
  `AgentSessionEventPhase`, `AgentSessionStatusCode`,
  `AgentSessionStatusFormat`, `AgentSessionStream`,
  `AgentSessionRawLineEncoding`, `WorkflowArtifactKind`,
  `WorkflowDecisionKind`, and `ContextBundleEntrySource`

## Modeling Notes

The schema intentionally keeps logical workflow entities distinct from
repository-backed execution entities:

- `WorkflowProject`, `WorkflowRepository`, `WorkflowBranch`, and
  `WorkflowCommit` model the operator-facing workflow lineage
- `RepositoryBranch` and `RepositoryCommit` model the concrete git execution
  substrate that can realize that lineage
- `AgentSession` and `AgentSessionEvent` preserve retained execution history
  with a graph-native subject model while keeping the current
  `session | status | raw-line | codex-notification` event envelope
- `WorkflowArtifact`, `WorkflowDecision`, `ContextBundle`, and
  `ContextBundleEntry` keep direct branch, commit, repository, and session
  provenance on durable outputs and immutable context snapshots

The slice also encodes the Branch 6 v1 assumptions where schema can own them
directly:

- stable `project:`, `repo:`, `branch:`, and `commit:` key formats
- required one-parent lineage refs such as repository -> project,
  branch -> project, and commit -> branch
- default lifecycle values such as inferred projects, backlog branches,
  planned commits, unmanaged observed repository branches, and unassigned
  repository worktree leases

Cross-entity count invariants such as "one inferred project per graph" and
"one attached repository per project" remain authority-command concerns because
they depend on the current graph store rather than one field in isolation.

## Authority Command

Workflow mutations now cross the shared web authority command seam with
`kind: "workflow-mutation"`.

The command contract is intentionally one envelope with action-specific payloads
for:

- project and repository create/update
- branch and commit create/update
- branch and commit state transitions
- logical-to-repository branch attachment
- repository-commit creation and finalization

The stable failure codes exposed by the command contract are:

- `repository-missing`
- `branch-lock-conflict`
- `commit-lock-conflict`
- `invalid-transition`
- `subject-not-found`

The authority implementation keeps the first Branch 6 assumptions explicit:

- exactly one inferred workflow project per graph
- exactly one attached workflow repository per graph
- one managed repository branch per workflow branch
- one repository commit result per workflow commit
- one active commit per workflow branch

## Branch Board Query

The first stable workflow read contract in this slice is `ProjectBranchScope`.

It defines one project-scoped branch-board view with two distinct collections:

- `rows`: workflow-managed `WorkflowBranch` rows for the operator-facing board
- `unmanagedRepositoryBranches`: observed `RepositoryBranch` rows that are not
  the identity of a workflow row and must stay visually separate

The canonical request shape is:

- `projectId`: required workflow project id
- `filter.states?`: optional `WorkflowBranchStateValue[]` filter applied to managed
  workflow rows
- `filter.hasActiveCommit?`: optional active-commit filter applied to managed
  workflow rows
- `filter.showUnmanagedRepositoryBranches?`: opt-in inclusion of the separate
  unmanaged repository branch collection
- `order?`: optional ordered clauses over `queue-rank`, `updated-at`,
  `created-at`, `title`, or `state`
- `cursor?` and `limit?`: optional pagination inputs for the managed rows

The canonical result shape is:

- `project` and optional `repository` summaries for the current workflow root
- `rows[]`, where each row nests `branch` and an optional
  `repositoryBranch` observation instead of flattening repository state onto
  workflow identity
- `unmanagedRepositoryBranches[]`, returned separately from `rows`
- `freshness`, including `projectedAt`, optional `projectionCursor`, project
  repository freshness state, and the last successful repository reconcile time
- `nextCursor?` for additional managed rows

The stable failure codes exposed by the query contract are:

- `project-not-found`
- `policy-denied`
- `projection-stale`

The workflow slice now also exports `createWorkflowProjectionIndex(graph, options?)`.
It builds a rebuildable read index from the current graph client and exposes
`readProjectBranchScope(...)` and `readCommitQueueScope(...)` so downstream TUI
work can consume stable workflow read helpers without reaching into raw
workflow, repository, and session records directly.
That read helper now also exposes the canonical workflow projection metadata
for the branch board and commit queue, so projection ids and `definitionHash`
values stay shared with the authority-side scope proof instead of living in
web-local constants.
The first retained projection storage seam now shares checkpoint and row
metadata through `@io/graph-projection`, and retained workflow
reads treat `{ projectionId, definitionHash }` as the explicit compatibility
boundary. A retained row set for the right `projectionId` but the wrong
`definitionHash` is incompatible state that must rebuild, not a silent or
“missing checkpoint” fallback.
When retained workflow projection state is missing, row-incomplete, stale for
the current authority cursor, or incompatible at restart, the authority
rebuilds it deterministically from authoritative graph facts and rewrites only
the retained projection rows/checkpoints before serving reads. Callers do not
repair or merge retained rows themselves.
`createWebAppAuthority(...)` now also exposes
`rebuildRetainedWorkflowProjection()` as the explicit retained-projection
recovery seam, so later queue-driven rebuild orchestration can move off the
read path without changing the rebuild contract.
The same module export now owns the first live invalidation proof for workflow
review:

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

The first authority-owned runtime seam now lives beside the web authority in
`../../lib/app/src/web/lib/authority.ts`. `createWebAppAuthority(...)` exposes
`readProjectBranchScope(...)`, `readCommitQueueScope(...)`,
`rebuildRetainedWorkflowProjection()`, and
`planWorkflowReviewLiveRegistration(...)`, validates retained workflow
projection state against authoritative graph facts during startup recovery,
rebuilds retained rows explicitly when recovery is required, derives live
registrations from the current scoped cursor and authenticated session
principal, and maps read-policy and live-registration failures back onto
stable workflow codes such as `policy-denied`, `policy-changed`, and
`scope-changed`.
The first shipped web transport proofs for those reads and live registrations
now live in `../../lib/app/src/web/lib/workflow-transport.ts`,
`../../lib/app/src/web/lib/workflow-live-transport.ts`, and
`../../lib/app/src/web/lib/server-routes.ts`. The first shipped caller seam for the
live proof now lives in `../../lib/app/src/web/lib/workflow-review-live-sync.ts`:

- `POST /api/workflow-read`
- request body:
  `{ kind: "project-branch-scope", query: ProjectBranchScopeQuery }` or
  `{ kind: "commit-queue-scope", query: CommitQueueScopeQuery }`
- success body:
  `{ kind: "project-branch-scope", result: ProjectBranchScopeResult }` or
  `{ kind: "commit-queue-scope", result: CommitQueueScopeResult }`
- failure body: `{ error, code? }`, where stable workflow read codes such as
  `project-not-found`, `branch-not-found`, `policy-denied`, and
  `projection-stale` are preserved at the transport boundary
- `POST /api/workflow-live`
- request body:
  `{ kind: "workflow-review-register", cursor: string }`,
  `{ kind: "workflow-review-pull", scopeId: string }`, or
  `{ kind: "workflow-review-remove", scopeId: string }`
- success body:
  `{ kind: "workflow-review-register", result: WorkflowReviewLiveRegistration }`
  or
  `{ kind: "workflow-review-pull", result: { active, invalidations, scopeId, sessionId } }`
  or
  `{ kind: "workflow-review-remove", result: { removed, scopeId, sessionId } }`
- runtime model:
  live registrations are ephemeral, indexed by session, scope, and dependency
  key inside the Durable Object process, accepted workflow-affecting writes
  publish `cursor-advanced` invalidations from the authority write hook and
  queue them for matching registrations, and callers treat
  `active: false` on `workflow-review-pull` as the signal to re-register from
  the current scoped sync cursor before the next scoped refresh
- caller helper:
  `createWorkflowReviewLiveSync(sync, options)` wraps the current
  `workflow-review-register`, `workflow-review-pull`, and scoped `/api/sync`
  flow so a workflow-review client can register interest, react to
  `cursor-advanced`, and recover freshness after expiry or router loss without
  widening to whole-graph sync
- failure body: `{ error, code? }`, where stable live-registration codes such
  as `auth.unauthenticated`, `policy-changed`, and `scope-changed` are
  preserved at the transport boundary

## Workflow TUI Boundary

The first graph-backed `io tui` startup flow consumes this workflow slice
directly, but the ownership line stays explicit:

- `graph` owns the fixed workflow review sync scope descriptor,
  `createWorkflowProjectionIndex(...)`, and the stable
  `ProjectBranchScope` plus `CommitQueueScope` read contracts
- `../../lib/app/src/tui/server.ts` owns CLI parsing, graph URL selection, initial
  project-and-branch resolution, and startup failure presentation
- `../../lib/app/src/tui/startup.ts` owns the startup contract defaults and the
  `--graph-url` / workflow-config / default precedence that selects the graph
  source before hydration starts
- the first TUI hydration remains read-only: it consumes graph-backed
  projection reads and fails closed when startup cannot materialize the first
  surface rather than falling back to legacy retained-session state

## Branch Detail And Commit Queue Query

The branch-detail view paired with the TUI commit queue uses
`CommitQueueScope`.

It defines one branch-scoped detail surface with:

- `branch.branch`: the canonical `WorkflowBranchSummary`, including the
  derived branch goal summary and `activeCommitId`
- `branch.repositoryBranch?`: the attached repository-branch observation when
  one exists, reusing the same freshness envelope as the branch board
- `branch.activeCommit?`: the active commit row promoted into branch detail so
  the first TUI shell does not depend on the current page including it
- `branch.latestSession?`: the most recent branch-scoped or commit-scoped
  session summary for the selected branch
- `rows`: ordered `WorkflowCommit` queue rows with optional attached
  `RepositoryCommit` summaries
- `freshness` and `nextCursor?`: the same projection freshness and pagination
  semantics used by `ProjectBranchScope`

The canonical request shape is:

- `branchId`: required workflow branch id
- `cursor?` and `limit?`: optional pagination inputs for the ordered commit
  rows

The canonical result shape is:

- `branch`, with nested `branch`, optional `repositoryBranch`,
  optional `activeCommit`, and optional `latestSession`
- `rows[]`, where each row nests `commit` and an optional
  `repositoryCommit` realization summary
- `freshness`, reusing `projectedAt`, optional `projectionCursor`, repository
  freshness state, and the last successful repository reconcile time
- `nextCursor?` for additional commit rows

Contract rules:

- `branch.branch.goalSummary` is derived from
  `branch.branch.goalDocumentId` when that document has a non-empty
  `description`; the query does not duplicate that summary elsewhere
- `rows` are ordered by `commit.order asc`; projections may add
  deterministic tie-breakers but cannot change queue-order semantics
- `branch.activeCommit` may duplicate one row from `rows` so the active commit
  remains available even when pagination excludes it
- `branch.latestSession` summarizes the most recent branch-targeted or
  commit-targeted session attached to the selected branch
- repository execution state stays nested under `repositoryCommit` and
  `branch.repositoryBranch` so workflow identity remains distinct from git
  realization metadata

The stable failure codes exposed by the query contract are:

- `branch-not-found`
- `policy-denied`
- `projection-stale`

## Freshness And Rebuild Rules

- `createWorkflowProjectionIndex(graph, options?)` rebuilds the workflow read
  model from authoritative `WorkflowProject`, `WorkflowRepository`,
  `WorkflowBranch`, `WorkflowCommit`, `RepositoryBranch`, `RepositoryCommit`,
  and `AgentSession` records. No TUI-local state is required to recover the
  branch board or commit queue.
- the web authority read seam reuses that same rebuild-on-read path directly
  against authoritative graph state, so board and commit-queue reads do not
  depend on TUI-local caches or filtered browser sync state
- `freshness.projectedAt` records when the current in-memory projection was
  rebuilt for the read. `freshness.projectionCursor` identifies the
  authoritative-state shape used for pagination, so follow-up pages either
  stay on that projection or fail closed with `projection-stale`.
- the shipped proof boundary is authority-backed rebuildability, not retained
  projection durability. The current authority path keeps no durable workflow
  projection rows or checkpoints; it rebuilds them from authoritative
  workflow, repository, and session state on each read.
- retained workflow projection rows, restart-stable checkpoints, and other
  durable projection state remain deferred to `OPE-418`
- workflow lineage remains authoritative when repository observations are not
  current. `rows[]`, `branch.branch`, `branch.activeCommit`, and
  `branch.latestSession` still return from retained workflow state even when
  repository freshness is `stale` or `missing`.
- `ProjectBranchScopeRepositoryObservation.freshness` is per observed
  repository branch. `result.freshness.repositoryFreshness` is the
  project-level aggregate reused by both `ProjectBranchScope` and
  `CommitQueueScope`.
- `repositoryFreshness: "fresh"` means every observed `RepositoryBranch` in the
  project has `latestReconciledAt`.
- `repositoryFreshness: "stale"` means at least one observed
  `RepositoryBranch` lacks `latestReconciledAt`. Reads still succeed; callers
  keep workflow rows and retained `RepositoryCommit` summaries while treating
  attached repository-branch observations as advisory.
- `repositoryFreshness: "missing"` means there is no attached repository
  summary or no repository-branch observation materialized yet. Reads still
  succeed with workflow-only rows and no `repositoryReconciledAt`.
- `unmanagedRepositoryBranches[]` and `branch.repositoryBranch` rebuild from
  `RepositoryBranch` summaries and stay separate from workflow identity so
  stale git observations cannot overwrite managed workflow lineage.
- cursors are projection-scoped. `projection-stale` is the fail-closed result
  for lagged pagination, scope mismatch, or reuse after a projection rebuild.
  Callers discard the cursor and restart from the first page against a fresh
  projection.
- retained workflow projection durability does not change the source of truth:
  workflow, repository, and session graph facts remain authoritative, while
  retained projection rows are restart optimization only.

## Field Conventions

- all six entity types reuse `core:node:name` as the operator-facing title so
  existing explorer and serialization surfaces keep a stable summary field
- workflow keys stay on dedicated predicates so commands and read models can
  join on stable human-readable identifiers without depending on display names
- session and bundle keys extend the same stable-key convention with `session:`
  and `bundle:` prefixes
- `RepositoryCommit.worktree.*` stays nested to preserve the worktree lease
  envelope from the Branch 6 spec without splitting it into unrelated top-level
  fields
- retained event payloads keep optional typed fields for lifecycle, status,
  raw-line, and Codex-notification variants rather than splitting the envelope
  into separate entity families
