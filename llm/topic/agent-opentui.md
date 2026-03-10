# OpenTUI Multi-Agent Column View

Status: Proposed

## Why This Exists

`io` already has the beginnings of a streamable runtime:

- `agent/src/service.ts` schedules issue runs and can run more than one issue at a
  time
- `agent/src/runner/codex.ts` already writes three distinct outputs per run:
  `codex.session.log`, `events.log`, and `codex.stdout.jsonl`
- `agent/src/server.ts` already treats retained issue output as something worth
  tailing live

What is missing is a real operator surface.

Today, live visibility is split across:

- interleaved process stdout
- per-issue `output.log`
- per-issue runtime JSON state
- raw Codex App Server JSONL

That is enough for debugging, but not enough for understanding a live agent tree.

The desired UX is:

- launching the agent opens a terminal UI
- the primary agent output appears in the leftmost column
- when the runtime spawns another agent, a new column appears to the right
- each column shows both:
  - readable status updates
  - raw Codex App Server text/events

This proposal describes how to add that experience without throwing away the
current runner and log architecture.

## Current Repo Constraints

The design needs to fit the repo as it exists today:

- the CLI entrypoint is `cli/src/cli.ts`
- agent lifecycle orchestration lives in `agent/src/service.ts`
- Codex App Server integration lives in `agent/src/runner/codex.ts`
- runtime workspace and retained issue state live in `agent/src/workspace.ts`
- the repo is already Bun-based, which aligns with OpenTUI's current runtime
  model

There is also an important product constraint:

- the repo has first-class visibility into issue workers today
- it does not yet have a first-class concept of nested spawned Codex subagents

So the proposal should support two layers:

1. immediate support for top-level issue workers as columns
2. a compatible path for true nested agent columns once spawn metadata is
   available from the runtime or raw Codex events

## What The Runtime Already Gives Us

Per issue run, `agent/src/runner/codex.ts` already produces:

- `codex.session.log`
  - readable summarized session output
- `events.log`
  - structured lifecycle events such as `session.started`, `turn.started`, and
    `session.event`
- `codex.stdout.jsonl`
  - raw JSON lines from Codex App Server
- `codex.stderr.log`
  - raw stderr lines
- `output.log`
  - combined operator-facing text

The runner also already converts raw JSON-RPC messages into useful readable
status lines, including:

- turn lifecycle
- approval requests
- tool calls
- command executions and command output
- agent message deltas

That means the TUI does not need to invent status rendering from scratch. The
main missing piece is a stable event bus and a UI process that consumes it.

## Proposed Product Model

### Column semantics

Treat the TUI as a left-to-right session timeline.

- column 1
  - the primary runtime session
  - initially this is the `io agent` supervisor process and/or the first active
    issue run
- column N+1
  - the next spawned or scheduled agent session

Each column represents one live session, not one file.

Each session column should have:

- header
  - session title
  - issue identifier if available
  - worker id
  - status
- readable activity pane
  - summarized status updates from normalized runtime events
- raw output pane
  - raw Codex App Server JSONL or text lines

The simplest usable layout is one scrollable feed per column with prefixed row
types such as:

- `status`
- `tool`
- `command`
- `raw`
- `stderr`

That satisfies the requirement without needing a complicated split-pane inside
every column on day one.

### What counts as a spawned agent

There are two valid interpretations in this repo:

#### Level 1: scheduled issue workers

This is available now.

When `agent/src/service.ts` starts a new issue run, the TUI can create a new
column for that worker session. This immediately improves multi-agent visibility
for the repo as it exists today.

#### Level 2: nested Codex-delegated agents

This is not yet modeled explicitly in the repo.

To support true child-agent columns inside a single issue run, the runtime will
need one of:

- explicit spawn events emitted by our harness
- raw Codex events that include parent/child session identity

The TUI architecture should support parent-child sessions now, even if the
first implementation only produces top-level worker sessions.

## Recommended Architecture

### 1. Add a normalized runtime event model

