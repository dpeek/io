# Branch 6 Canonical: Workflow And Agent Runtime

## Overview

### Mission

Move branch backlog, commit planning, sessions, artifacts, and context
retrieval into the graph so one TUI can manage both backlog and in-flight work
for a real project.

### Why This Is A Separate Branch

The repo already has a useful agent runtime, but it is still organized around
Linear issues and a `stream -> feature -> task` taxonomy. The next product step
is different: the operator wants to see actual project branches, keep the
backlog filled inside the same surface, and launch Codex directly in the
context of one branch.

This branch therefore treats git-backed workflow as a first-class product
capability rather than an adapter around an external tracker.

### In Scope

- graph-native `project -> branch -> commit -> session[]` workflow taxonomy
- git-backed branch inventory for one current project root
- branch end-state document reference and summary fields
- commit queue and commit-level finalization records
- branch-scoped and commit-scoped Codex session launch from the TUI
- retained session, artifact, decision, and context-bundle history
- TUI-first backlog and in-flight operator loop
- agent runtime changes needed to consume graph-native branch and commit state

### Out Of Scope

- compatibility layers, mirroring, or dual-write with Linear
- rich Markdown editing for large planning documents
- generalized multi-project planning heuristics
- stacked-branch orchestration beyond one active commit per branch in the first
  milestone
- replacement of git itself, local worktrees, or repo-local command execution

### Durable Contracts Owned

- workflow project, branch, and commit entity model
- branch-scoped session lifecycle model
- artifact and decision provenance model
- context-bundle shape for branch or commit execution
- git reconciliation boundary between graph state and local repo state

### Likely Repo Boundaries

- `src/agent/`
- future workflow-engine and context-retrieval packages
- graph-native workflow modules
- TUI branch and session surfaces

### Dependencies

- Branch 1 for graph persistence and writes
- Branch 2 for principal-aware permissions
- Branch 3 for scoped retrieval of project, branch, and session views
- Branch 4 for workflow descriptors as installable module features

### Downstream Consumers

- Branch 7 needs workflow and operator surfaces
- future module workflows can schedule branch or commit work onto this runtime

### First Shippable Milestone

Run one real project end to end in the TUI: inspect backlog branches and
active branches beside the current git branch inventory, inspect the commit
queue for a selected branch, launch Codex in branch context, and write session
history, artifacts, and decisions through the graph.

### Done Means

- one real workflow loop exists only in graph-native project, branch, and
  commit records plus actual git refs
- the TUI shows backlog, in-flight work, and current project branches together
- an operator can start a Codex session in the context of a selected branch
- the agent can retrieve a branch-specific or commit-specific context bundle
- the agent writes session, artifact, and decision records back to the graph
- no external tracker is required for planning or execution

### First Demo

Open the TUI, view one project's backlog branches plus local git branches,
select a branch, inspect its end-state summary and commit queue, launch Codex
against that branch, and inspect the resulting session history and artifacts in
the graph after restart.

### What This Unlocks

- one operator surface for backlog and in-flight work
- graph-native planning without a tracker dependency
- durable branch memory and commit history
- branch-aware web and TUI operator surfaces in Branch 7

### Source Anchors

