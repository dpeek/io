# TUI Overview

## Purpose

`tui` owns the graph-backed terminal product surface for workflow work. It is
the terminal sibling to `web`, and it exists separately from the legacy
`agent/tui` retained-session monitor so downstream workflow screens have a
stable home.

## Ownership Boundary

`tui` is the terminal product shell, not the shared graph/OpenTUI adapter
package.

- keep terminal workflow screen composition, shell chrome, and CLI entry flow
  in `../../src/tui/*`
- keep reusable graph-aware OpenTUI bindings in
  `../../src/graph/adapters/react-opentui/*`
- keep the retained Linear/session monitor in `../../src/agent/tui/*` until
  workflow views replace it

## Entry Points

- `io tui [entrypointPath]`: bootstrap the terminal workflow shell using the
  same workflow entrypoint resolution as `io agent ...`

## Current Behavior

- loads the repo workflow config through the existing `io.ts` and `io.md`
  entrypoint path resolution
- renders a read-only workflow shell when the caller provides graph-backed
  workflow projection data
- shows the workflow branch board, branch detail, and selected branch commit
  queue in one screen composition
- keeps selection and panel focus inside the shell read-only; editing and
  Codex session launch remain follow-up work
- retains the bootstrap shell as the CLI fallback until runtime wiring can
  provide a real workflow graph source at process startup

## Migration Notes

- `../../src/tui/*` owns workflow branch-board, branch-detail, and commit-queue
  composition plus shell focus and selection behavior
- `../../src/agent/tui/*` still owns the live supervisor or worker monitor,
  retained attach and replay flows, transcript shaping, and Codex event
  normalization
- later session-launch work should start from `../../src/tui/*` because the
  workflow shell already owns branch and commit selection; launch wiring should
  reuse shared runtime services rather than copy legacy session-monitor UI
- later replay work should stay in `../../src/agent/tui/*` until the workflow
  shell can read graph-backed `AgentSession` and `AgentSessionEvent` history
  directly
- keep workflow shell regressions in `../../src/tui/ui.test.ts` and retained
  session-monitor regressions in `../../src/agent/tui/ui.test.ts` so the
  product boundary stays explicit while both surfaces coexist

## Code Surface

- [tui/index.ts](../../src/tui/index.ts): public TUI surface exports
- [tui/server.ts](../../src/tui/server.ts): `io tui` CLI parsing and startup
- [tui/model.ts](../../src/tui/model.ts): bootstrap fallback plus workflow
  screen models built from projection queries
- [tui/layout.ts](../../src/tui/layout.ts): render-oriented branch board,
  branch detail, and commit queue layout model
- [tui/tui.tsx](../../src/tui/tui.tsx): OpenTUI runtime wrapper and shell
  rendering plus read-only focus and selection handling
- [tui/ui.test.ts](../../src/tui/ui.test.ts): bootstrap and workflow UI
  coverage
