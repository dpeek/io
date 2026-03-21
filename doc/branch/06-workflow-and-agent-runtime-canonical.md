# Branch 6 Canonical: Workflow And Agent Runtime

## 1. Purpose

This branch owns the graph-native workflow model and the agent runtime contract
that operates on it.

It exists as a separate branch because the repo already proves useful
automation, but that automation is still organized around repo-local workflow
files, Linear issues, filesystem runtime state, and retained logs under
`src/agent/`. The platform direction in `vision.md`,
`doc/10-vision-product-model.md`, and `doc/11-vision-execution-model.md` is
stricter: workflow, run history, context retrieval, and durable agent memory
must become first-class graph capabilities rather than incidental runtime
byproducts.

Platform outcomes this branch must deliver:

- one canonical graph entity model for streams, features, tasks, runs,
  sessions, artifacts, decisions, and context bundles
- one authoritative runtime contract for starting work, recording execution,
  and finalizing results
- one retrieval contract for task-specific context bundles
- one migration path where Linear becomes an adapter or mirror, not the sole
  source of truth
- one retained execution history that Branch 7 and future MCP or operator
  surfaces can inspect without reading local runtime files

Stability target for this branch:

- `stable`: workflow lineage model, run lifecycle, session event envelope,
  artifact and decision provenance, context-bundle shape, external-mirror rule
  that graph state wins
- `provisional`: scheduling heuristics, context ranking heuristics, live work
  queue projections, large transcript storage strategy, and operator summary
  read models
- `future`: graph-native planning heuristics, multi-agent coordination beyond
  one active task per feature, and cross-graph workflow or delegation

## 2. Scope

### In scope

- graph-native work item taxonomy for stream, feature, and task
- graph-native run, session, artifact, decision, and context-bundle records
- authoritative run start, progress, and completion transitions
- retained execution history usable after process restart
- the contract boundary between local execution substrate and graph-owned state
- migration adapters that mirror or dual-write current Linear-backed flows
- agent runtime changes needed so `src/agent/service.ts`,
  `src/agent/context.ts`, `src/agent/workspace.ts`, and `src/agent/tui/*` can
  consume graph-native workflow state

### Out of scope

- replacement of git worktrees, local branches, or repo-local command
  execution
- a final generalized planner for every future workflow family
- a final polished browser UI for all workflow surfaces
- replacement of Better Auth, capability enforcement, or scoped sync planning
- arbitrary distributed queue scans across sharded authorities
- full replacement of all external tools on day one

### Upstream assumptions

- Branch 1 owns graph ids, fact storage, authoritative transactions, cursor
  ordering, and durable persistence
- Branch 2 owns principal identity, predicate visibility, capability checks,
  and secret access boundaries
- Branch 3 owns work-queue scopes, context-bundle scopes, collection indexes,
  and live invalidation routing
- Branch 4 owns workflow descriptors as installable module features
- Branch 5 owns blob records and ingest jobs for large artifacts or extracted
  context inputs

## 3. Core Model

### Canonical module boundary

Inference: until a broader installable `work` foundation module exists, the
first built-in schema slice for this branch should ship as one `ops/workflow`
module. That matches the repo's current `ops:` namespace convention and keeps
platform workflow separate from future domain-specific task modules.

### Owned entities

`WorkflowStream`

- long-lived workstream for one subsystem, package, or product slice
- top-level release boundary for planning and final integration
- parent of zero or more `WorkflowFeature` records

`WorkflowFeature`

- integration-sized branch owner inside a stream
- scheduling boundary for execution concurrency
- parent of zero or more `WorkflowTask` records

`WorkflowTask`

- smallest schedulable execution unit
- the unit a supervisor can claim for one run attempt
- may represent implementation, backlog editing, review, ingest review, or
  other narrow execution work, but each task still belongs to exactly one
  feature

`WorkflowRun`

- one authoritative execution attempt against one workflow subject
- anchors context, sessions, artifacts, decisions, and finalization outcome
- replaces the current split between ephemeral runtime files and retained logs

