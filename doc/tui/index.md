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
- keep graph source resolution, startup hydration sequencing, initial
  project-or-branch selection, and startup failure presentation in
  `../../src/tui/server.ts` and `../../src/tui/startup.ts`
- keep reusable graph-aware OpenTUI bindings in
  `../../src/graph/adapters/react-opentui/*`
- keep reusable workflow projection contracts, sync-scope descriptors, and
  read helpers in `../../src/graph/modules/ops/workflow/*` and
  `../../src/graph/runtime/*`
- keep the retained Linear/session monitor in `../../src/agent/tui/*` until
  workflow views replace it

## Entry Points

- `io tui [entrypointPath]`: start the graph-backed terminal workflow shell
  using the same workflow entrypoint resolution as `io agent ...`

## Current Behavior

- loads the repo workflow config through the existing `io.ts` and `io.md`
  entrypoint path resolution
- starts in an explicit loading shell, then hydrates the first branch-board
  and commit-queue surface from synced workflow projection reads
- creates a synced workflow HTTP client at startup using the fixed workflow
  review module scope before resolving the first project-backed workflow shell
- renders a read-only workflow shell after startup resolves graph-backed
  workflow projection data
- shows the workflow branch board, branch detail, and selected branch commit
  queue in one screen composition
- keeps selection and panel focus inside the shell read-only; editing and
  Codex session launch remain follow-up work
- presents startup failures in-shell when graph initialization or initial-scope
  resolution cannot materialize the first workflow surface, rather than
  falling back to static startup copy or the legacy agent monitor

## Startup Contract

The first `io tui` startup contract keeps hydration narrow and explicit before
transport wiring lands.

- workflow entrypoint loading stays shared with `io agent ...`: the CLI accepts
  `entrypointPath` and otherwise resolves `./io.ts` plus `./io.md`
- graph source is one HTTP runtime location with this precedence:
  `--graph-url`, then `io.ts -> tui.graph.url`, then
  `http://io.localhost:1355/`
- sync scope is fixed to the workflow review module scope
  `ops/workflow / scope:ops/workflow:review`; callers do not choose arbitrary
  graph or projection scopes in the first contract
- initial project resolution is:
  `--project`, then `io.ts -> tui.initialScope.project`, then infer the one
  visible `WorkflowProject` from the synced workflow scope
- initial branch resolution is:
  `--branch`, then `io.ts -> tui.initialScope.branch`, then select the first
  branch-board row in the resolved project

The matching optional `io.ts` surface is:

```ts
tui: {
  graph: {
    kind: "http",
    url: "https://graph.example/",
  },
  initialScope: {
    project: "project:io",
    branch: "branch:workflow-runtime-contract",
  },
}
```

Non-goals for this first contract:

- no session launch or action wiring
- no git reconcile or worktree reservation behavior
- no custom branch-board filter or ordering inputs
- no alternate runtime kinds beyond one HTTP graph base URL

## Migration Notes

- `../../src/tui/*` owns workflow branch-board, branch-detail, and commit-queue
  composition, projection-consumption hooks, plus shell focus and selection
  behavior
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
- [tui/projection.ts](../../src/tui/projection.ts): workflow-owned React hooks
  that bind synced graph runtimes to projection reads for branch-board and
  commit-queue screens
- [tui/server.ts](../../src/tui/server.ts): `io tui` CLI parsing, synced graph
  bootstrap, and startup sequencing
- [tui/startup.ts](../../src/tui/startup.ts): resolved graph source and initial
  workflow scope contract used by `io tui`
- [tui/model.ts](../../src/tui/model.ts): startup loading and failure surfaces
  plus workflow screen models built from startup reads and projection queries
- [tui/layout.ts](../../src/tui/layout.ts): render-oriented branch board,
  branch detail, and commit queue layout model
- [tui/tui.tsx](../../src/tui/tui.tsx): OpenTUI runtime wrapper and shell
  rendering plus startup hydration, failure presentation, and read-only focus
  and selection handling
- [tui/ui.test.ts](../../src/tui/ui.test.ts): startup hydration and workflow UI
  coverage
