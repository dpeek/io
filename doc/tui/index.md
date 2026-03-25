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
- the default local graph served from `http://io.localhost:1355/` now seeds one
  workflow project, repository, branch, commit, and running session so a fresh
  local `io tui` can hydrate without extra graph setup
- renders a read-only workflow shell after startup resolves graph-backed
  workflow projection data
- shows the workflow branch board, branch detail, and selected branch commit
  queue in one screen composition
- derives one small action set from the selected branch and commit subject
  state: branch session and commit session
- keeps selection and focus read-only while exposing a footer action bar with
  explicit keyboard access for the derived branch-session and commit-session
  actions
- action triggering now tracks subject-scoped request state in-shell so the
  selected branch or commit can show disabled, pending, success, and failure
  presentation without yet wiring the later launch transport or lifecycle work
- presents startup failures in-shell when graph initialization or initial-scope
  resolution cannot materialize the first workflow surface, rather than
  falling back to static startup copy or the legacy agent monitor

## First Action Surface

The first workflow TUI action model is intentionally narrow. It exposes only:

- one branch-scoped session action for the selected `WorkflowBranch`
- one commit-scoped session action for the selected `WorkflowCommit`

Both actions are derived from selected subject state in `src/tui/model.ts`
rather than from ad hoc renderer checks. The current derived subject fields are:

- selected branch state
- selected commit state
- whether the selected commit is the branch active commit
- whether the selected branch already has a running branch-scoped or
  commit-scoped retained session

Availability rules in the first model:

- branch session action stays on the selected branch and is blocked for
  `done` and `archived` branches or when the branch already has a running
  commit-scoped session
- commit session action stays on the selected commit and is blocked when no
  commit is selected, when the commit is not the branch active commit, when
  the commit is `planned`, `committed`, or `dropped`, or when another running
  session already owns the branch
- when the selected branch or commit already has the matching running session,
  the action switches from `Launch ...` to `Attach ...`
- action request state is keyed by action id plus branch or commit subject so
  pending, success, and failure feedback stays attached to that selected
  workflow subject instead of leaking across the shell
- the shell footer exposes the current action bar state and uses `a` to
  open or close it, `n` and `p` to cycle the selected action, and `Enter` to
  trigger the selected action request
- the branch-detail and commit-queue panels mirror the same derived action
  affordances so disabled reasons and subject-scoped request state stay visible
  even when the footer action bar is closed

## Minimal Keyboard Flow

The minimal workflow TUI keeps navigation and action triggering separate.

- `left` and `right` move focus between branch board, branch detail, and commit
  queue
- `up` and `down` move the selected branch or commit within the currently
  focused panel
- `a` opens or closes the footer action bar for the currently selected branch
  and commit
- when the action bar is open, `n` moves forward through the derived actions and
  `p` moves backward through them
- `Enter` triggers the selected available action and records pending, success,
  or failure state on that branch or commit subject
- `Enter` does not trigger disabled actions, and it does not enqueue duplicate
  requests while the selected subject is already pending
- `q`, `Esc`, and `Ctrl-C` exit the shell

Non-goals for this action slice:

- no arbitrary workflow mutation actions such as reorder, block, archive, or
  rich field editing
- no session launch transport yet; the shell only exposes and reports the
  selected action request, plus local pending/success/failure presentation
- no general editing surface for branch goals, commit titles, or repository
  metadata
- no launch-history, replay, finalization, or retained-transcript UX in
  `src/tui/*`; those remain outside this minimal action slice until later work

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

- no session launch transport or keybinding wiring
- no git reconcile or worktree reservation behavior
- no custom branch-board filter or ordering inputs
- no alternate runtime kinds beyond one HTTP graph base URL

## Migration Notes

- `../../src/tui/*` owns workflow branch-board, branch-detail, and commit-queue
  composition, projection-consumption hooks, plus shell focus, selection, and
  derived action availability behavior
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
  plus workflow screen models, selected subject state, and derived action
  availability built from startup reads and projection queries
- [tui/layout.ts](../../src/tui/layout.ts): render-oriented branch board,
  branch detail, commit queue, and operator action presentation model
- [tui/tui.tsx](../../src/tui/tui.tsx): OpenTUI runtime wrapper and shell
  rendering plus startup hydration, failure presentation, and read-only focus
  and selection handling
- [tui/ui.test.ts](../../src/tui/ui.test.ts): startup hydration and workflow UI
  coverage
