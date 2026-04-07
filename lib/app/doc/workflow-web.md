---
name: App workflow web
description: "Current app-owned browser workflow surface and its boundary with the authority and browser-agent runtimes."
last_updated: 2026-04-07
---

# App workflow web

## Read this when

- you are changing `/workflow` in the browser app
- you need the current boundary between app-owned workflow pages, the
  authoritative workflow runtime, and the local browser-agent bridge
- you want the current-state replacement for `doc/agent/browser.md`

## Purpose

`@io/app` owns the shipped browser workflow route and its Worker-facing read,
live-refresh, and retained-history integration. The app route uses the local
browser-agent runtime for launch, attach, and low-latency session events, but
the authority remains the source of truth for workflow state and retained
history.

## Current route contract

- `/workflow` is a workflow-native route, not a generic entity browser
- `WorkflowPage` gates on an authenticated browser session, then boots
  `GraphRuntimeBootstrap` against the packaged workflow review sync scope
- startup resolution uses `createWorkflowReviewStartupContract(...)` and
  `resolveWorkflowReviewStartupState(...)`
- the main page reads the implicit-main commit workflow contract through
  `main-commit-workflow-scope`

## Current browser surface

The shipped browser route currently provides:

- project resolution inside the workflow review scope
- a browser-owned branch board, branch detail, and commit queue layout
- selected-commit detail derived from `MainCommitWorkflowScope`
- retained session-feed reads for the selected branch or commit
- browser-owned launch and attach affordances wired to the local
  browser-agent runtime
- optional low-latency session-event streaming layered on top of retained
  history

## Current authority boundary

- the authority serves workflow reads, workflow mutations, retained session
  history, artifact persistence, and decision persistence
- retained session history is read from graph-backed `AgentSession` and
  `AgentSessionEvent` records
- the browser live transport is a freshness transport for workflow projections;
  it invalidates and re-pulls scoped data, but it is not the retained session
  transcript source of truth

## Current browser-agent boundary

- the local browser-agent runtime owns filesystem-backed launch, attach, and
  local session-event streaming
- the browser probes runtime readiness through `GET /health`
- launch and attach use `POST /launch-session` and `POST /active-session`
- low-latency session events stream over `POST /session-events`
- browser-agent runtime availability is surfaced explicitly in the page rather
  than being hidden behind silent fallback

## Current limits

- the browser route still depends on follow-on repository finalization work
- the live invalidation path refreshes workflow reads, not full transcript
  streams
- browser-agent event streaming is an optimization layer; graph-backed history
  still has to recover the session story after reload or reconnect

## Main source anchors

- `../src/web/components/workflow-page.tsx`
- `../src/web/components/workflow-review-page.tsx`
- `../src/web/lib/workflow-review-contract.ts`
- `../src/web/lib/workflow-review-refresh.ts`
- `../src/web/lib/workflow-live-transport.ts`
- `../src/web/lib/workflow-session-feed.ts`
- `../src/web/lib/workflow-authority.ts`
- `../../cli/src/browser-agent/transport.ts`

## Related docs

- [`./web-overview.md`](./web-overview.md): broader app-owned browser and
  Worker runtime map
- [`./roadmap.md`](./roadmap.md): future browser workflow direction
- [`../../graph-module-workflow/doc/workflow-stack.md`](../../graph-module-workflow/doc/workflow-stack.md):
  shared workflow boundary
- [`../../cli/doc/command-surfaces.md`](../../cli/doc/command-surfaces.md):
  browser-agent command entrypoint
- [`../../cli/doc/roadmap.md`](../../cli/doc/roadmap.md): future browser-agent
  direction
