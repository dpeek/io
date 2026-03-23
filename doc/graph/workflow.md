# Workflow Schema

## Purpose

Describe the canonical `ops/workflow` schema slice for graph-native workflow
planning and repository-backed execution state.

This slice is the first Branch 6 schema surface. It establishes the stable type
and predicate ids for logical workflow roots plus the repository branch and
commit records that map that logical work onto git reality.

## Graph Shape

The canonical workflow slice lives alongside this doc under
`../../src/graph/modules/ops/workflow/`.

The exported surface is:

- `schema.ts`: backs `@io/core/graph/modules/ops/workflow` and re-exports the
  workflow entity, enum, and command definitions
- `type.ts`: owns the entity families, state enums, reference wiring, key
  validators, and default lifecycle values
- `command.ts`: defines the stable `workflow-mutation` command envelope,
  summary shapes, and failure codes consumed by the authority layer

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
