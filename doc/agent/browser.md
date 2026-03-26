# Browser Agent Proposal

## Purpose

Define the shipping-correct path for making the browser the primary workflow
control surface while keeping workspace management, git operations, PTYs, and
Codex execution in a separate local runtime.

This proposal is grounded in the current repository state on 2026-03-26.

## Recommendation

Ship the browser as the main workflow control service, but do it on top of
graph-backed workflow reads and graph-backed retained session history.

Do not treat the current `/workflow` route as the product to iterate on. It is
useful proof infrastructure, but it is not the right product shape. Do not ship
the browser by streaming the in-memory `AgentSessionEventBus` directly to the
page as the only source of truth. That path is fast to demo and wrong to ship.

The correct path is:

1. replace the generic `/workflow` entity browser with a real workflow review
   surface built from the existing workflow projection contracts
2. add a local `browser-agent` runtime for launch, attach, finalization, and
   other filesystem-backed operations that cannot live in the Worker
3. persist `AgentSession`, `AgentSessionEvent`, `WorkflowArtifact`, and
   `WorkflowDecision` records through the authoritative graph runtime
4. let the browser session feed recover from graph-backed history on reload,
   reconnect, and restart
5. keep the TUI as a fallback and reference surface, not as the primary product
   loop

## Current State Review

### What already exists

The repo already has the foundations needed for a browser-first workflow
surface:

- `web` has authenticated graph bootstrap through
  `src/web/components/graph-runtime-bootstrap.tsx`
- the app shell already exposes a `/workflow` route in
  `src/web/routes/workflow.tsx` and `src/web/components/app-shell.tsx`
- the authority already serves workflow projection reads through
  `src/web/lib/server-routes.ts` and `src/web/lib/authority.ts`
- the authority already serves workflow live registration and invalidation
  through `src/web/lib/workflow-live-transport.ts`,
  `src/web/lib/workflow-live-websocket.ts`, and
  `src/web/lib/workflow-review-live-websocket-sync.ts`
- the workflow schema already includes `AgentSession`, `AgentSessionEvent`,
  `WorkflowArtifact`, `WorkflowDecision`, and `ContextBundle` in
  `doc/graph/workflow.md`
- `tui` already proves the desired branch-board, branch-detail, commit-queue,
  and subject-scoped action model in `src/tui/*`
- `agent` already exposes a canonical session event envelope in
  `src/agent/tui/session-events.ts` and a live subscription seam in
  `src/agent/service.ts`

### What the current browser route does now

The current `/workflow` route now lands on a workflow-native review layout for
phase 1.

- `src/web/components/workflow-page.tsx` boots the shipped workflow-review
  scoped runtime before the page renders
- `src/web/components/workflow-review-page.tsx` renders browser-owned branch
  board, branch detail, and commit queue panels
- startup and empty states stay explicit instead of widening back to the whole
  graph or dropping into the generic entity browser

That means the browser route now covers the first product-shaped workflow read
surface, but it still stops short of ship:

- it is read-focused and does not yet launch or finalize work
- it does not yet render a browser-native retained session feed
- it still depends on follow-on phases for authoritative session persistence and
  browser-agent execution

### What the current TUI proves

The new `io tui` is further along on product shape than the browser surface.

Today it already proves:

- graph-backed startup with scoped workflow reads
- branch board, branch detail, and commit queue composition
- selection and focus model
- derived branch-session and commit-session affordances
- subject-scoped pending, success, and failure state

But it still does not launch anything on `main`.

- `src/tui/tui.tsx` supports an `onAction` callback, but the CLI bootstrap in
  `src/tui/server.ts` does not wire one
- `src/tui/model.ts` still states that the first contract does not launch
  sessions or perform workflow writes

That matters because the TUI is the best semantic reference for the workflow
surface, but it is not yet the shipping execution path either.

### What still lives only in the agent runtime

Live session behavior is still agent-owned:

- the canonical event schema is in `src/agent/tui/session-events.ts`
- live publication is process-local through `createAgentSessionEventBus()`
- `AgentService.observeSessionEvents(...)` is an in-memory subscription seam
- retained attach and replay are still rebuilt from runtime files in
  `src/agent/tui-runtime.ts` and described in `doc/agent/tui.md`

The repo does not currently implement a graph-backed `AgentSessionAppend`
write path. The contract exists in `doc/branch/06-workflow-and-agent-runtime.md`,
but the codebase still writes and replays retained session output locally.

### What the current web live path does not do

The existing web live transport is important, but its scope is narrow.

- it registers workflow-review interest
- it pushes `cursor-advanced` invalidations
- it tells the client to re-pull or re-sync scoped workflow data

It does not stream session events or transcripts. It is a freshness transport
for workflow projections, not yet a session feed transport.

## Product Goal

The browser should become the operator's main workflow control surface.

The definition of done is not "the browser can show something live." The
definition of done is:

- an operator can open `/workflow`
- see the canonical branch board, branch detail, and commit queue
- trigger branch-scoped and commit-scoped session launches
- watch session progress live
- reload the page and recover the same session state from the graph
- inspect retained artifacts, decisions, and transcript history after restart
- finalize commits and advance branches from the same browser surface

If reload, reconnect, or machine restart loses the session story, the browser
surface is still a demo.

## Principles

### 1. Graph-backed history is mandatory for ship

The browser must recover from authoritative `AgentSession` and
`AgentSessionEvent` records. The local process is allowed to provide better live
latency, but not to own the only retained copy.

### 2. Product routes consume workflow contracts, not generic entity browsers

`/workflow` should not be a dressed-up explorer view over raw
`WorkflowBranch` records. It should consume the workflow review contracts:

- `ProjectBranchScope`
- `CommitQueueScope`
- later session-history and retained-session feed contracts

### 3. Worker authority remains authoritative

The Worker or Durable Object authority owns:

- workflow mutations
- session persistence
- artifact and decision persistence
- replayable workflow and session reads

The browser must never invent authoritative state from local process output.

### 4. Local execution stays local

Workspace reservation, git operations, worktrees, PTYs, and Codex execution are
local runtime concerns. The Worker should not grow filesystem-backed launch or
git behavior.

### 5. TUI semantics should be reused, not duplicated blindly

The current TUI proves the right workflow interaction model. The browser should
reuse the same workflow rules and status semantics, but through shared domain
logic, not by importing TUI rendering code or recreating policy ad hoc.

## Proposed Architecture

### Browser shell

The browser remains the main operator surface:

- Better Auth resolves the browser session
- the app shell exposes `/workflow` as the primary workflow route
- the page binds to the workflow review scope, not the whole graph
- browser navigation, filtering, selection, and inline action affordances live
  in `src/web/*`

### Workflow authority

The Worker authority remains the source of truth for:

- workflow read models
- workflow mutations
- session creation and append acknowledgement
- artifact and decision persistence
- projection invalidation and retained-history recovery

### Browser-agent runtime

Add a new local long-lived runtime, referred to here as the `browser-agent`.

Its responsibilities are:

- receive launch and finalization requests from the browser
- resolve local repository and workspace state
- reserve worktrees and manage local workspace locks
- launch Codex sessions and hold live PTY state
- append session events, artifacts, and decisions back to the authority
- survive browser disconnects while the session continues

Its responsibilities are not:

- replacing the graph authority
- inventing its own workflow state
- becoming the durable source of transcript history

### Session feed model

The browser session feed should have two layers:

- authoritative layer:
  graph-backed `AgentSession` and ordered `AgentSessionEvent` history
- optional live-UX layer:
  direct local browser-agent event push for low-latency updates

The authoritative layer is required. The optional live layer is only useful if
it reconciles with graph append acknowledgement and degrades cleanly when the
local bridge disappears.

