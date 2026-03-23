# Workflow Schema

## Purpose

Describe the canonical `ops/workflow` schema slice for graph-native workflow
planning and repository-backed execution state.

This slice is the first Branch 6 schema surface. It establishes the stable type
and predicate ids for logical workflow roots plus the repository branch and
commit records that map that logical work onto git reality.

## Graph Shape

The canonical workflow slice lives alongside this doc under
`../../../../src/graph/modules/ops/workflow/`.

The exported surface is:

- `schema.ts`: backs `@io/core/graph/modules/ops/workflow` and re-exports the
  workflow entity and enum definitions
- `type.ts`: owns the entity families, state enums, reference wiring, key
  validators, and default lifecycle values

The first workflow slice currently defines:

- `WorkflowProject`
- `WorkflowRepository`
- `WorkflowBranch`
- `WorkflowCommit`
- `RepositoryBranch`
- `RepositoryCommit`
- `WorkflowBranchState`
- `WorkflowCommitState`
- `RepositoryCommitState`
- `RepositoryCommitLeaseState`

## Modeling Notes

The schema intentionally keeps logical workflow entities distinct from
repository-backed execution entities:

- `WorkflowProject`, `WorkflowRepository`, `WorkflowBranch`, and
  `WorkflowCommit` model the operator-facing workflow lineage
- `RepositoryBranch` and `RepositoryCommit` model the concrete git execution
  substrate that can realize that lineage

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

## Field Conventions

- all six entity types reuse `core:node:name` as the operator-facing title so
  existing explorer and serialization surfaces keep a stable summary field
- workflow keys stay on dedicated predicates so commands and read models can
  join on stable human-readable identifiers without depending on display names
- `RepositoryCommit.worktree.*` stays nested to preserve the worktree lease
  envelope from the Branch 6 spec without splitting it into unrelated top-level
  fields
