# Agent TUI

## Purpose

The agent TUI is the operator-facing view over supervisor and worker session
output.

It supports three workflows:

- `io agent tui`
  - start the supervisor in TUI mode and render live session events
- `io agent tui attach <issue>`
  - reconstruct an issue view from retained runtime files and continue tailing it
- `io agent tui replay <issue> [--delay-ms <ms>]`
  - replay retained runtime output into the TUI without starting a fresh run

`io agent tail <issue>` remains the plain log-following path when a full TUI
reconstruction is unnecessary.

## Operator Model

The TUI is a left-to-right session timeline.

- the leftmost column is the supervisor session
- each issue worker gets its own column
- columns are ordered by first-seen event sequence

Each column is session-oriented, not file-oriented. A column can contain:

- readable status events
- streamed agent message text
- command output
- raw Codex JSONL lines
- stderr lines

This gives live visibility into scheduled workers now while preserving a path to
true nested child-agent columns later.

## Architecture

The TUI has four layers:

1. `AgentService`
   - owns the live supervisor session
   - schedules issue runs and publishes supervisor plus worker session events

2. `CodexAppServerRunner`
   - normalizes Codex JSON-RPC output into `AgentSessionEvent` records
   - emits lifecycle, status, and raw-line events
   - writes retained runtime files per issue:
     - `events.log`
     - `codex.stdout.jsonl`
     - `codex.stderr.log`
     - `codex.session.log`
     - `output.log`

3. `AgentTuiStore`
   - folds session events into display snapshots
   - keeps the supervisor column first and appends transcript text per session
   - retains parent session ids even though the current UI is mostly top-level

4. `AgentTuiRetainedReader`
   - rebuilds a worker session from `issue-state.json`
   - prefers `events.log` when present
   - falls back to `codex.stdout.jsonl` when only raw Codex output is available
   - feeds attach and replay mode without requiring a fresh launch

## Event Model

The core design rule is that the TUI consumes normalized session events rather
than scraping terminal text.

The event stream carries three kinds of data:

- session lifecycle
  - scheduled, started, completed, failed, stopped
- readable status events
  - turn lifecycle, approval requests, tool calls, command runs, streamed agent
    text, and errors
- raw line events
  - stdout JSONL and stderr/text output

This lets the same runtime data power:

- the live TUI
- retained runtime logs
- stdout rendering in non-TUI mode
- attach and replay reconstruction

## Retained Runtime Files

The issue runtime directory lives under the configured workspace root:

- `issues/<issue-key>/issue-state.json`
- `issues/<issue-key>/events.log`
- `issues/<issue-key>/codex.stdout.jsonl`
- `issues/<issue-key>/codex.stderr.log`
- `issues/<issue-key>/output.log`

`issue-state.json` provides the durable branch, worktree, worker id, and status
metadata used to rebuild the worker column when no live service is present.

`events.log` is the preferred retained source because it preserves the
normalized event model. `codex.stdout.jsonl` is the fallback when only raw Codex
output is available.

## Operator Workflows

### Live

Use live mode when you want the scheduler and worker runs to start in the
current terminal session.

```sh
io agent tui
io agent tui ./io.ts --once
```

Live mode starts the normal agent service and attaches the TUI as an observer.

### Attach

Use attach mode when a worker has already started and its runtime files are
being retained on disk.

```sh
io agent tui attach OPE-70
io agent tui attach OPE-70 ./io.ts
```

Attach mode:

- reads `issue-state.json` to rebuild the worker session metadata
- hydrates the frame from retained logs
- continues polling the retained files for appended output

This is the operational path for reconnecting to an already-running issue from a
new terminal.

### Replay

Use replay mode when you want to inspect a retained run from the beginning
without following a live process.

```sh
io agent tui replay OPE-70
io agent tui replay OPE-70 --delay-ms 20
```

Replay mode:

- rebuilds the same initial columns as attach mode
- emits retained events back through the normal TUI store
- leaves the final frame on screen after playback completes

## Data Flow

### Live

1. CLI starts `AgentService` in TUI mode.
2. `AgentService` emits supervisor and worker session events.
3. `CodexAppServerRunner` emits normalized status and raw-line events.
4. `AgentTuiStore` folds those events into session snapshots.
5. The renderer prints one column per session in creation order.

### Attach and replay

1. CLI loads workflow config and retained issue state.
2. `AgentTuiRetainedReader` rebuilds synthetic supervisor and worker sessions.
3. Retained events are read from `events.log` or reconstructed from
   `codex.stdout.jsonl`.
4. The same TUI store and renderer consume those events.

The important property is that live and retained modes converge on the same
session-event surface.

## Current Limitation

The current retained-reader path intentionally maps the initial columns to:

- the synthetic supervisor session
- the issue-worker session

If a worker later spawns nested agents, their retained events are folded back
into the issue-worker column instead of rendering dedicated child columns.

The live model already keeps `parentSessionId` and `rootSessionId`, so the data
shape is compatible with future nested-agent support even though the retained
path does not yet reconstruct child sessions distinctly.

## Follow-Up Work

- persist explicit child-session metadata in retained logs
- preserve distinct child session ids during attach and replay
- render additional columns for spawned agents instead of collapsing them into
  the issue-worker transcript
- add richer event compression and filtering once the base multi-column view is
  stable