`AgentSession`

- one execution sub-session inside a run
- directly models the current `AgentSessionRef` tree used by the TUI:
  `supervisor`, `worker`, and `child`
- carries runtime state and workflow references used by operator tooling

`AgentSessionEvent`

- append-only ordered event envelope for session lifecycle changes, status
  lines, raw output lines, and Codex notifications
- durable event history replaces the current file-only replay path

`WorkflowArtifact`

- durable output produced by a run, including text summaries, patches, docs,
  screenshots, exported files, command transcripts, or blob-backed outputs
- always points back to the producing run and session

`WorkflowDecision`

- durable decision or blockage record written during or after a run
- captures operator-visible reasoning that should outlive the terminal session

`ContextBundle`

- immutable task-specific bundle of references and rendered inputs chosen for
  one run attempt
- the retrieval unit the agent consumes before execution

`ContextBundleEntry`

- ordered member of a `ContextBundle`
- preserves source, order, and inclusion reason for one retrieved item

`TrackerMirror`

- optional mapping from graph-native workflow records to external tracker
  records such as Linear issue ids and identifiers
- exists only to support migration or interoperability
- never becomes the authoritative workflow state

### Canonical identifiers

- every entity above uses a graph node id owned by Branch 1
- every work item also has a human-readable `workflowKey` that is stable inside
  one graph, for example `stream:graph-sync`,
  `feature:sync-scope-bootstrap`, or `task:branch6-doc`
- tracker-backed items additionally keep `externalRef` values such as
  `{ system: "linear", issueId, identifier }`
- `WorkflowRun.runKey` is unique per task attempt and must remain stable across
  retries of transport or persistence
- `AgentSession.sessionKey` is stable within a run and reuses the current
  session tree shape from `src/agent/tui/session-events.ts`
- `ContextBundle.bundleKey` is unique per run and immutable after creation

### Canonical interfaces

