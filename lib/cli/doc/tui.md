---
name: CLI workflow TUI
description: "Current graph-backed workflow TUI owned by @op/cli."
last_updated: 2026-04-07
---

# CLI workflow TUI

## Read this when

- you are changing `io tui`
- you need the boundary between the workflow TUI and the legacy agent TUI
- you are tracing startup, projection reads, selection state, or the current
  action model in `lib/cli/src/tui/*`

## Purpose

The workflow TUI is the graph-backed terminal product surface for workflow
work. It is the terminal sibling to the browser workflow shell, and it stays
separate from the legacy retained-session monitor in `lib/cli/src/agent/tui/*`
so workflow screens have one stable home.

Shipping note:

- the first shipped workflow loop is defined by the browser-first Branch 6
  contract
- this TUI remains a semantic reference and fallback operator surface during
  that transition
- the branch-scoped actions below are not the release gate for the first
  browser-launched session

## Ownership boundary

- keep terminal workflow screen composition, shell chrome, and `io tui`
  bootstrap in `../src/tui/*`
- keep graph source resolution, startup hydration sequencing, and initial
  project or branch selection in `../src/tui/server.ts` and
  `../src/tui/startup.ts`
- keep reusable host-neutral graph React bindings in `@io/graph-react`
- keep reusable workflow projection contracts and read helpers in
  `@io/graph-module-workflow` and the owning graph runtime packages
- keep the retained Linear or session monitor in `../src/agent/tui/*` until
  workflow views replace it

## Entry point

- `io tui [entrypointPath]`

## Current behavior

- loads repo workflow config through the shared `io.ts` and `io.md`
  entrypoint-path resolution
- starts in an explicit loading shell, then hydrates the first branch-board and
  commit-queue surface from synced workflow projection reads
- creates a synced workflow HTTP client at startup using the fixed workflow
  review module scope
- boots that client with the full synced workflow and PKM type surface so
  startup validation accepts all entities present in the review scope
- renders a read-only workflow shell after startup resolves graph-backed
  workflow projection data
- shows the workflow branch board, branch detail, and selected branch commit
  queue in one screen composition
- presents startup failures in-shell when initialization or initial-scope
  resolution fails

The default local graph served from `http://io.localhost:1355/` seeds one
workflow project, repository, branch, commit, and running session so a fresh
local `io tui` can hydrate without extra graph setup.

## Current action model

The first workflow TUI action slice stays intentionally narrow.

Current actions:

- one branch-scoped session action for the selected `WorkflowBranch`
- one commit-scoped session action for the selected `WorkflowCommit`

Current rules:

- branch session is blocked for `done` or `archived` branches and when the
  branch already has a running commit-scoped session
- commit session is blocked when no commit is selected, when the commit is not
  the branch active commit, when the commit is `planned`, `committed`, or
  `dropped`, or when another running session already owns the branch
- matching running sessions switch the affordance from `Launch ...` to
  `Attach ...`
- request state is keyed by action id plus branch or commit subject so pending,
  success, and failure feedback stays attached to the selected workflow subject

This action model is broader than the first browser milestone. Keep it as a
reference for shared subject-state rules, not as the canonical release gate.

## Minimal keyboard flow

- `left` and `right` move focus between branch board, branch detail, and commit
  queue
- `up` and `down` move the selected branch or commit in the focused panel
- `a` opens or closes the footer action bar
- `n` and `p` cycle the derived actions when the action bar is open
- `Enter` triggers the selected available action
- `q`, `Esc`, and `Ctrl-C` exit the shell

## Startup contract

Current startup stays narrow and explicit:

- workflow entrypoint loading stays shared with `io agent ...`
- graph source precedence is `--graph-url`, then `io.ts -> tui.graph.url`,
  then `http://io.localhost:1355/`
- sync scope is fixed to the workflow review module scope
- initial project resolution is `--project`, then
  `io.ts -> tui.initialScope.project`, then infer the one visible
  `WorkflowProject`
- initial branch resolution is `--branch`, then
  `io.ts -> tui.initialScope.branch`, then the first branch-board row in the
  resolved project

## Migration boundary

- `../src/tui/*` owns workflow branch-board, branch-detail, and commit-queue
  composition plus shell focus, selection, and derived action availability
- `../src/agent/tui/*` still owns the live supervisor or worker monitor,
  retained attach and replay flows, transcript shaping, and Codex event
  normalization
- later session-launch work should start from `../src/tui/*` because the
  workflow shell already owns branch and commit selection
- attach and replay stay in `../src/agent/tui/*` until workflow history reads
  can come from graph-backed `AgentSession` and `AgentSessionEvent` records

## Source anchors

- `../src/tui/index.ts`
- `../src/tui/projection.ts`
- `../src/tui/server.ts`
- `../src/tui/startup.ts`
- `../src/tui/model.ts`
- `../src/tui/layout.ts`
- `../src/tui/tui.tsx`
- `../src/tui/ui.test.ts`