Introduce a small shared event surface, likely in `agent/src/types.ts` or a new
`agent/src/ui-events.ts`.

Suggested shape:

```ts
type AgentUiEvent =
  | {
      type: "session.created";
      sessionId: string;
      parentSessionId?: string;
      issueIdentifier?: string;
      title: string;
      workerId?: string;
      createdAt: string;
    }
  | {
      type: "session.status";
      sessionId: string;
      level: "info" | "warn" | "error";
      text: string;
      ts: string;
    }
  | {
      type: "session.raw";
      sessionId: string;
      stream: "stdout" | "stderr" | "codex-json";
      text: string;
      ts: string;
    }
  | {
      type: "session.completed";
      sessionId: string;
      result: "success" | "blocked" | "failed" | "cancelled";
      ts: string;
    };
```

Important design rule:

- the TUI should consume normalized events
- file logging should become one sink for those events
- console printing should become another sink

That prevents the UI from scraping terminal text or reverse-engineering log
files that the runtime is already in a position to describe correctly.

### 2. Turn the runner into a multi-sink publisher

`agent/src/runner/codex.ts` should keep writing the current files, but it should
also publish normalized events for:

- session start/stop
- turn start/complete/fail
- command execution started/completed
- tool call started/completed
- approval required
- agent text deltas
- raw stdout/stderr lines

That can be done with an observer pattern:

- `RunObserver.onEvent(event)`
- `RunObserver.onReadableLine(line)`
- `RunObserver.onRawLine(line)`

This is a cleaner fit than teaching the TUI to tail `codex.session.log` and
`codex.stdout.jsonl` in real time, though attach/replay mode can still use files
later.

### 3. Publish supervisor-level events from the service

`agent/src/service.ts` should publish higher-level lifecycle events that the
runner cannot know:

- scheduler idle
- issue selected
- issue run started
- issue run blocked
- issue committed
- issue finalized

This is how the leftmost column becomes useful instead of only showing Codex
session content.

### 4. Add a dedicated TUI runtime surface

Add a new package rather than embedding OpenTUI directly into `@io/agent`.

Recommended workspace:

- `agent-tui`
  - depends on `@io/agent`
  - depends on `@opentui/core`

Why a separate package:

- keeps terminal UI dependencies out of the core runtime package
- preserves `@io/agent` as the headless execution engine
- makes it easier to keep a plain non-TUI mode for CI, logs, and scripts

### 5. Add a new CLI command

Extend `cli/src/cli.ts` and `agent/src/server.ts` with a TUI-oriented entrypoint:

- `io agent tui [entrypointPath]`

Recommended behavior:

- `io agent start`
  - existing stdout-driven behavior
- `io agent tui`
  - launches the same agent service with a TUI observer attached

This keeps the execution engine single-sourced while allowing multiple operator
surfaces.

## OpenTUI Fit

OpenTUI is a good match here for repo-specific reasons:

- it is Bun-native, which matches this repo's current runtime
- it has a flexible box layout model for horizontally growing columns
- it supports scrollable and continuously updating terminal views

The root layout should be a horizontal `Box` whose children are session columns.

Each session column should be a vertical `Box` with:

- a fixed header block
- a growing scroll region for events
- optional footer hints for keybindings

As sessions are created:

- append a column to the right
- preserve creation order
- auto-scroll the active column
- allow keyboard navigation left/right between columns

Recommended MVP keybindings:

- `h` / `l`
  - move focus between columns
- `j` / `k`
  - scroll current column
- `r`
  - toggle raw-heavy view for current column
- `s`
  - toggle status-only compression
- `q`
  - quit the TUI without killing already-running background work, if feasible

## Data Flow

The intended live path is:

1. CLI starts agent service with a TUI observer
2. service emits supervisor lifecycle events
3. each issue run emits session and raw runner events
4. TUI store normalizes them into a session tree
5. OpenTUI renders one column per session in creation order

The important point is that the TUI should render from an in-memory event store,
not directly from stdout.

That store should keep:

- session metadata
- parent-child relationships
- bounded event history per column
- current status summary
- unread/activity markers

## Session Tree Model

Even if the first pass only has top-level issue workers, the UI model should be
tree-shaped instead of flat.

Suggested session state:

```ts
type SessionViewState = {
  id: string;
  parentId?: string;
  title: string;
  issueIdentifier?: string;
  workerId?: string;
  status: "queued" | "running" | "blocked" | "success" | "failed" | "idle";
  createdAt: string;
  updatedAt: string;
  items: Array<{
    kind: "status" | "raw" | "stderr" | "tool" | "command";
    text: string;
    ts: string;
  }>;
};
```

Why keep parent ids if columns are simply left-to-right:

- future nested agent support needs lineage
- the UI can show ancestry in the column header
- replay/export becomes easier

## Attach And Replay Mode

The event bus should be the primary live path, but the file layout is already
good enough to support later replay features.

Possible follow-up modes:

- `io agent tui --attach`
  - reconstruct live columns from retained runtime state and continue tailing
- `io agent tui --replay <issue>`
  - load `events.log` and `codex.stdout.jsonl` into a read-only session viewer

This is a strong reason to keep writing the current log files even after the TUI
exists.

## Repo Changes

### `agent/src/runner/codex.ts`

Add a publish/observe layer around the existing readable rendering and raw
logging.

Keep:

- current file outputs
- current readable rendering logic

Add:

- normalized event emission
- raw line emission with session identity
- optional parent session identity for future nested agents

### `agent/src/service.ts`

Add supervisor-level event emission.

This is also the right place to define what the first column means in practice:

- scheduler state
- selected issues
- active worker sessions
- completion and blockage summaries

### `agent/src/server.ts`

Add a TUI command alongside `start`, `tail`, and `validate`.

### `agent/src/types.ts`

Add shared UI event and session model types, or add a small dedicated module for
them.

### `cli/src/cli.ts`

Wire `io agent tui` through to the agent package.

### New package: `agent-tui`

Own:

- OpenTUI renderer bootstrap
- event store
- column components
- keybindings
- session formatting helpers

Do not make `agent-tui` responsible for:

- tracker access
- workspace management
- Codex protocol handling

Those should remain in `@io/agent`.

## Phased Plan

### Phase 1: top-level worker columns

Build a TUI around current issue-worker concurrency.

- add normalized service and runner events
- add `io agent tui`
- render one column for supervisor and one per issue run
- show readable events plus raw lines in each column

This is the fastest route to value and uses data the repo already has.

### Phase 2: richer event compression

Improve readability.

- collapse noisy delta streams into grouped blocks
- highlight command start/finish
- show compact status badges
- add filtering and raw/status toggles

### Phase 3: true spawned-agent columns

Extend the runtime once parent-child session metadata exists.

- emit child session creation events
- preserve lineage in the TUI store
- render nested delegated agents as additional right-side columns

### Phase 4: attach/replay

Make the TUI useful beyond only fresh launches.

- reconstruct state from retained runtime files
- replay historical runs for debugging

## Open Questions

- Should column 1 be the scheduler/supervisor, or should it immediately become
  the first active issue run?
- Do we want one merged event feed per column, or a split readable/raw sublayout
  inside each column?
- What exact runtime signal will define a true spawned child agent inside a
  single Codex session?
- Should `io agent tui` own the agent lifecycle directly, or should it be able
  to attach to an already running headless process?

## Recommendation

Implement this as a headless-runtime-plus-TUI-observer design.

Concretely:

- keep `@io/agent` as the execution engine
- add normalized event publishing in `service.ts` and `runner/codex.ts`
- add a separate `agent-tui` workspace using `@opentui/core`
- add `io agent tui` as a new operator surface
- ship the first version using supervisor plus issue-worker columns
- reserve true nested spawned-agent columns for a second pass once parent-child
  Codex session metadata is available

This approach fits the current repo, preserves the existing log files, and gets
to a useful multi-column live view without blocking on a deeper rework of the
agent runtime.
