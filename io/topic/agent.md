# IO Agent Stream

## What This Stream Is About

This stream is about increasing the utility and throughput of the IO agent
system.

The current repo already has:

- typed repo config in `io.ts`
- built-in docs, profiles, and issue routing
- a backlog vs execute split
- retained runtime state and stream-based worktree orchestration
- a live TUI plus attach/replay operator workflows

The next step is not "more agent features" in the abstract. It is making the
system better at turning:

- idea
- into spec
- into sub-task plan
- into shipped stream

without losing operator visibility or repo-specific quality.

## Current Focus

The two main priorities in this stream are:

### 1. Improve operator utility

The TUI and plain-text output should make it easy to understand:

- which stream is active
- what each worker is doing
- what context and routing decisions were used
- where a run is blocked
- whether a stream is ready to land

This is about clarity, compression, and trust in the runtime.

### 2. Improve planning and context quality

The context system should make the agent better at repo-local reasoning.

The goal is that you can open a Linear issue and ask the agent:

- how should we improve the system?
- what are the missing specs?
- what child tasks should exist?
- how should this idea be broken into a stream?

That requires the agent to combine:

- repo topic docs
- built-in execution and backlog guidance
- issue history
- existing backlog structure
- stream planning rules

## Where To Look

Runtime and orchestration:

- `agent/src/service.ts`
- `agent/src/workspace.ts`
- `agent/src/server.ts`
- `agent/src/runner/codex.ts`

Operator surfaces:

- `agent/src/tui.ts`
- `agent/src/tui-runtime.ts`
- `agent/src/session-events.ts`
- `tui/src/store.ts`
- `tui/src/transcript.ts`
- `tui/src/tui.tsx`

Context, routing, and built-ins:

- `agent/src/workflow.ts`
- `agent/src/issue-routing.ts`
- `agent/src/builtins.ts`
- `lib/src/config.ts`
- `io.ts`
- `io.md`

Planning and stream model docs:

- `agent/doc/context.md`
- `agent/doc/context-defaults.md`
- `agent/doc/stream-workflow.md`
- `io/topic/goals.md`
- `io/topic/managed-stream-comments.md`
- `io/topic/overview.md`
- `io/topic/io-ts-config.md`
- `io/topic/agent-opentui.md`

## Long-Term Goal

Long term, the agent system should behave like a durable production tool for
technical planning and execution inside the repo.

That means:

- operators can see what is happening in real time
- context selection is explicit and debuggable
- backlog work can refine ideas into implementation-ready specs
- parent issues can become streams with coherent child tasks
- execution work can move child tasks to landed changes with minimal manual
  coordination
- the system keeps multiple streams moving without turning the repo into chaos

The target is an agent loop that is both high-throughput and legible.

## Current Repo State

As of March 2026, the main operator foundation for this stream is already in
place:

- normalized session events drive stdout, retained logs, attach/replay, and the
  TUI
- the interactive operator UI now lives mostly in the standalone `tui/`
  package rather than only under `agent/src/tui*`
- stream-aware scheduling already prefers one active worker per stream while
  allowing multiple streams to move in parallel

The active work in the tree is focused on output readability rather than adding
new orchestration features:

- simplify supervisor and worker transcript text so the readable path does not
  depend on `[STATUS]` or similar prefixes
- show workspace paths relative to the repo root when possible
- surface clearer supervisor lines when a worker is created, started, or
  blocked

## Good Changes In This Stream

Good work in this stream usually improves one of these:

- signal-to-noise in operator output
- visibility into context and routing choices
- quality of backlog/spec refinement
- automatic creation of better child-task structure
- confidence that stream state, branch state, and issue state all line up

If a change makes the system "more autonomous" but harder to inspect or steer,
it is probably the wrong trade.