## Shipping Path

### Phase 1: Replace `/workflow` with a real workflow review screen

Replace the generic entity browser with a workflow-native route.

The first browser workflow screen should:

- boot against the workflow review sync scope rather than the whole graph
- render the same three core surfaces the TUI already proves:
  branch board, branch detail, and commit queue
- derive selection from URL state so project and branch deep links are stable
- show `latestSession` and repository-backed status summaries already present in
  `ProjectBranchScope` and `CommitQueueScope`
- re-pull on workflow-review invalidations using the existing web live sync
  transport

The current browser proof now includes that invalidation-driven scoped refresh
path for `/workflow`: the route stays on the shipped workflow-review sync scope,
registers live interest, and re-runs the workflow review reads after
`cursor-advanced` invalidations without widening back to whole-graph sync.

The route now also canonicalizes inferred singleton project and branch
selection back into `/workflow` URL state, while keeping explicitly stale route
selections visible as degraded review state instead of silently switching to a
different branch.

Implementation notes:

- treat `src/tui/model.ts` as the semantic reference
- do not import TUI layout or OpenTUI code into the browser
- extract shared workflow action-policy logic if the browser needs the same
  availability rules
- stop using `EntityTypeBrowser` as the product implementation for `/workflow`

Acceptance criteria:

- `/workflow` is no longer a generic entity-type browser
- the route uses workflow review data and not the whole-graph default
- a user can inspect branches and commit queues without opening `/graph`
- invalidation-driven refresh works without widening to whole-graph sync

### Phase 2: Introduce a local browser-agent launch bridge

Add a local runtime dedicated to filesystem-backed operations.

This bridge should own:

- branch-scoped launch
- commit-scoped launch
- attach handoff
- finalization entrypoints
- later repair and replay assistance as needed

It should not be implemented as a Worker route that directly manipulates the
repository. The process boundary in `doc/branch/06-workflow-and-agent-runtime.md`
already points the other way: execution is local, authority is remote or
Worker-owned.

The browser-facing contract should be explicit:

- request: project id, subject, actor, mode, and any selection metadata needed
  for launch
- success: session summary, attach handoff, repository/worktree metadata
- failure: subject locked, workspace missing, repository mismatch, policy
  denied, local bridge unavailable

Security requirement:

- the browser-agent must not be trusted just because it runs on localhost
- use a delegated, short-lived, user-bound launch lease or equivalent explicit
  authority credential when the local runtime writes to the graph

Acceptance criteria:

- browser actions can launch or attach to branch-scoped and commit-scoped
  sessions
- launch continues to work if the browser tab reloads after the session starts
- launch failures are attributed and user-visible
- the authority can still audit who initiated the session

### Phase 3: Make session persistence authoritative

Implement the missing graph-backed write path for retained session history.

This phase adds:

- `AgentSessionAppend`
- session creation acknowledgement
- ordered `AgentSessionEvent` append
- `WorkflowArtifact` persistence
- `WorkflowDecision` persistence
- durable linkage between session, branch, commit, repository, and context

The browser-agent and local runner should append events as they happen, not only
at the end of a run.

Failure rules:

- do not silently drop events on append failure
- retry where safe
- surface degraded persistence state explicitly
- fail the session if the system can no longer preserve an auditable execution
  record

Acceptance criteria:

- reload and restart recover session history from the graph
- retained history no longer depends on runtime files for the main browser path
- artifacts and decisions appear with direct provenance from the running
  session and selected subject

### Phase 4: Build the browser-native session feed

Once graph-backed session history exists, add a dedicated session panel to the
workflow route.

The first browser session feed should show:

- session header and subject
- runtime state and finalization state
- ordered lifecycle and status events
- raw lines or transcript blocks where appropriate
- artifacts and decisions attached to the selected session

The initial read path should prefer graph-backed history and treat any direct
browser-agent live push as an optimization layer only.

Recommended behavior:

- graph-backed reload and replay are the default
- local live push can paint events optimistically before graph acknowledgement
- the UI marks locally seen but not yet acknowledged events as transient
- on reconnect, the browser reconciles back to graph order

Acceptance criteria:

- an operator can watch a running session from the browser
- page reload preserves the session story
- browser disconnect does not corrupt history
- missing or partial history renders an explicit degraded state rather than a
  blank panel

### Phase 5: Finalize commits and branch advancement from the browser

Move the post-session workflow back into the same browser route.

This phase adds:

- finalize commit
- persist `RepositoryCommit`
- advance `WorkflowCommit` and `WorkflowBranch` state
- show repairable partial-failure states

The local browser-agent should perform local git work and then call the
authoritative workflow mutation path. If git succeeds but graph write fails, the
system must surface repair rather than inventing matching state.

Acceptance criteria:

- successful finalization updates both local git and graph-backed workflow
  state
- partial failures remain visible and repairable
- the browser can drive the complete branch session -> commit session ->
  finalize loop

## What We Should Stop Doing

- stop treating `/workflow` as a generic entity editor for `WorkflowBranch`
- stop loading the whole graph for the workflow product route by default
- stop adding net-new TUI-specific workflow UX before the browser path exists
- stop assuming direct session-bus streaming is sufficient for browser ship
- stop mixing workflow product policy with view-specific code when shared domain
  logic would keep web and TUI aligned

## Code Targets

### Browser workflow surface

- replace `src/web/components/workflow-page.tsx`
- add dedicated workflow route components under `src/web/components/workflow/`
- bind `GraphRuntimeBootstrap` to the workflow review scope for this route
- reuse `src/web/lib/workflow-review-live-websocket-sync.ts` for freshness

### Shared workflow policy

- extract a shared action-policy and subject-state layer from the semantics
  currently embedded in `src/tui/model.ts`
- keep layout and interaction rendering web-owned and TUI-owned separately

### Browser-agent runtime

- add a new local runtime package or entrypoint under `src/agent/` or
  `src/browser-agent/`
- keep workspace, PTY, git, and Codex runner ownership there
- teach it to append authoritative session history as it executes

### Authority and read models

- implement the missing session append path in the authority-owned workflow
  runtime
- add session-history query helpers that mirror the stability of
  `ProjectBranchScope` and `CommitQueueScope`
- keep live invalidation conservative first; direct deltas can come later

## Risks

### Risk: shipping a fast demo instead of a durable product

If the browser only tails a local event bus, reload and restart lose the story.

Mitigation:

- do not call the browser path shipped until graph-backed session history is in
  place

### Risk: duplicating workflow policy across TUI and web

If web and TUI each hand-code launch availability and subject-state rules, they
will drift quickly.

Mitigation:

- extract shared domain logic and keep surface-specific rendering separate

### Risk: confusing authority and local execution boundaries

If the Worker starts owning git or workspace behavior, or if the local runtime
starts inventing authoritative workflow state, failure handling will become
unrepairable.

Mitigation:

- keep the authority authoritative and the browser-agent local
- make every launch, append, and finalization boundary explicit

### Risk: browser route stays tied to generic graph browsing

If the workflow page continues to ride the explorer primitives directly, the
product route will inherit the wrong interaction model and the wrong sync scope.

Mitigation:

- move `/workflow` onto workflow-specific view models and contracts immediately

## Ship Criteria

The browser-agent path is ready to call primary when all of the following are
true:

- `/workflow` is a workflow-native review surface
- browser launch and attach work through the local browser-agent runtime
- session history is persisted as `AgentSession` and `AgentSessionEvent`
  records
- the browser session feed recovers fully after reload and reconnect
- artifacts and decisions are retained and attributable
- commit finalization and branch advancement are browser-driven and repairable
- TUI is no longer required for the standard operator loop

Until then, the TUI remains a valid fallback and test oracle, but not the
product we should optimize for.