- `doc/02-current-state-architecture.md`
- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`

## 1. Purpose

This branch owns the graph-native workflow model and agent runtime contract for
git-backed project work.

The key product pressure is simple: the operator does not want four tools open
just to keep work moving. They want one place to:

- see backlog work
- see in-flight branches
- inspect the current project's real git branches
- launch an interactive Codex session in the context of one branch
- manage the commit queue that will land on that branch

That pushes the workflow model toward actual git objects and away from external
tracker semantics. The first stable model should therefore not attempt to
recreate Linear inside the graph. It should model the work in the units the
operator already uses:

- a project
- a long-running branch with one desired end-state
- a queue of commit-sized execution slices inside that branch
- one or more agent sessions that help plan or execute those slices

Important naming note:

- the docs under `doc/branch/` use "branch" to mean a delivery workstream
- this Branch 6 spec uses `WorkflowBranch` to mean a git-backed work branch

Those are different concepts. This spec intentionally picks the git-backed
meaning because that is the operator-facing workflow the TUI must show.

Stability target for this branch:

- `stable`: workflow project, branch, and commit lineage; session envelope;
  artifact and decision provenance; context-bundle shape; branch lock and
  worktree reservation model
- `provisional`: backlog ordering heuristics, git health summaries, branch-doc
  storage strategy, commit ranking, and operator summary projections
- `future`: multi-project scheduling, stacked commit branches, automatic branch
  splitting or merging heuristics, and cross-repo delegation

## 2. Scope

### In scope

- graph-native workflow taxonomy for project, branch, and commit
- graph-native branch records backed by real git branch names
- branch document references or summaries for desired end-state planning
- commit queue records and commit-level finalization metadata
- branch-scoped or commit-scoped session, artifact, decision, and
  context-bundle records
- retained execution history usable after process restart
- the contract boundary between local git execution substrate and graph-owned
  workflow state
- a TUI read model for backlog branches, in-flight branches, commit queues, and
  current project branch inventory
- agent runtime changes needed so `src/agent/service.ts`,
  `src/agent/context.ts`, `src/agent/workspace.ts`, and `src/agent/tui/*` can
  consume graph-native branch and commit state

### Out of scope

- replacement of git refs, worktrees, or repo-local command execution
- full branch-document editing in the TUI
- a generalized planner for every future workflow family
- browser-first operator flows before the TUI loop works
- tracker compatibility layers, mirroring, or dual-write
- arbitrary distributed queue scans across many projects in the first milestone

### Upstream assumptions

- Branch 1 owns graph ids, fact storage, authoritative transactions, cursor
  ordering, and durable persistence
- Branch 2 owns principal identity, predicate visibility, capability checks,
  and secret access boundaries
- Branch 3 owns project, branch, and session scope reads plus live invalidation
- Branch 4 owns workflow descriptors as installable module features

## 3. Core Model

### Canonical module boundary

Inference: the first built-in schema slice for this branch should still ship as
one `ops/workflow` module. The taxonomy changes, but the install boundary does
not. Workflow stays a platform capability rather than a repo-local convention.

### Design choice: no separate `Run` in the first milestone

The existing runtime uses a `run` concept because work is claim-based and
issue-oriented. The proposed git-native model does not need that extra layer to
start.

Milestone-one rule:

- the authoritative execution record is `AgentSession`
- a session targets either a branch or a commit
- if the operator wants another attempt, start another session

Only add a separate `WorkflowRun` later if retry semantics, detached
finalization, or noninteractive batch execution make it necessary. Starting
without it keeps the first graph schema closer to the workflow the operator
actually thinks in.

### Owned entities

`WorkflowProject`

- one repo root and operator working context
- anchors backlog, branch inventory, and session history for one project
- stores base branch defaults and repo identity

`WorkflowBranch`

- long-running git-backed stream of work inside one project
- represented by one canonical git branch name
- owns one desired end-state summary and optional document reference
- parent of zero or more `WorkflowCommit` records

`WorkflowCommit`

- smallest execution and finalization unit inside a branch
- represents one intended git commit, not a tracker issue
- may reserve a worktree while active
- carries resulting git commit metadata after finalization

`AgentSession`

- one LLM session
- may target the branch as a whole for planning or the active commit for
  execution
- authoritative retained record for what happened during that interaction

`AgentSessionEvent`

- append-only ordered event envelope for session lifecycle changes, status
  lines, raw output lines, and Codex notifications
- durable event history replaces file-only replay

`WorkflowArtifact`

- durable output produced by a session, including branch plans, patch
  summaries, commit notes, docs, screenshots, exported files, or transcript
  fragments

`WorkflowDecision`

- durable decision or blocker record written during or after a session
- captures operator-visible reasoning that should outlive the terminal

`ContextBundle`

- immutable branch-specific or commit-specific context bundle chosen for one
  session
- the retrieval unit Codex consumes before execution

`ContextBundleEntry`

- ordered member of a `ContextBundle`
- preserves source, order, and inclusion reason for one retrieved item

### Canonical identifiers

- every entity above uses a graph node id owned by Branch 1
- each project, branch, commit, and session also has a human-readable stable
  key inside one graph, for example:
  - `project:io`
  - `branch:workflow-graph-native`
  - `commit:branch-runtime-view`
  - `session:branch-runtime-view-plan-01`
- `WorkflowBranch.branchKey` remains stable even if the display title changes
- `WorkflowCommit.commitKey` remains stable across replanning of the same
  commit-sized slice
- `AgentSession.sessionKey` is stable within one project
- `ContextBundle.bundleKey` is unique per session and immutable after creation

### Canonical interfaces

```ts
type WorkflowBranchState = "backlog" | "ready" | "active" | "blocked" | "done" | "archived";

type WorkflowCommitState = "planned" | "ready" | "active" | "blocked" | "committed" | "dropped";

interface WorkflowProject {
  id: string;
  projectKey: string;
  title: string;
  repoRoot: string;
  defaultBaseBranch: string;
  mainRemoteName?: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowBranch {
  id: string;
  projectId: string;
  branchKey: string;
  title: string;
  state: WorkflowBranchState;
  queueRank?: number;
  goalSummary: string;
  goalDocumentPath?: string;
  goalDocumentBlobId?: string;
  git: {
    branchName: string;
    baseBranchName: string;
    upstreamName?: string;
    headSha?: string;
    worktreePath?: string;
    latestReconciledAt?: string;
  };
  activeCommitId?: string;
  latestSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowCommit {
  id: string;
  branchId: string;
  commitKey: string;
  title: string;
  description?: string;
  state: WorkflowCommitState;
  order: number;
  parentCommitId?: string;
  worktree?: {
    path?: string;
    branchName?: string;
    leaseState: "unassigned" | "reserved" | "attached" | "released";
  };
  resultingCommit?: {
    sha: string;
    title?: string;
    committedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

type AgentSessionSubject =
  | {
      kind: "branch";
      branchId: string;
    }
  | {
      kind: "commit";
      branchId: string;
      commitId: string;
    };

type AgentSessionKind = "planning" | "execution" | "review";

type AgentSessionRuntimeState =
  | "running"
  | "awaiting-user-input"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

interface AgentSessionRecord {
  id: string;
  projectId: string;
  sessionKey: string;
  kind: AgentSessionKind;
  subject: AgentSessionSubject;
  workerId: string;
  threadId?: string;
  turnId?: string;
  runtimeState: AgentSessionRuntimeState;
  contextBundleId?: string;
  startedAt: string;
  endedAt?: string;
}

type AgentSessionEvent =
  | {
      type: "session";
      phase: "scheduled" | "started" | "completed" | "failed" | "stopped";
      sessionId: string;
      sequence: number;
      timestamp: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "status";
      code:
        | "ready"
        | "idle"
        | "branch-selected"
        | "commit-selected"
        | "branch-blocked"
        | "commit-blocked"
        | "commit-created"
        | "commit-finalized"
        | "thread-started"
        | "turn-started"
        | "turn-completed"
        | "turn-cancelled"
        | "turn-failed"
        | "waiting-on-user-input"
        | "agent-message-delta"
        | "agent-message-completed"
        | "command"
        | "command-output"
        | "command-failed"
        | "approval-required"
        | "tool"
        | "tool-failed"
        | "error";
      format: "line" | "chunk" | "close";
      sessionId: string;
      sequence: number;
      timestamp: string;
      text?: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "raw-line";
      stream: "stdout" | "stderr";
      encoding: "jsonl" | "text";
      sessionId: string;
      sequence: number;
      timestamp: string;
      line: string;
    }
  | {
      type: "codex-notification";
      sessionId: string;
      sequence: number;
      timestamp: string;
      method: string;
      params: Record<string, unknown>;
    };

interface WorkflowArtifact {
  id: string;
  projectId: string;
  branchId: string;
  commitId?: string;
  sessionId: string;
  kind:
    | "branch-plan"
    | "commit-plan"
    | "patch"
    | "doc"
    | "summary"
    | "command-log"
    | "screenshot"
    | "file"
    | "transcript";
  title: string;
  mimeType?: string;
  bodyText?: string;
  blobId?: string;
  createdAt: string;
}

interface WorkflowDecision {
  id: string;
  projectId: string;
  branchId: string;
  commitId?: string;
  sessionId: string;
  kind: "plan" | "question" | "assumption" | "blocker" | "resolution";
  summary: string;
  details?: string;
  createdAt: string;
}

interface ContextBundle {
  id: string;
  bundleKey: string;
  sessionId: string;
  subject: AgentSessionSubject;
  renderedPrompt?: string;
  sourceHash: string;
  createdAt: string;
}

interface ContextBundleEntry {
  id: string;
  bundleId: string;
  order: number;
  source:
    | "builtin"
    | "entrypoint"
    | "registered"
    | "repo-path"
    | "synthesized"
    | "graph"
    | "artifact"
    | "decision";
  refId?: string;
  path?: string;
  title: string;
  bodyText?: string;
  blobId?: string;
}
```

### Lifecycle states

Projects:

1. registered with repo root and default base branch
2. reconciled against local git state
3. used as the operator context for backlog and session launch

Branches:

1. created in `backlog` or `ready`
2. linked to one canonical git branch name
3. moved to `active` when the operator is working it
4. may enter `blocked`
5. ends as `done` or `archived`

Commits:

1. created in `planned` or `ready`
2. ordered inside one branch
3. one commit at a time moves to `active` in the first milestone
4. may enter `blocked`
5. ends as `committed` or `dropped`

Sessions:

1. created against a branch or commit
2. assigned an immutable context bundle
3. emit ordered event records
4. end as `completed`, `failed`, or `cancelled`

Artifacts and decisions:

1. created during a session
2. never mutated in place except for safe metadata corrections
3. remain attached to the branch or commit even if later sessions continue the
   work

Context bundles:

1. assembled before execution
2. frozen for one session
3. never retroactively edited
4. replaced by a new bundle on a new session if inputs change

### Relationships

- each `WorkflowBranch` belongs to exactly one `WorkflowProject`
- each `WorkflowCommit` belongs to exactly one `WorkflowBranch`
- each `AgentSession` belongs to exactly one `WorkflowProject` and targets
  exactly one branch or one commit
- each commit-targeted session also belongs to the commit's parent branch
- each `AgentSessionEvent`, `WorkflowArtifact`, and `WorkflowDecision` belongs
  to exactly one session
- each `ContextBundle` belongs to exactly one session

## 4. Public Contract Surface

### Surface summary

| Name                      | Purpose                                                                                     | Caller                                                    | Callee                                             | Inputs                                                       | Outputs                                            | Failure shape                                                | Stability                                               |
| ------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `WorkflowGraphSchema`     | Defines canonical graph types and predicates for project, branch, commit, and session state | Branch 4 module installer, Branch 1 bootstrap, web, agent | built-in `ops/workflow` module                     | schema package and migrations                                | stable type and predicate ids                      | schema conflict, incompatible migration                      | `stable`                                                |
| `ProjectBranchScope`      | Returns backlog, in-flight, and git-observed branch rows for one project                    | TUI, Branch 7 operator UI, MCP                            | Branch 3 scope planner and projections             | project id, filters, cursor                                  | ordered branch rows and git summaries              | policy denied, scope changed, projection unavailable         | `stable` for shape, `provisional` for ranking           |
| `CommitQueueScope`        | Returns the ordered commit queue for one branch                                             | TUI, session launcher                                     | Branch 3 scope planner and projections             | branch id, cursor                                            | ordered commit rows                                | branch missing, projection lag                               | `stable`                                                |
| `ContextBundleRequest`    | Resolves the immutable branch-specific or commit-specific context bundle for one session    | agent runtime                                             | context retrieval engine plus Branch 3 scope reads | subject, session id, retrieval mode, budget                  | `ContextBundle` and ordered `ContextBundleEntry[]` | missing inputs, policy denied, incomplete scope, over-budget | `stable`                                                |
| `WorkflowMutationCommand` | Creates and transitions projects, branches, and commits                                     | operator tooling, session launcher, worker runtime        | authoritative workflow runtime                     | create, reorder, activate, block, complete, archive commands | updated summary rows and cursor                    | lock conflict, invalid transition, policy denied             | `stable`                                                |
| `CodexSessionLaunch`      | Starts a branch-scoped or commit-scoped interactive Codex session                           | TUI, future web operator surface                          | session launcher plus workspace manager            | project id, subject, actor, mode                             | session summary and launch metadata                | subject locked, workspace missing, git mismatch              | `stable`                                                |
| `AgentSessionAppend`      | Creates sessions and appends ordered session events                                         | worker runtime, Codex runner bridge                       | authoritative workflow runtime                     | session metadata or event envelopes                          | accepted record ids, optional summaries            | missing subject, bad sequence, payload rejected              | `stable` for envelope, `provisional` for storage layout |
| `ArtifactWrite`           | Persists text or blob-backed artifacts for a session                                        | worker runtime, future ingest jobs                        | artifact writer                                    | session id, metadata, body or blob ref                       | `WorkflowArtifact` record                          | missing session, blob missing, policy denied                 | `stable`                                                |
| `DecisionWrite`           | Persists durable decisions and blockers                                                     | worker runtime, operator UI                               | decision writer                                    | session id, decision payload                                 | `WorkflowDecision` record                          | missing session, policy denied                               | `stable`                                                |
| `GitReconcileView`        | Reconciles local git branch and worktree observations into project-facing summaries         | local supervisor, TUI attach flow                         | git inspection layer plus derived write path       | repo root, branch filters                                    | observed branch rows and drift summaries           | repo missing, git command failure, stale observation         | `provisional`                                           |

### `ProjectBranchScope`

- purpose: give the operator one surface that shows backlog branches,
  in-flight branches, and local git branch inventory together
- caller: TUI branch board, Branch 7 operator UI, future MCP views
- callee: Branch 3 scope and projection layer
- inputs:
  - `projectId`
  - filters such as `state`, `hasActiveCommit`, or `showUnmanagedGitBranches`
  - optional cursor
- outputs:
  - ordered managed branch rows
  - unmanaged git branch summaries for the current project
  - freshness metadata for the last git reconciliation
- failure shape:
  - `project-not-found`
  - `policy-denied`
  - `projection-stale`
- stability: `stable` for row shape; ordering and rank heuristics remain
  `provisional`

### `CommitQueueScope`

- purpose: expose the commit queue for a selected branch inside the same TUI
  loop
- caller: TUI branch detail panel and session launcher
- callee: Branch 3 scope and projection layer
- inputs:
  - `branchId`
  - optional cursor
- outputs:
  - ordered commit rows
  - current active commit if one exists
- failure shape:
  - `branch-not-found`
  - `policy-denied`
  - `projection-stale`
- stability: `stable`

### `ContextBundleRequest`

- purpose: replace today's issue-centric prompt assembly in
  `src/agent/context.ts` with a graph-backed branch or commit retrieval
  contract
- caller: `src/agent/service.ts` or its graph-native successor
- callee: workflow context retrieval engine using Branch 3 scope reads
- inputs:
  - `projectId`
  - `subject`
  - `sessionId`
  - caller principal
  - retrieval profile such as `plan-branch`, `execute-commit`, or
    `review-branch`
  - optional token, size, or document-count budget
- outputs:
  - one immutable `ContextBundle`
  - ordered `ContextBundleEntry[]`
  - optional rendered prompt body for the specific session
- failure shape:
  - `subject-not-found`
  - `policy-denied`
  - `incomplete-scope`
  - `source-missing`
  - `budget-exceeded`
- stability: `stable` for shape and immutability rules; retrieval heuristics
  remain `provisional`

### `WorkflowMutationCommand`

- purpose: create and transition authoritative project, branch, and commit
  state
- caller: operator actions, session launcher, worker runtime
- callee: authoritative workflow command runtime
- inputs:
  - `createProject`
  - `createBranch`
  - `updateBranch`
  - `reorderBranch`
  - `setBranchState`
  - `createCommit`
  - `reorderCommit`
  - `setCommitState`
  - `attachCommitResult`
- outputs:
  - updated branch or commit summary
  - authoritative cursor from Branch 1
- failure shape:
  - `branch-lock-conflict`
  - `commit-lock-conflict`
  - `invalid-transition`
  - `subject-not-found`
  - `policy-denied`
- stability: `stable`

### `CodexSessionLaunch`

- purpose: start an interactive Codex session in branch or commit context from
  the TUI
- caller: TUI branch detail view, future web operator view
- callee: session launcher plus workspace manager
- inputs:
  - `projectId`
  - `subject`
  - actor principal
  - session kind such as `planning`, `execution`, or `review`
- outputs:
  - persisted `AgentSession`
  - launch metadata including branch name and worktree path if assigned
- failure shape:
  - `subject-locked`
  - `workspace-unavailable`
  - `git-branch-missing`
  - `policy-denied`
- stability: `stable`

### `AgentSessionAppend`

- purpose: persist the same session and event model already used by
  `src/agent/tui/session-events.ts`
- caller: `src/agent/service.ts`, `src/agent/runner/codex.ts`, TUI bridge
- callee: authoritative workflow runtime
- inputs:
  - session creation payloads derived from current `AgentSessionRef`
  - append-only `AgentSessionEvent` envelopes with per-session sequence numbers
- outputs:
  - persisted session ids and event acknowledgements
  - optional summary state for current diagnostics
- failure shape:
  - `subject-missing`
  - `sequence-conflict`
  - `event-too-large`
- stability: envelope is `stable`; storage materialization is `provisional`

## 5. Runtime Architecture

### Main components

`Workflow authority runtime`

- authoritative command surface for project, branch, and commit mutations
- authoritative write surface for sessions, artifacts, decisions, and context
  bundles
- lives on top of Branch 1's write path

`Git reconciler`

- inspects the current project root for local branches, worktrees, and head
  commits
- writes or refreshes derived branch observations
- never becomes the authoritative source of managed workflow state, but does
  make git reality visible in the operator surface

`Context retrieval engine`

- current equivalent is `src/agent/context.ts` plus repo-local doc resolution
- new responsibility is to resolve graph-backed branch or commit context bundles
  and freeze them per session

`Codex session launcher`

- current equivalents are `src/agent/service.ts` and
  `src/agent/runner/codex.ts`
- launches interactive sessions against the selected branch or active commit
- records retained session history through the authoritative runtime

`Workspace manager`

- current equivalent is `src/agent/workspace.ts`
- remains local process and filesystem machinery
- manages worktree reservation for active commit execution

`Operator surfaces`

- current equivalents are `src/agent/tui/*` and future Branch 7 web surfaces
- consume branch, commit, and session views from graph-backed reads

### Process boundaries

- authoritative workflow state lives in the Worker or Durable Object authority
  runtime
- supervisor and worker execution may run in a separate long-lived local
  process
- git refs, worktrees, command execution, and live PTYs remain local runtime
  concerns
- the graph stores desired workflow state, retained history, and reconciled git
  summaries
- no external tracker participates in the first milestone

### Authoritative versus derived state

Authoritative:

- project registry and repo-root attachment
- branch state, goal summary, and queue rank
- commit queue, active commit pointer, and finalization metadata
- session identity and ordered event envelopes
- artifact and decision metadata
- context bundles and their ordered membership

Derived:

- local git branch inventory
- ahead or behind counts
- dirty-worktree summaries
- suggested backlog ranking
- TUI playback summaries
- dashboard aggregates

Local-only:

- active process handles
- live PTY state
- transient worktree dirtiness not yet summarized
- temporary output files before they are summarized or attached

## 6. Storage Model

This branch does not own a separate durable database outside the graph.

Authoritative persistence for Branch 6 records is provided by Branch 1's
graph storage. Branch 6 owns the workflow entity families stored inside that
graph.

### Canonical records

- current state records:
  - `WorkflowProject`
  - `WorkflowBranch`
  - `WorkflowCommit`
  - `AgentSession`
- immutable retained history:
  - `AgentSessionEvent`
  - `WorkflowArtifact`
  - `WorkflowDecision`
  - `ContextBundle`
  - `ContextBundleEntry`

### Retained history versus current state

- projects, branches, and commits expose current summary fields for operator
  decisions and session launch
- session events, artifacts, decisions, and context bundles are retained
  immutable records
- current summary fields may be projected from immutable records for read
  efficiency, but the underlying retained records remain the durable audit
  trail

### Derived versus authoritative

- Branch 3 projections may materialize branch boards, commit queues, recent
  session lists, artifact search indexes, and git health summaries
- those projections are rebuildable from graph records plus fresh git
  inspection
- no projection may become the only copy of workflow history

### Rebuild rules

- branch boards rebuild from project, branch, and commit summaries
- session playback rebuilds from `AgentSession` plus ordered
  `AgentSessionEvent` records
- context retrieval indexes rebuild from `ContextBundleEntry`,
  `WorkflowDecision`, `WorkflowArtifact`, and linked repo metadata
- if large transcript fragments spill to blob records later, the graph still
  retains ordering, provenance, and blob references needed for rebuild

## 7. Integration Points

### Branch 1: Graph Kernel And Authority

- dependency direction: Branch 6 depends on Branch 1
- imported contracts:
  - stable ids
  - authoritative transaction ordering
  - write validation
  - persistence and restart recovery
- exported contracts:
  - workflow entity families written through Branch 1 transactions
- stable before safe implementation:
  - transaction idempotency
  - cursor continuity
  - secret-handle pattern for hidden session data

### Branch 2: Identity, Policy, And Sharing

- dependency direction: Branch 6 depends on Branch 2
- imported contracts:
  - principal ids for sessions and decisions
  - capability checks for branch mutation and transcript visibility
  - hidden versus replicated predicate rules
- exported contracts:
  - workflow-specific capabilities such as `workflow.branch.write`,
    `workflow.commit.write`, `workflow.session.read`, or
    `workflow.artifact.read`
- mockable or provisional:
  - single-user mode can stub broad access while contracts are still moving
- must stabilize before multi-user implementation:
  - policy for prompts, transcripts, and secret-bearing artifacts

### Branch 3: Sync, Query, And Projections

- dependency direction: Branch 6 depends on Branch 3
- imported contracts:
  - `project-branch-board` scopes
  - `branch-commit-queue` scopes
  - collection indexes for sessions, artifacts, and decisions
  - live invalidation for operator surfaces
- exported contracts:
  - projection specs for branch boards, commit queues, and retrieval indexes
- mockable or provisional:
  - project and branch reads may start as bounded local reads
  - git observations may start as local refresh-on-open behavior
- must stabilize before large-scale implementation:
  - scope completeness and invalidation behavior for branch boards

### Branch 4: Module Runtime And Installation

- dependency direction: Branch 6 and Branch 4 depend on each other through
  descriptors, but Branch 4 owns installability
- imported contracts:
  - module manifests and versioning
  - workflow and command descriptors declared by modules
- exported contracts:
  - graph-native workflow records that module workflows operate on
  - context-bundle hooks used by modules
- provisional:
  - final manifest field names for workflow registration and context providers

### Branch 7: Web And Operator Surfaces

- dependency direction: Branch 7 depends on Branch 6
- imported by Branch 7:
  - branch board summaries
  - commit queue summaries
  - session, artifact, and decision inspection views
  - retained context and decision history
- exported back to Branch 6:
  - operator actions such as launch session, block branch, reorder commit, or
    archive branch
- provisional:
  - exact UI route shapes and live UX behavior

## 8. Main Flows

### 1. Register a project and reconcile its branch inventory

1. initiator: operator action or TUI attach
2. components involved: workflow authority runtime, git reconciler, Branch 1
   persistence
3. contract boundaries crossed:
   - local git inspection
   - authoritative graph write for project metadata
   - derived git observation refresh
4. authoritative write point:
   - create or update `WorkflowProject`
   - optionally create managed `WorkflowBranch` records for adopted branches
5. failure or fallback behavior:
   - if git inspection fails, preserve current graph records and mark branch
     observations stale
   - if graph write fails, do not pretend the project is registered

### 2. Create or adopt a branch from backlog

1. initiator: operator action or planning session
2. components involved: `WorkflowMutationCommand`, workspace manager
3. contract boundaries crossed:
   - authoritative branch write
   - optional local git branch creation
4. authoritative write point:
   - create `WorkflowBranch`
   - set branch state, goal summary, and git branch metadata
5. failure or fallback behavior:
   - if git branch creation fails, keep the branch record in `backlog` and mark
     it not yet materialized
   - do not mark the branch `active` until the git ref exists

### 3. Plan the next commit inside a branch

1. initiator: operator action or branch-scoped planning session
2. components involved: `CommitQueueScope`, `WorkflowMutationCommand`
3. contract boundaries crossed:
   - read current branch detail and commit queue
   - authoritative commit write
4. authoritative write point:
   - create or reorder `WorkflowCommit`
   - optionally set `WorkflowBranch.activeCommitId`
5. failure or fallback behavior:
   - if the branch is locked by another active session, reject with
     `branch-lock-conflict`
   - if queue order is stale, refresh and retry

### 4. Launch Codex in branch or commit context

1. initiator: operator action from the TUI
2. components involved: `CodexSessionLaunch`, context retrieval engine,
   workspace manager
3. contract boundaries crossed:
   - authoritative session create
   - context-bundle read and write
   - local workspace reservation
4. authoritative write point:
   - create `AgentSession`
   - create immutable `ContextBundle` and `ContextBundleEntry` records
5. failure or fallback behavior:
   - if required sources are missing or policy-filtered, fail the launch before
     starting Codex
   - if the branch or commit is already locked, do not start a second editing
     session

### 5. Record session progress, artifacts, and decisions

1. initiator: worker process
2. components involved: execution runner, authoritative workflow runtime
3. contract boundaries crossed:
   - local command execution
   - session event append
   - artifact and decision writes
4. authoritative write point:
   - `AgentSession`
   - ordered `AgentSessionEvent`
   - `WorkflowArtifact`
   - `WorkflowDecision`
5. failure or fallback behavior:
   - local execution failure records `failed` session state and retained output
   - persistence failure must not silently discard already-emitted events;
     retry append or fail the session explicitly

### 6. Finalize a commit and advance the branch

1. initiator: execution session completion or explicit operator action
2. components involved: workspace manager, `WorkflowMutationCommand`,
   git reconciler
3. contract boundaries crossed:
   - local git commit or branch update
   - authoritative finalization write
4. authoritative write point:
   - set `WorkflowCommit.resultingCommit`
   - transition commit to `committed`, `blocked`, or `dropped`
   - update branch state and `activeCommitId`
5. failure or fallback behavior:
   - if git finalization fails, preserve session history and worktree
     reservation, and leave the commit `blocked` or `active`
   - if graph write fails after a successful git commit, reconcile from git and
     require an explicit repair path rather than fabricating state

### 7. Inspect retained history after restart

1. initiator: TUI attach, web operator view, or MCP client
2. components involved: Branch 3 workflow view projections, retained graph
   records, git reconciler
3. contract boundaries crossed:
   - scope read for one branch or session history
   - optional git refresh
4. authoritative write point:
   - none; read-only flow
5. failure or fallback behavior:
   - if projection is stale, rebuild or fall back to bounded direct read
   - retained history must remain inspectable even when the original worker
     process is gone

## 9. Invariants And Failure Handling

### Invariants

- every branch belongs to exactly one project
- every commit belongs to exactly one branch
- the graph may track unmanaged local git branches, but only managed
  `WorkflowBranch` records participate in backlog and session launch
- only one active commit may exist for one branch in the first milestone
- only one editing session may hold the branch lock at a time in the first
  milestone
- context bundles are immutable once attached to a session
- session event sequence is strictly monotonic within one session
- artifacts and decisions preserve provenance to branch, optional commit, and
  session
- git refs remain the source of truth for actual commit SHAs and branch heads
- operator summaries are derived views, not the source of truth

### Failure modes

`Git reconcile drift`

- what fails: local git branch inventory no longer matches last observed graph
  summaries
- what must not corrupt: managed branch lineage and retained session history
- retry or fallback: refresh git observations and mark stale rows until
  reconciled
- observability needed: reconcile duration, stale branch count, command errors

`Branch lock conflict`

- what fails: two operators or workers try to launch editing sessions for the
  same branch
- what must not corrupt: branch state, active commit pointer, and existing
  session history
- retry or fallback: loser refreshes branch detail and does not start execution
- observability needed: lock-conflict count and affected branch ids

`Context retrieval failure`

- what fails: required docs, artifacts, or prior decisions cannot be resolved
- what must not corrupt: branch lineage, commit queue, or any prior session
  history
- retry or fallback: fail the launch or mark the commit `blocked`; operator may
  rerun after fixing inputs
- observability needed: missing-source reason, policy-denied counts, bundle
  assembly latency

`Worker crash after partial event emission`

- what fails: local process dies mid-session
- what must not corrupt: already accepted session events and artifact records
- retry or fallback: next supervisor cycle may mark the session failed or
  interrupted after timeout; retained history stays readable
- observability needed: heartbeat age, interrupted sessions, orphaned worktree
  leases

`Commit finalization failure`

- what fails: git commit creation, worktree cleanup, or branch update
- what must not corrupt: successful session history and retained artifacts
- retry or fallback: keep the commit active or blocked with preserved worktree
  metadata until the operator resolves it
- observability needed: blocked commit age, retained worktree count

`Projection or queue lag`

- what fails: Branch 3 read model falls behind
- what must not corrupt: authoritative branch, commit, or session state
- retry or fallback: refresh from direct bounded reads or rebuild projection
- observability needed: projection lag, fallback count, scope freshness

## 10. Security And Policy Considerations

- prompts, session transcripts, raw command output, and some artifacts may
  contain secrets or policy-restricted data
- the graph-visible branch board must separate safe replicated fields from
  authority-only content
- browser or MCP consumers should receive safe summaries by default; raw
  transcript access requires explicit capability
- `ContextBundleEntry` may point at secret-backed or policy-filtered sources,
  but any plaintext reveal still follows Branch 2 and Branch 1 secret-handle
  rules
- agent runtimes execute as an explicit principal or service actor, not as an
  unscoped system backdoor
- local filesystem paths and worktree paths are sensitive runtime hints and
  should be treated as operator-visible metadata, not broadly replicated

## 11. Implementation Slices

### Slice 1: Project registry and branch board

- goal: define `WorkflowProject` and `WorkflowBranch`, reconcile one repo's git
  branches, and render backlog plus in-flight branches beside local branch
  inventory in the TUI
- prerequisite contracts:
  - Branch 1 write and persistence contracts
  - provisional Branch 3 project and branch scope reads
- what it proves:
  - one project can use the graph as the workflow source of truth without
    Linear
  - the operator can see real branch state inside the TUI
- what it postpones:
  - commit queue editing
  - branch-scoped Codex launch

### Slice 2: Commit queue and branch detail

- goal: define `WorkflowCommit`, expose the ordered commit queue for one
  branch, and show branch goal summary plus next commit in the TUI
- prerequisite contracts:
  - Slice 1 project and branch records
- what it proves:
  - backlog planning can happen at the branch and commit level inside the same
    model
  - one active commit per branch is enough to start
- what it postpones:
  - rich branch-document editing
  - stacked commit branches

### Slice 3: Branch-scoped Codex launch and retained history

- goal: launch Codex from the TUI against a selected branch or commit and write
  retained session, artifact, and decision history to the graph
- prerequisite contracts:
  - Slice 2 commit queue
  - context bundle retrieval for one narrow profile
- what it proves:
  - the operator can move from branch selection to interactive work without
    leaving the TUI
  - retained session history can replace filesystem-only replay
- what it postpones:
  - transcript search
  - blob spillover optimization for very large session bodies

### Slice 4: Commit finalization and resume loop

- goal: finalize commit records with git SHAs, preserve blocked worktree state,
  and resume interrupted branch work after restart
- prerequisite contracts:
  - Slice 3 retained session history
- what it proves:
  - the graph can manage the full branch lifecycle from backlog to landed
    commit-sized work
- what it postpones:
  - multi-project scheduling
  - automatic branch splitting or merge planning

## 12. Open Questions

- Does the product ever need a separate `WorkflowRun`, or is `AgentSession`
  sufficient until background batch execution arrives?
- Should active commit execution happen directly on the branch worktree, or
  should the first implementation reserve an ephemeral child branch while still
  presenting one logical parent branch in the UI?
- Should the branch end-state document start as a repo-path reference, a blob
  reference, or an inline summary plus optional document ref?
- How much git health data should be stored durably versus recomputed on every
  TUI attach?
- When branch planning gets more sophisticated, should backlog ranking stay a
  derived projection or become an explicit operator-managed ordering contract?

## 13. Recommended First Code Targets

- `src/graph/modules/ops/workflow/`: add the first built-in graph-native
  workflow module for project, branch, commit, session, artifact, decision, and
  context-bundle types
- `src/agent/service.ts`: replace Linear-first task selection with
  project-backed branch selection and session launch
- `src/agent/context.ts`: replace issue-centric prompt assembly with
  branch-specific and commit-specific `ContextBundleRequest` paths
- `src/agent/tui/session-events.ts`: keep the existing event envelope and move
  persistence behind it as the retained session history contract
- `src/agent/workspace.ts`: keep local execution mechanics, but drive worktree
  reservation and commit finalization from graph-native branch and commit state
- `src/agent/tui/*`: add a branch board, branch detail pane, and session launch
  actions for one current project
