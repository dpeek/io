---
name: Workflow and agent runtime branch
description: "Canonical cross-package contract for Branch 6 browser-first workflow and agent runtime work."
last_updated: 2026-04-07
---

# Branch 6 Canonical: Workflow And Agent Runtime

## Overview

### Mission

Ship the simplified browser-first v1 workflow model: one implicit workflow
branch `main`, a commit queue as the main operator surface, explicit workflow
sessions, and one user-review gate that can stop and resume progress from the
browser.

### Why This Is A Separate Branch

The repo already has useful workflow, browser, TUI, and agent-runtime pieces,
but the docs still describe two different products:

- an older branch-first, repository-branch-heavy, TUI-gated model
- the newer browser-first, commit-first model needed for the first shipped
  session

Branch 6 owns the contract that makes those surfaces converge on one execution
model.

### In Scope

- one inferred `WorkflowProject`
- one attached `WorkflowRepository`
- one operator-visible `WorkflowBranch` with `slug = "main"`
- a commit queue as the primary workflow surface
- explicit `WorkflowSession` planning, review, implementation, and merge work
- one git branch and one worktree per workflow commit
- graph-backed retained session, artifact, and decision history
- browser launch, attach, recovery, and user-review continuation
- the authority and local browser-agent boundary for workflow execution

### Out Of Scope

- multiple operator-visible workflow branches in v1
- repository-branch inventory as the main product surface
- branch-scoped launch as a first-class release requirement
- tracker compatibility layers or dual-write
- generalized context retrieval heuristics
- multi-repository execution
- TUI parity as a release gate
- full landing and cleanup automation before the first browser-launched session
  ships

### Durable Contracts Owned

- the simplified `project -> repository -> branch(main) -> commit -> session[]`
  workflow lineage
- the commit-first operator loop and its retained history model
- the explicit branch, commit, and session context contract
- the `UserReview` gate and continue or request-changes flow
- the local git and worktree execution boundary behind the browser-agent

### Likely Repo Boundaries

- `lib/graph-module-workflow/src/*`
- `lib/app/src/web/lib/workflow-authority*.ts`
- `lib/app/src/web/lib/workflow-session-feed.ts`
- `lib/app/src/web/components/workflow-review-page.tsx`
- `lib/cli/src/browser-agent/*`
- `lib/cli/src/tui/*`
- `lib/cli/src/agent/*` for retained session append and prompt-context assembly

### Dependencies

- Branch 1 for durable graph facts and authoritative writes
- Branch 2 for identity and policy boundaries
- Branch 3 for workflow-scoped reads, freshness, and invalidation
- Branch 4 for module install and runtime packaging
- Branch 7 consumes this contract for the browser surface

### Downstream Consumers

- Branch 7 workflow browser surfaces
- later workflow-specific MCP or agent write tools
- future commit-queue automation beyond the first browser milestone

### First Shippable Milestone

An operator can open `/workflow`, view the commit queue for implicit `main`,
select one commit, launch or attach to the next session for that commit,
recover retained progress after reload, and stop or continue the workflow
through one explicit user-review gate.

### Done Means

- the primary operator surface is browser-first and commit-first
- one visible workflow branch exists: `main`
- commits carry the execution context the browser and agent need
- sessions are explicit and recoverable from authoritative graph history
- user review can stop and resume workflow without inventing a fourth commit
  state
- repository branches and worktrees remain implementation details behind
  commit execution
- no competing TUI-first canon remains for the first browser milestone

### First Demo

Open `/workflow`, pick a commit from `main`, launch the next session, watch
retained progress recover after reload, hit a `UserReview` stop, and continue
from the browser.

### What This Unlocks

- one smaller v1 workflow contract the code can actually ship
- direct implementation guidance for `OPE-644` and the next workflow slices
- a clean browser-agent and authority split without broadening the product
  model

### Source Anchors

- `lib/app/doc/workflow-web.md`
- `lib/app/doc/roadmap.md`
- `lib/cli/doc/roadmap.md`
- `lib/graph-module-workflow/doc/workflow-stack.md`
- `lib/cli/doc/tui.md`

## 1. Purpose

This branch owns the first stable workflow model for browser-launched
execution.

The operator-facing question is no longer "how do we model every logical branch
and every attached repository branch up front?" It is: "how do we let the
browser launch the next useful unit of work with correct context and retained
recovery?" For v1, the smallest correct answer is commit-first:

- keep one visible workflow branch: `main`
- make `WorkflowCommit` the unit of work
- make sessions explicit
- keep git branches and worktrees attached to commits, not to the main
  navigation model
- let the user stop and resume work through one clear review gate

Branch 6 should therefore stop presenting browser-first work as blocked on a
TUI-first branch-board contract. The TUI remains useful as a semantic
reference and fallback surface, but the first shipped loop is browser-first.

## 2. Product Direction

The canonical v1 rules are:

- the browser is the main workflow control surface
- `WorkflowBranch` remains in the graph, but `main` is implicit and secondary
- the commit queue is the main operator-facing surface
- `WorkflowCommit` is the main unit of planning, execution, and finalization
- `WorkflowSession` is the explicit execution envelope
- the first browser milestone needs one review stop, not a generalized state
  machine
- retained graph history is authoritative; local live streams are optional
  latency helpers
- the TUI is not the release gate for the first browser-launched session

Important consequences:

- do not introduce a separate `WorkflowRun` in v1
- do not require repository-branch inventory in the main browser flow
- do not widen the first milestone back into a generic planner or tracker clone

## 3. Canonical V1 Model

### `WorkflowProject`

`WorkflowProject` remains the logical root for workflow state.

V1 rules:

- infer exactly one operator-visible project per graph
- keep it stable enough for keys, routing, and retained history
- do not make multi-project scheduling part of the first browser session slice

### `WorkflowRepository`

`WorkflowRepository` stays attached to the project as the local execution
substrate.

V1 rules:

- exactly one attached repository
- `main` is the base branch for all first-milestone workflow commits
- repository records exist to support local execution, not to dominate the
  operator UI

### `WorkflowBranch`

`WorkflowBranch` remains part of the lineage, but it becomes secondary in v1.

Required operator-facing fields:

- `slug`
- `name`
- `context`
- `references`

V1 rules:

- the system creates and maintains exactly one visible workflow branch: `main`
- browser navigation may still show branch context, but it is not the primary
  queue surface
- branch backlog ordering and multiple workstreams stay deferred

### `WorkflowCommit`

`WorkflowCommit` is the main operator-facing record.

Recommended v1 lifecycle:

```ts
type WorkflowCommitState = "Todo" | "Open" | "Done";
type WorkflowCommitGate = "None" | "UserReview";
```

Recommended fields:

```ts
interface WorkflowCommit {
  id: string;
  branchId: string;
  slug: string;
  name: string;
  order: number;
  state: "Todo" | "Open" | "Done";
  gate: "None" | "UserReview";
  gateReason?: string;
  gateRequestedAt?: string;
  gateRequestedBySessionId?: string;
  context: string;
  references: string;
  git: {
    baseBranchSlug: "main";
    branchName: string;
    worktreePath: string;
    headSha?: string;
    finalSha?: string;
    commitMessage?: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

Semantics:

- `Todo + gate=None`: runnable by workflow automation
- `Todo + gate=UserReview`: paused for explicit operator review
- `Open`: actively being executed or merged
- `Done`: landed, or landed with cleanup queued for retry

The current code still carries broader internal branch, commit, and repository
states. That is acceptable during the transition, but browser-facing reads and
future mutations should converge on this simpler operator contract.

### `WorkflowSession`

The product model should make sessions explicit:

```ts
type WorkflowSessionKind = "Plan" | "Review" | "Implement" | "Merge";
type WorkflowSessionStatus = "Todo" | "Open" | "Done";
```

Recommended fields:

```ts
interface WorkflowSession {
  id: string;
  commitId: string;
  kind: "Plan" | "Review" | "Implement" | "Merge";
  status: "Todo" | "Open" | "Done";
  name: string;
  context: string;
  references: string;
  createdBy: "system" | "agent";
  parentSessionId?: string;
  startedAt?: string;
  endedAt?: string;
}
```

Implementation note:

- the current repo already persists `AgentSession` and `AgentSessionEvent`
- v1 does not need an immediate storage rename if that slows delivery
- the storage layer may keep `AgentSession` while the product contract and
  browser UI speak in `WorkflowSession` terms
- what matters is commit-centric session selection, correct session-kind
  semantics, and retained recovery

### Retained outputs

`WorkflowArtifact` and `WorkflowDecision` remain first-class retained outputs.

V1 rules:

- decisions should carry review-stop and continue or change provenance
- artifacts should keep session and commit provenance
- the browser should recover retained outputs from the authority, not from
  local runtime memory

`ContextBundle` may remain a retained implementation detail. The first browser
session slice should not block on a broader context-bundle redesign.

## 4. Session Types And Responsibilities

### System-created

- `Plan`

`Plan` starts automatically when a new commit is created.

Responsibilities:

- read nearby code and docs
- update commit context and references
- decide whether user review is required before implementation
- create follow-on sessions

### Agent-created

- `Review`
- `Implement`
- `Merge`

Responsibilities:

- `Review`: refine commit context, request user review when needed, and create
  follow-on sessions
- `Implement`: change code, add or update tests, run checks, and keep the
  single git commit current with `git commit --amend`
- `Merge`: rebase on `main`, resolve conflicts, finalize the commit message,
  land the commit, and clean up the branch and worktree

## 5. Context Contract

The first browser-launched session should use an explicit prompt contract
instead of a generalized retrieval engine.

Every started session should receive:

- `branch.slug`
- `branch.context`
- `branch.references`
- `commit.slug`
- `commit.name`
- `commit.context`
- `commit.references`
- `session.name`
- `session.context`
- `session.references`

The local runtime may add execution hints that do not change the product
contract:

- repository root
- git branch name
- worktree path
- current `HEAD` SHA

Recommendation:

- assemble prompt context directly from branch, commit, and session fields
- allow `references` to hold file paths, doc links, and compact inline notes
- add immutable bundle persistence later when launch recovery needs prompt
  snapshots

## 6. User Review Gate

User review should not become a fourth commit lifecycle state.

Canonical rule:

- keep `WorkflowCommit.state = Todo | Open | Done`
- keep `WorkflowCommit.gate = None | UserReview`

Flow:

1. the system or an agent creates a commit
2. `Plan` or `Review` may set `gate = UserReview`
3. the scheduler refuses to open a gated commit
4. the browser shows the gate reason and requesting session
5. the user may continue workflow by clearing the gate
6. the user may request changes, which keeps the gate in place and creates
   follow-on review work

The audit trail belongs in retained decisions and session history, not only in
the current gate fields.

## 7. Git And Worktree Lifecycle

Each `WorkflowCommit` owns one git branch and one worktree.

### Commit creation

1. create `WorkflowCommit`
2. allocate a git branch name for that commit
3. create the branch from `main`
4. create a dedicated worktree
5. persist that git metadata on the commit
6. create the initial `Plan` session
7. start `Plan`

### Implement execution

`Implement` sessions:

- always run in the commit's dedicated worktree
- keep exactly one git commit current on that branch
- use `git commit --amend` on follow-on implementation passes

### Merge execution

`Merge` sessions:

- rebase the commit branch on current `main`
- resolve conflicts in the same worktree
- finalize the commit message
- land the commit
- update the commit with the final SHA
- remove the worktree
- delete the temporary git branch

If landing succeeds but cleanup fails, the commit may still move to `Done`
while cleanup retries later. Cleanup failure must not roll back a landed
commit.

## 8. Runtime And Command Boundary

The current split is already the right one.

### Worker authority owns

- workflow reads and writes
- authoritative commit and session state
- retained session append acknowledgement
- retained artifact and decision persistence
- replayable browser reads and recovery

### Local browser-agent owns

- repository access
- git operations
- worktree reservation and cleanup
- PTYs and Codex execution
- local live event push for latency, when available

### Command rule

Use typed workflow-specific command seams rather than generic graph CRUD.

Current seams worth preserving:

- `workflow-mutation`
- `agent-session-append`
- `artifact-write`
- `decision-write`

Required v1 workflow-specific writes:

- create and update commits in the simplified model
- create and update workflow sessions
- set and clear the user-review gate
- update commit context and references
- append retained session events
- finalize commits by outcome

Repository-branch and repository-commit records remain implementation details
behind this boundary. They should not force a broader operator contract in the
first browser milestone.

## 9. Browser Surface

The first shipped browser path is commit-first.

Recommended layout:

- left: commit queue for `main`
- center: selected commit detail
- right: session queue and retained session feed for the selected commit

Recommended primary actions:

- `Launch` or `Attach` for the next runnable session
- `Continue workflow` when `gate = UserReview`
- `Request changes` when the operator wants another review or planning pass

Demotions from the older model:

- branch board becomes a secondary header or inspector
- branch-scoped launch is not a first-class v1 action
- repository branch inventory is not part of the main browser flow

### Launch flow

1. browser selects the next runnable session for the commit
2. browser calls the local browser-agent launch surface
3. browser-agent validates local runtime readiness
4. Worker authority records the session and grants retained write authority
5. browser-agent starts Codex in the correct worktree
6. browser-agent appends retained history back through the authority
7. browser renders authoritative history and may overlay local live events for
   latency

### Recovery rule

The session feed must recover from authoritative graph history after:

- page reload
- websocket reconnect
- browser disconnect
- browser-agent reconnect

The local browser-agent stream is optional UX improvement, not the source of
truth.

## 10. TUI Boundary

The TUI remains useful, but its role changes.

V1 rule:

- `io tui` is a semantic reference surface and fallback operator surface
- it may keep broader branch-board affordances during the transition
- it is not the release gate for the first browser-launched session
- follow-on TUI work should reuse the same commit-first rules rather than
  reassert a separate branch-first canon

## 11. Delivery Order

Implement this branch in this order:

1. freeze the v1 contract around implicit `main`, commit queue, sessions, and
   review gate
2. simplify the workflow model and mutations around commits and sessions
3. pivot browser reads to commit-first workflow and retained session feed
   selection
4. launch one real browser session with the explicit branch, commit, and
   session context contract
5. add the review-stop and continue loop
6. finish the implementation and merge lifecycle

The Branch 6 measure of success is not breadth. It is that the docs, schema,
browser, and runtime all describe the same smaller model.
