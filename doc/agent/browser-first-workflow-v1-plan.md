# Browser-First Workflow V1 Plan

## Purpose

Define the narrowed Branch 6 shipping plan for the first browser-launched
workflow session.

This plan is grounded in the current repository state on 2026-04-01. It
intentionally comes before a full rewrite of the Branch 6 canon in
[`../branch/06-workflow-and-agent-runtime.md`](../branch/06-workflow-and-agent-runtime.md).
The current canonical doc is still broader, more branch-centric, and more
TUI-first than the first browser milestone should be.

## Target Outcome

The first shipped browser milestone is complete when an operator can:

1. open `/workflow`
2. view the commit queue for the implicit workflow branch `main`
3. select one commit
4. launch or attach to the next workflow session for that commit from the
   browser
5. have that session receive the correct `branch`, `commit`, and `session`
   context
6. watch retained session progress recover from the graph after reload
7. stop the workflow for explicit user review and then continue it from the
   browser

This milestone does not require the full v1 execution loop to be complete.
Landing, merge cleanup, and richer queue automation can follow after the first
browser-launched session works correctly.

## Why This Plan Exists

The current docs and code already prove useful pieces of the final product, but
they are not aligned on the first shipped path.

Current tension:

- [`../branch/06-workflow-and-agent-runtime.md`](../branch/06-workflow-and-agent-runtime.md)
  still treats browser-first operator flows as out of scope before the TUI loop
  works
- [`./browser.md`](./browser.md) correctly argues that the browser should
  become the main workflow control surface
- the current workflow schema and TUI are branch-first, while the current
  product pressure is commit-first

The repo already has the right split for the first browser milestone:

- the Worker authority is already the source of truth for workflow writes and
  retained session history
- the browser route already has workflow-specific reads and launch wiring
- the local browser-agent transport already exists for filesystem-backed work

The plan below keeps that split and removes unnecessary first-milestone
taxonomy.

## Current Repo Anchors

The first browser milestone should build on these existing surfaces instead of
inventing a parallel architecture:

- workflow schema and commands:
  [`../../lib/graph-module-workflow/src/type.ts`](../../lib/graph-module-workflow/src/type.ts),
  [`../../lib/graph-module-workflow/src/command.ts`](../../lib/graph-module-workflow/src/command.ts),
  [`../../lib/graph-module-workflow/src/query.ts`](../../lib/graph-module-workflow/src/query.ts),
  [`../graph/workflow.md`](../graph/workflow.md)
- workflow authority command handling:
  [`../../lib/app/src/web/lib/workflow-authority.ts`](../../lib/app/src/web/lib/workflow-authority.ts),
  [`../../lib/app/src/web/lib/workflow-authority-aggregate-handlers.ts`](../../lib/app/src/web/lib/workflow-authority-aggregate-handlers.ts),
  [`../../lib/app/src/web/lib/workflow-authority-commit-handlers.ts`](../../lib/app/src/web/lib/workflow-authority-commit-handlers.ts)
- authoritative session persistence:
  [`../../lib/app/src/web/lib/workflow-session-history.ts`](../../lib/app/src/web/lib/workflow-session-history.ts),
  [`../../lib/graph-module-workflow/src/session-append.ts`](../../lib/graph-module-workflow/src/session-append.ts)
- browser workflow surface:
  [`../../lib/app/src/web/components/workflow-review-page.tsx`](../../lib/app/src/web/components/workflow-review-page.tsx),
  [`../../lib/app/src/web/lib/workflow-session-feed.ts`](../../lib/app/src/web/lib/workflow-session-feed.ts)
- browser-agent bridge:
  [`../../lib/cli/src/browser-agent/transport.ts`](../../lib/cli/src/browser-agent/transport.ts),
  [`../../lib/cli/src/browser-agent/server.ts`](../../lib/cli/src/browser-agent/server.ts)
- current TUI semantics worth reusing:
  [`../tui/index.md`](../tui/index.md),
  [`../../lib/cli/src/tui/model.ts`](../../lib/cli/src/tui/model.ts)

## Product Direction For The First Browser Milestone

### Keep explicit in v1

- one inferred `WorkflowProject`
- one attached `WorkflowRepository`
- one implicit `WorkflowBranch` with `slug = "main"`
- a commit queue as the primary workflow surface
- `WorkflowCommit` as the operator-facing unit of work
- one git branch and one worktree per commit
- one eventual git commit per `WorkflowCommit`
- agent-managed sessions for that commit
- a single user-review gate that can stop workflow progress

### Keep implicit in v1

- branch selection in the main product flow
- branch backlog ordering and branch board ranking
- unmanaged observed repository branch inventory
- multi-repository execution
- stacked logical branches
- rich general-purpose context retrieval heuristics
- generalized planner behavior across many workflow families

### Keep deferred

- multiple workflow branches beyond `main`
- branch-first TUI parity as a release gate
- full merge, rebase, and cleanup automation as part of the first browser
  session slice
- browser-native artifact and transcript chrome beyond what is required to
  verify session launch and recovery