```ts
type WorkflowNodeKind = "stream" | "feature" | "task";

type WorkflowState = "backlog" | "todo" | "in-progress" | "blocked" | "done" | "cancelled";

type WorkflowReleaseState = "held" | "released";

interface WorkflowWorkItem {
  id: string;
  workflowKey: string;
  kind: WorkflowNodeKind;
  title: string;
  description?: string;
  state: WorkflowState;
  releaseState?: WorkflowReleaseState;
  parentId?: string;
  streamId: string;
  featureId?: string;
  moduleIds?: readonly string[];
  tracker?: {
    system: "linear";
    issueId: string;
    identifier: string;
    mirroredAt?: string;
    mirrorMode: "mirror" | "dual-write";
  };
  activeRunId?: string;
  latestRunId?: string;
  createdAt: string;
  updatedAt: string;
}

type WorkflowRunState =
  | "queued"
  | "running"
  | "awaiting-user-input"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "finalized";

interface WorkflowRun {
  id: string;
  runKey: string;
  workItemId: string;
  attempt: number;
  actorId: string;
  mode: "backlog" | "execute" | "review" | "ingest";
  state: WorkflowRunState;
  contextBundleId?: string;
  rootSessionId?: string;
  workerId?: string;
  workspace?: {
    branchName?: string;
    baseBranchName?: string;
    worktreePath?: string;
    outputPath?: string;
  };
  startedAt: string;
  finishedAt?: string;
  finalization?: {
    state: "pending" | "finalized";
    commitSha?: string;
    landedAt?: string;
    trackerState?: string;
  };
}

type AgentSessionKind = "supervisor" | "worker" | "child";

type AgentSessionRuntimeState =
  | "running"
  | "blocked"
  | "interrupted"
  | "pending-finalization"
  | "finalized";

interface AgentSessionRecord {
  id: string;
  runId: string;
  sessionKey: string;
  kind: AgentSessionKind;
  title: string;
  parentSessionId?: string;
  rootSessionId: string;
  workerId: string;
  runtimeState?: AgentSessionRuntimeState;
  workflow: {
    stream?: string;
    feature?: string;
    task?: string;
  };
  threadId?: string;
  turnId?: string;
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
        | "workflow-diagnostic"
        | "issue-assigned"
        | "issue-blocked"
        | "issue-committed"
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
  runId: string;
  sessionId?: string;
  kind: "patch" | "doc" | "summary" | "command-log" | "screenshot" | "file" | "transcript";
  title: string;
  mimeType?: string;
  bodyText?: string;
  blobId?: string;
  createdAt: string;
}

interface WorkflowDecision {
  id: string;
  runId: string;
  sessionId?: string;
  kind: "plan" | "question" | "assumption" | "blocker" | "resolution";
  summary: string;
  details?: string;
  createdAt: string;
}

interface ContextBundle {
  id: string;
  bundleKey: string;
  workItemId: string;
  runId: string;
  scopeId: string;
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

Work items:

1. created in `backlog` or `todo`
2. optionally `released`
3. claimed by one active run and moved to `in-progress`
4. either `blocked`, `done`, or returned to `todo`
5. optionally mirrored to an external tracker

Runs:

1. created as `queued`
2. assigned a context bundle
3. moved to `running`
4. may enter `awaiting-user-input` or `blocked`
5. ends as `succeeded`, `failed`, or `cancelled`
6. may move to `finalized` after commit, landing, or tracker reconciliation

Sessions:

1. `scheduled`
2. `started`
3. emit ordered event records
4. end as `completed`, `failed`, or `stopped`

Artifacts and decisions:

1. created during a run
2. never mutated in place except for safe metadata corrections
3. remain attached to the run even if the work item is retried later

Context bundles:

1. assembled before execution
2. frozen for one run attempt
3. never retroactively edited
4. replaced by a new bundle on rerun if inputs change

### Relationships

- each `WorkflowFeature` belongs to exactly one `WorkflowStream`
- each `WorkflowTask` belongs to exactly one `WorkflowFeature` and one stream
- each `WorkflowRun` belongs to exactly one task, feature, or stream work item,
  but the first milestone only needs task runs
- each `AgentSession` belongs to exactly one run
- each `AgentSessionEvent`, `WorkflowArtifact`, and `WorkflowDecision` belongs
  to exactly one run and may additionally point at one session
- each `ContextBundle` belongs to exactly one run and exactly one work item
- each `TrackerMirror` points from one graph-native entity to one external
  record

## 4. Public Contract Surface

### Surface summary

| Name                   | Purpose                                                             | Caller                                                    | Callee                                             | Inputs                                          | Outputs                                            | Failure shape                                                             | Stability                                               |
| ---------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `WorkflowGraphSchema`  | Defines the canonical graph types and predicates for workflow state | Branch 4 module installer, Branch 1 bootstrap, web, agent | built-in `ops/workflow` module                     | schema package and migrations                   | stable type and predicate ids                      | schema conflict, incompatible migration                                   | `stable`                                                |
| `WorkflowQueueScope`   | Returns runnable or inspectable work items                          | supervisor, Branch 7 operator UI, MCP                     | Branch 3 scope planner and projections             | principal, scope kind, filters, cursor          | ordered work-item rows plus completeness           | policy denied, scope changed, projection unavailable                      | `provisional`                                           |
| `ContextBundleRequest` | Resolves the immutable task-specific context bundle for one run     | agent runtime                                             | context retrieval engine plus Branch 3 scope reads | work item id, run id, retrieval profile, budget | `ContextBundle` and ordered `ContextBundleEntry[]` | missing inputs, policy denied, incomplete scope, over-budget              | `stable`                                                |
| `WorkflowRunCommand`   | Starts, heartbeats, completes, blocks, cancels, or finalizes a run  | supervisor, worker, operator tooling                      | authoritative workflow runtime                     | run transition command                          | updated `WorkflowRun` summary and cursor           | lease conflict, invalid state transition, policy denied                   | `stable`                                                |
| `AgentSessionAppend`   | Creates sessions and appends ordered session events                 | worker runtime, Codex runner bridge                       | authoritative workflow runtime                     | session metadata or event envelopes             | accepted record ids, optional summaries            | missing run, bad parent session, non-monotonic sequence, payload rejected | `stable` for envelope, `provisional` for storage layout |
| `ArtifactWrite`        | Persists text or blob-backed artifacts for a run                    | worker runtime, Branch 5 ingest jobs                      | artifact writer                                    | run id, artifact metadata, body or blob ref     | `WorkflowArtifact` record                          | missing run, blob missing, policy denied                                  | `stable`                                                |
| `DecisionWrite`        | Persists durable decisions and blockers                             | worker runtime, operator UI                               | decision writer                                    | run id, session id, decision payload            | `WorkflowDecision` record                          | missing run, policy denied                                                | `stable`                                                |
| `TrackerMirrorAdapter` | Mirrors graph-native state to Linear during migration               | background mirror worker or finalizer                     | external tracker adapter                           | graph entity ref plus mirror intent             | mirror acknowledgement and status                  | external API failure, rate limit, mapping mismatch                        | `provisional`                                           |
| `WorkflowRuntimeView`  | Returns summaries for Branch 7 and retained TUI playback            | web UI, TUI, MCP                                          | projection and read layer                          | work item ids, run ids, scope ids               | run/session/artifact summaries                     | scope stale, projection lag                                               | `provisional`                                           |

### `WorkflowGraphSchema`

- purpose: define the durable workflow and agent memory entity model
- caller: schema bootstrap, module installation, typed clients
- callee: built-in workflow module packaged on top of Branch 1 graph contracts
- inputs:
  - workflow type definitions
  - predicate metadata including visibility and write rules
  - migrations for future schema evolution
- outputs:
  - graph ids for work items, runs, sessions, artifacts, decisions, and
    context bundles
  - typed refs and reusable `WorkflowSpec` or `GraphCommandSpec` descriptors
- failure shape:
  - migration incompatibility
  - duplicate workflow keys
  - illegal predicate policy metadata
- stability: `stable` for core lineage and execution types; `provisional` for
  repository, environment, and planner-specific extensions

### `ContextBundleRequest`

- purpose: replace today's repo-local prompt assembly in
  `src/agent/context.ts` with a graph-backed retrieval contract
- caller: `src/agent/service.ts` or its graph-native successor
- callee: workflow context retrieval engine using Branch 3 scope reads
- inputs:
  - `workItemId`
  - `runId`
  - caller principal
  - retrieval profile or mode such as `backlog` or `execute`
  - optional token, size, or document-count budget
- outputs:
  - one immutable `ContextBundle`
  - ordered `ContextBundleEntry[]`
  - optional rendered prompt body for the specific run
- failure shape:
  - `work-item-not-found`
  - `policy-denied`
  - `incomplete-scope`
  - `source-missing`
  - `budget-exceeded`
- stability: `stable` for shape and immutability rules; retrieval heuristics
  remain `provisional`

### `WorkflowRunCommand`

- purpose: create and transition authoritative run state
- caller: supervisor, worker, future operator UI
- callee: authoritative workflow command runtime
- inputs:
  - `startRun`
  - `heartbeatRun`
  - `blockRun`
  - `completeRun`
  - `cancelRun`
  - `finalizeRun`
- outputs:
  - updated `WorkflowRun`
  - authoritative cursor from Branch 1
  - optional work-item state mutation
- failure shape:
  - `run-conflict`
  - `invalid-transition`
  - `work-item-not-runnable`
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
  - optional summary state for current session diagnostics
- failure shape:
  - `run-missing`
  - `session-parent-missing`
  - `sequence-conflict`
  - `event-too-large`
- stability: envelope is `stable`; storage materialization is `provisional`

### `TrackerMirrorAdapter`

- purpose: keep Linear usable during migration without letting it own the
  workflow model
- caller: workflow runtime or background mirror worker
- callee: `src/agent/tracker/linear.ts` or successor adapter
- inputs:
  - graph-native work item or run transition
  - current tracker mapping
  - desired mirrored state
- outputs:
  - mirror success or retry status
  - updated mapping timestamp
- failure shape:
  - external API failure
  - rate limit
  - stale mapping
- stability: `provisional`

## 5. Runtime Architecture

### Main components

`Workflow authority runtime`

- authoritative command surface for work item transitions, run lifecycle,
  session append, artifact writes, and mirror intent records
- lives on top of Branch 1's authoritative write path

`Supervisor`

- current equivalent is `src/agent/service.ts`
- reads runnable work from graph-backed queue scopes instead of polling Linear
- claims work by creating or transitioning `WorkflowRun` records

`Context retrieval engine`

- current equivalent is `src/agent/context.ts` plus repo-local doc resolution
- new responsibility is to resolve graph-backed context bundles and freeze them
  per run

`Execution runner`

- current equivalent is `src/agent/runner/codex.ts`
- consumes a context bundle, emits session events, and writes artifacts and
  decisions back through the authoritative runtime

`Workspace manager`

- current equivalent is `src/agent/workspace.ts`
- remains local process and filesystem machinery
- graph stores references and outcomes, but local worktree state is not the
  authoritative product model

`Tracker mirror`

- current equivalent is `src/agent/tracker/linear.ts`
- becomes a migration adapter triggered by graph-native transitions

`Operator surfaces`

- current equivalents are `src/agent/tui/*` and future Branch 7 web surfaces
- consume workflow views and retained session history from graph-backed reads

### Process boundaries

- authoritative state lives in the Worker or Durable Object authority runtime
- supervisor and worker execution may run in a separate long-lived local
  process
- local git branches, worktrees, stdout files, and command execution remain
  local runtime concerns
- Linear remains a remote external system reached through an adapter
- web or MCP consumers read summarized workflow state through Branch 3
  projections or scopes rather than by tailing local files

### Authoritative versus derived state

Authoritative:

- work item current state and lineage
- run summaries and finalization state
- session identity and ordered event envelopes
- artifact and decision metadata
- context bundles and their ordered membership
- external tracker mappings and mirror status

Derived:

- runnable queue ordering
- workflow diagnostic counts
- TUI playback summaries
- dashboard aggregates
- search or retrieval indexes over artifacts and decisions

Local-only:

- active process handles
- live PTY state
- transient worktree dirtiness
- temporary output files before they are summarized or attached

## 6. Storage Model

This branch does not own a separate durable database outside the graph.

Authoritative persistence for Branch 6 records is provided by Branch 1's
authoritative graph storage. Branch 6 owns the workflow entity families stored
inside that graph.

### Canonical records

- current state records:
  - `WorkflowStream`
  - `WorkflowFeature`
  - `WorkflowTask`
  - `WorkflowRun`
  - `AgentSession`
- immutable retained history:
  - `AgentSessionEvent`
  - `WorkflowArtifact`
  - `WorkflowDecision`
  - `ContextBundle`
  - `ContextBundleEntry`
  - mirror attempts or mirror status events

### Retained history versus current state

- work items and runs expose current summary fields for scheduler decisions and
  UI rendering
- session events, artifacts, decisions, and context bundles are retained
  immutable records
- current summary fields may be projected from immutable records for read
  efficiency, but the underlying event or artifact records remain the durable
  audit trail

### Derived versus authoritative

- Branch 3 projections may materialize work queues, recent run lists, artifact
  search indexes, and context retrieval indexes
- those projections are rebuildable from graph records owned by this branch
- no projection may become the only copy of workflow history

### Rebuild rules

- queue views and diagnostic summaries must rebuild from work items plus run
  summaries
- session playback must rebuild from `AgentSession` plus ordered
  `AgentSessionEvent` records
- context retrieval indexes must rebuild from `ContextBundleEntry`,
  `WorkflowDecision`, `WorkflowArtifact`, and linked repo metadata
- if large transcript fragments spill to Branch 5 blob records, the graph still
  retains ordering, provenance, and blob references needed for rebuild

### Migration expectations

- first milestone supports Linear mirroring or dual-write for one real task
  flow
- imported Linear records become graph-native work items with persistent
  `externalRef` mappings
- once a flow is graph-native, Linear state is advisory mirror state only
- deletion or archival in Linear must not delete graph-native execution history

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
  - secret-handle pattern for hidden run data

### Branch 2: Identity, Policy, And Sharing

- dependency direction: Branch 6 depends on Branch 2
- imported contracts:
  - principal ids for runs and decisions
  - capability checks for artifact visibility and task mutation
  - hidden versus replicated predicate rules
- exported contracts:
  - workflow-specific capabilities such as `workflow.run.start`,
    `workflow.artifact.read`, or `workflow.decision.write`
- mockable or provisional:
  - single-user mode can stub broad access while contracts are still moving
- must stabilize before multi-user implementation:
  - policy for prompts, transcripts, and secret-bearing artifacts

### Branch 3: Sync, Query, And Projections

- dependency direction: Branch 6 depends on Branch 3
- imported contracts:
  - `work-queue` scopes
  - `context-bundle` scopes
  - collection indexes for runs, sessions, and artifacts
  - live invalidation for operator surfaces
- exported contracts:
  - projection specs for queue ordering, run history, and retrieval indexes
- mockable or provisional:
  - work queue reads may start as whole-graph or bounded local reads
  - context retrieval may start with one narrow scope
- must stabilize before large-scale implementation:
  - scope completeness and invalidation behavior for queue views

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
  - final manifest field names for context providers and workflow registration

### Branch 5: Blob, Ingestion, And Media

- dependency direction: Branch 6 depends on Branch 5 for large artifacts and
  ingest-triggered work
- imported contracts:
  - blob metadata records
  - queue-backed ingest jobs
  - provenance links from extracted content
- exported contracts:
  - review tasks created from ingest results
  - artifact references attached to runs
- stable before safe implementation:
  - blob id and provenance contracts

### Branch 7: Web And Operator Surfaces

- dependency direction: Branch 7 depends on Branch 6
- imported by Branch 7:
  - queue summaries
  - run/session/artifact inspection views
  - retained context and decision history
- exported back to Branch 6:
  - operator actions such as rerun, cancel, or acknowledge blocker
- provisional:
  - exact UI route shapes and live UX behavior

## 8. Main Flows

### 1. Mirror one external task flow into graph-native work items

1. initiator: migration worker or operator action
2. components involved: `TrackerMirrorAdapter`, workflow authority runtime,
   Branch 1 persistence
3. contract boundaries crossed:
   - external tracker read
   - authoritative graph write
4. authoritative write point:
   - create or update `WorkflowStream`, `WorkflowFeature`, `WorkflowTask`, and
     `TrackerMirror`
5. failure or fallback behavior:
   - if the external read fails, no partial graph work item is created
   - if graph write fails, the external tracker remains unchanged
   - if mirror metadata is stale, keep graph state and mark mirror for retry

### 2. Select runnable work and claim it

1. initiator: supervisor loop
2. components involved: `WorkflowQueueScope`, workflow authority runtime,
   Branch 3 projection or bounded read
3. contract boundaries crossed:
   - read runnable tasks
   - authoritative run-start command
4. authoritative write point:
   - create `WorkflowRun`
   - set `WorkflowTask.activeRunId`
   - transition task to `in-progress`
5. failure or fallback behavior:
   - if queue view is stale, refresh scope and retry
   - if another actor already claimed the task, reject with `run-conflict`
   - do not start local execution until claim succeeds

### 3. Resolve the task-specific context bundle

1. initiator: worker after run claim
2. components involved: context retrieval engine, Branch 3 context scope,
   repo metadata, prior run history
3. contract boundaries crossed:
   - authorized scope reads
   - authoritative bundle write
4. authoritative write point:
   - create immutable `ContextBundle` and ordered `ContextBundleEntry` records
   - attach bundle id to `WorkflowRun`
5. failure or fallback behavior:
   - if required sources are missing or policy-filtered, fail the run before
     execution
   - if retrieval is incomplete, mark run `blocked` rather than executing with
     an unknown bundle

### 4. Execute a run and record sessions, events, artifacts, and decisions

1. initiator: worker process
2. components involved: execution runner, workspace manager, authoritative
   workflow runtime
3. contract boundaries crossed:
   - local command execution
   - session creation and event append
   - artifact and decision writes
4. authoritative write point:
   - `AgentSession`
   - ordered `AgentSessionEvent`
   - `WorkflowArtifact`
   - `WorkflowDecision`
   - final `WorkflowRun` completion transition
5. failure or fallback behavior:
   - local execution failure records `failed` run state and retained output
   - persistence failure must not silently discard already-emitted events;
     retry append or fail the run explicitly

### 5. Finalize the result and mirror it back out

1. initiator: worker completion or separate finalizer
2. components involved: workspace manager, workflow authority runtime,
   `TrackerMirrorAdapter`
3. contract boundaries crossed:
   - local git landing or cleanup
   - authoritative finalization write
   - external tracker write
4. authoritative write point:
   - set `WorkflowRun.finalization`
   - transition work item to `done`, `blocked`, or back to `todo`
5. failure or fallback behavior:
   - if git finalization fails, preserve run and branch state, mark
     `pending-finalization`, and do not lie to the tracker
   - if tracker mirror fails, keep graph state and retry out-of-band

### 6. Inspect retained history after restart

1. initiator: TUI attach, web operator view, or MCP client
2. components involved: Branch 3 workflow view projections, retained graph
   records
3. contract boundaries crossed:
   - scope read for one run or task history
4. authoritative write point:
   - none; read-only flow
5. failure or fallback behavior:
   - if projection is stale, rebuild or fall back to bounded direct read
   - retained history must remain inspectable even when the original worker
     process is gone

## 9. Invariants And Failure Handling

### Invariants

- every task belongs to exactly one feature and one stream
- a run belongs to exactly one work item
- only one active execute run may exist for one feature at a time
  - this preserves the current repo rule that features may run in parallel, but
    tasks inside one feature do not
- `WorkflowTask.activeRunId` may point to at most one non-terminal run
- context bundles are immutable once attached to a run
- session event sequence is strictly monotonic within one session
- artifacts and decisions preserve provenance to run and session
- external tracker state never overwrites newer graph-native state
- operator summaries are derived views, not the source of truth

### Failure modes

`Run claim conflict`

- what fails: two supervisors try to start work on the same task or feature
- what must not corrupt: current task state and active run pointer
- retry or fallback: loser refreshes queue scope and does not start execution
- observability needed: run-conflict count and affected work item ids

`Context retrieval failure`

- what fails: required docs, artifacts, or prior decisions cannot be resolved
- what must not corrupt: work item lineage and any prior run history
- retry or fallback: mark run `blocked`; operator may rerun after fixing inputs
- observability needed: missing-source reason, policy-denied counts, bundle
  assembly latency

`Worker crash after partial event emission`

- what fails: local process dies mid-run
- what must not corrupt: already accepted session events and artifact records
- retry or fallback: next supervisor cycle may mark run failed or interrupted
  after lease timeout; session history stays readable
- observability needed: heartbeat age, interrupted runs, orphaned sessions

`Finalization failure`

- what fails: commit landing, branch cleanup, or tracker sync
- what must not corrupt: successful run result and retained artifacts
- retry or fallback: keep run `pending-finalization`; preserve branch metadata
  and mirror retry state
- observability needed: pending-finalization age, mirror retry backlog

`Projection or queue lag`

- what fails: Branch 3 read model falls behind
- what must not corrupt: authoritative run or task state
- retry or fallback: refresh from direct bounded reads or rebuild projection
- observability needed: projection lag, fallback count, scope freshness

## 10. Security And Policy Considerations

- prompts, session transcripts, raw command output, and some artifacts may
  contain secrets or policy-restricted data
- the graph-visible run summary must separate safe replicated fields from
  authority-only content
- browser or MCP consumers should receive safe summaries by default; raw
  transcript access requires explicit capability
- `ContextBundleEntry` may point at secret-backed or policy-filtered sources,
  but any plaintext reveal still follows Branch 2 and Branch 1 secret-handle
  rules
- agent runtimes execute as an explicit principal or service actor, not as an
  unscoped system backdoor
- tracker mirrors must never leak hidden fields to external systems
- local filesystem paths are sensitive runtime hints and should be treated as
  operator-visible metadata, not broadly replicated user content

## 11. Implementation Slices

### Slice 1: Graph-native workflow schema and Linear mirror

- goal: define `WorkflowStream`, `WorkflowFeature`, `WorkflowTask`,
  `WorkflowRun`, `AgentSession`, `WorkflowArtifact`, `WorkflowDecision`, and
  `ContextBundle`
- prerequisite contracts:
  - Branch 1 write and persistence contracts
  - provisional Branch 4 built-in module registration
- what it proves:
  - one real Linear-backed flow can exist in graph-native records
  - graph becomes the durable source of truth for that flow
- what it postpones:
  - full queue scopes
  - polished operator UI

### Slice 2: Run claim and context-bundle retrieval

- goal: let the supervisor read one runnable task from the graph, claim it, and
  resolve a graph-backed context bundle
- prerequisite contracts:
  - Slice 1 schema
  - narrow Branch 3 work-queue and context-bundle reads
- what it proves:
  - the agent no longer depends on repo-local prompt assembly as the source of
    truth
- what it postpones:
  - advanced retrieval scoring
  - live push updates

### Slice 3: Session, artifact, and decision writeback

- goal: replace retained runtime files as the primary history surface with
  graph-native run records
- prerequisite contracts:
  - Slice 2 run start and context bundle
- what it proves:
  - TUI and future web surfaces can inspect run history from the graph
- what it postpones:
  - transcript search
  - blob spillover optimization for very large event bodies

### Slice 4: Finalization and operator inspection

- goal: finalize successful runs, expose pending-finalization states, and
  render workflow history in Branch 7 surfaces
- prerequisite contracts:
  - Slice 3 retained run history
  - provisional Branch 7 read views
- what it proves:
  - the graph can power the system's own operator loop end to end
- what it postpones:
  - generalized multi-user operations
  - future planning heuristics

## 12. Open Questions

- Should raw `AgentSessionEvent` payloads always stay inline in graph records,
  or should large transcript fragments spill to Branch 5 blob records after a
  size threshold?
- Should `ContextBundle` be fully materialized before every run, or can some
  entries remain lazy references with a frozen definition hash?
- What is the exact capability model for reading prompts, raw transcripts, and
  command output in multi-user graphs?
- How much of current queue ordering should be authoritative branch logic
  versus Branch 3 projection behavior?
- When the same work item is mirrored to Linear, which transition points should
  happen synchronously versus through retryable background mirror jobs?

## 13. Recommended First Code Targets

- `src/graph/modules/ops/workflow/`: add the first built-in graph-native
  workflow module with type definitions and contract tests
- `src/agent/service.ts`: replace Linear-first task selection with graph-backed
  run claim and completion writes
- `src/agent/context.ts`: split current repo-local bundle assembly into a
  graph-native `ContextBundleRequest` path plus a fallback adapter
- `src/agent/tui/session-events.ts`: treat the existing event envelope as the
  retained session history contract and move persistence behind it
- `src/agent/tracker/linear.ts`: demote to mirror adapter and mapping resolver
- `src/agent/workspace.ts`: keep local execution mechanics, but write final
  outcomes through graph-native run finalization rather than filesystem-only
  state