## Recommended Minimal Model

### WorkflowBranch

`WorkflowBranch` remains in the graph, but it is a secondary record in the
first milestone.

Required fields:

- `slug`
- `name`
- `context`
- `references`

V1 rule:

- the system creates and maintains exactly one operator-visible branch record:
  `main`

### WorkflowCommit

`WorkflowCommit` is the main operator-facing record.

Required fields:

- `slug`
- `name`
- `context`
- `references`

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

- `Todo + gate=None`: runnable by the workflow
- `Todo + gate=UserReview`: paused for explicit operator review
- `Open`: actively being executed or merged
- `Done`: landed and cleaned up, or landed with cleanup queued for retry

### WorkflowSession

The product model should move to explicit workflow sessions:

```ts
type WorkflowSessionKind = "Plan" | "Review" | "Implement" | "Merge";
type WorkflowSessionStatus = "Todo" | "Open" | "Done";
```

Required fields:

- `name`
- `context`
- `references`

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
- the first browser milestone does not need an immediate storage rename if that
  slows delivery
- it is acceptable to map the existing retained session runtime onto the new
  `WorkflowSession` product semantics for the first implementation, as long as
  the operator-facing contract is commit-centric and session-kind-correct

## Session Types And Responsibilities

### System-created

- `Plan`

The system creates `Plan` automatically when a new commit is added.

`Plan` should:

- read code and nearby docs
- update `commit.context`
- update `commit.references`
- choose whether user review is required before implementation
- create follow-on sessions

### Agent-created

- `Review`
- `Implement`
- `Merge`

Responsibilities:

- `Review`: inspect current state, refine commit context, request user review
  when needed, and create follow-on sessions
- `Implement`: write code and tests, run checks, and keep the single commit
  current with `git commit --amend`
- `Merge`: rebase on `main`, resolve conflicts, finalize the commit message,
  land the commit, and clean up the branch and worktree

## Session Context Contract

The first milestone should prefer a direct, explicit prompt contract over a
general retrieval engine.

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

The local runtime may also attach execution hints that are not part of the core
product model:

- repository root
- git branch name
- worktree path
- current HEAD SHA

### Recommendation on context assembly

For the first browser-launched session:

- do not block on a generalized `ContextBundleRequest` redesign
- assemble prompt context directly from the branch, commit, and session fields
- allow `references` to carry links, file paths, and compact inline notes
- add immutable bundle persistence later if the launch path needs restart-safe
  prompt snapshots

This is the smallest path to proving that browser-launched workflow context is
wired correctly.

## User Review Gate

The user review requirement should not become a fourth commit lifecycle state.

Recommendation:

- keep `WorkflowCommit.state = Todo | Open | Done`
- add `WorkflowCommit.gate = None | UserReview`

Flow:

1. the system or an agent creates a commit
2. `Plan` or `Review` may set `gate = UserReview`
3. the scheduler refuses to open a gated commit
4. the browser shows the gating reason and the requesting session
5. the user may:
   - continue workflow by clearing the gate
   - request changes, which keeps the gate in place and creates follow-on
     `Review` work

The audit trail should live in retained decisions or session history, not only
in the current gate field.

## Git And Worktree Lifecycle

### Commit creation

When a commit is added:

1. create `WorkflowCommit`
2. allocate a git branch name such as `io-123`
3. create that branch from `main`
4. create a worktree such as `tmp/worktree/io-123`
5. persist the git branch and worktree metadata on the commit
6. create the initial `Plan` session
7. run `Plan`

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
- land with a clean merge strategy
- update the commit record with the final SHA
- remove the worktree
- delete the temporary git branch

If merge succeeds but cleanup fails:

- the commit may still move to `Done`
- cleanup should retry without rolling back the landed commit

## Browser Flow For The First Session

### Operator flow

1. open `/workflow`
2. see the commit queue for `main`
3. select one commit
4. see the commit detail, next runnable session, latest retained session, and
   current gate state
5. click `Launch`, `Attach`, or `Continue`

### Launch flow

1. browser selects the next runnable session for the commit
2. browser calls the local browser-agent launch surface
3. browser-agent validates local runtime readiness
4. Worker authority records the session and grants retained write authority
5. browser-agent starts Codex in the correct worktree
6. browser-agent appends retained session history back through the authority
7. browser renders authoritative session history and optionally overlays live
   browser-agent events for latency

### Recovery rule

The browser session feed must recover from authoritative graph history after:

- page reload
- websocket reconnect
- browser disconnect
- browser-agent reconnect

The local browser-agent live stream is optional latency improvement, not the
source of truth.

## UI Changes Required For This Milestone

The current browser workflow surface is branch-first. The first shipped browser
session path should be commit-first.

Recommended primary layout:

- left: commit queue for `main`
- center: selected commit detail
- right: selected commit session queue and retained session feed

Recommended primary actions:

- `Launch` or `Attach` for the next runnable session
- `Continue workflow` when `gate = UserReview`
- `Request changes` when the operator wants another review or planning pass

Recommended demotions from the current UI:

- branch board becomes a secondary header or inspector, not the primary
  navigation surface
- branch-scoped launch is no longer a first-class action
- repository branch inventory is not part of the first browser milestone

## Runtime And Command Implications

### Keep the current authority split

The current split is already correct:

- Worker authority owns workflow reads and writes
- browser-agent owns git, worktrees, PTYs, and Codex execution

### Reuse existing command seams

The current command path in
[`../../lib/app/src/web/lib/authority.ts`](../../lib/app/src/web/lib/authority.ts)
already supports:

- `workflow-mutation`
- `agent-session-append`
- `artifact-write`
- `decision-write`

The first browser milestone should extend those typed command seams rather than
route workflow mutation through generic graph CRUD.

### Minimum workflow-specific writes needed

- create and update commit records in the simplified model
- create and update session records
- set and clear the user-review gate
- append retained session events
- persist decisions for review and continue actions

### Agent graph updates

The agent will need a safe write path to:

- update `commit.context`
- update `commit.references`
- create follow-on sessions
- request user review

That should be exposed as workflow-specific command tools, potentially through
MCP, rather than by teaching the agent to manipulate raw graph entities
directly.

## Staged Shipping Plan

### Stage 0: Freeze the first browser milestone

Goal:

- agree that the first shipped path is one browser-launched session from the
  commit queue with correct context and retained recovery

Outputs:

- this plan
- follow-on rewrites to Branch 6, browser, workflow-schema, and TUI docs

### Stage 1: Reduce the workflow contract to the first milestone

Goal:

- simplify the product model around implicit `main`, commit queue, and
  workflow sessions

Primary code targets:

- `lib/graph-module-workflow/src/type.ts`
- `lib/graph-module-workflow/src/command.ts`
- `lib/app/src/web/lib/workflow-authority-aggregate-handlers.ts`
- `lib/app/src/web/lib/workflow-authority-commit-handlers.ts`

Done when:

- the simplified branch, commit, and session model is authoritative
- the user-review gate exists
- the first milestone no longer depends on separate repository-branch records
  in the operator-facing contract

### Stage 2: Pivot reads and browser UI to commit-first workflow

Goal:

- make the browser route center on the commit queue for `main`

Primary code targets:

- `lib/graph-module-workflow/src/query.ts`
- `lib/app/src/web/lib/workflow-session-feed.ts`
- `lib/app/src/web/components/workflow-review-page.tsx`

Done when:

- the browser can render the commit queue, selected commit detail, and session
  feed without requiring branch-first navigation
- the browser shows gating state and next runnable session

### Stage 3: Launch the first browser session with correct context

Goal:

- launch one real session from the browser with branch, commit, and session
  context wired correctly

Primary code targets:

- `lib/cli/src/browser-agent/transport.ts`
- `lib/cli/src/browser-agent/server.ts`
- the local browser-agent coordinator implementation
- `lib/app/src/web/lib/workflow-session-history.ts`

Done when:

- browser launch starts a real local session
- the session receives the explicit context contract from this plan
- retained session history persists and recovers after reload

### Stage 4: Add the user-review stop and continue loop

Goal:

- let an agent stop before execution continues and let the user resume from the
  browser

Primary code targets:

- workflow mutation handlers
- browser workflow actions
- decision persistence helpers

Done when:

- a session can request `UserReview`
- the selected commit stops being runnable while gated
- the browser can clear the gate and resume workflow

### Stage 5: Complete the execution loop

Goal:

- finish the first real commit lifecycle through implementation and merge

Primary code targets:

- browser-agent local execution coordinator
- local git/worktree management
- finalization writes

Done when:

- `Implement` can produce or amend the commit
- `Merge` can land it and record the final SHA
- worktree and branch cleanup happen on success or queue a recoverable retry

## Explicit Non-Goals For The First Browser Session Slice

- multiple operator-visible workflow branches
- generalized context retrieval ranking and budgeting
- a complete browser-native transcript product
- generalized workflow editing from the browser
- replacing all current TUI affordances before browser launch proves out
- remote bearer-share workflow mutation through graph MCP

## Follow-On Documentation Work

Once this plan is accepted, rewrite these docs in this order:

1. [`../branch/06-workflow-and-agent-runtime.md`](../branch/06-workflow-and-agent-runtime.md)
2. [`./browser.md`](./browser.md)
3. [`../graph/workflow.md`](../graph/workflow.md)
4. [`../tui/index.md`](../tui/index.md)
5. [`../graph/mcp.md`](../graph/mcp.md), if the first milestone requires
   workflow-specific MCP write tools

## Recommendation

Ship the first browser milestone by reducing the model, not by broadening the
runtime.

The fastest correct path is:

- implicit `main`
- commit queue first
- explicit branch, commit, and session context
- graph-backed retained session history
- browser-agent for local execution
- one review gate that lets the user stop and resume workflow

That path is already compatible with the repo's existing authority, browser,
and browser-agent seams. It is smaller than the current Branch 6 contract and
more likely to produce the first real browser-launched session without another
round of architecture churn.
