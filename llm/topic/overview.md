# IO Project Overview

## What IO Is

IO is a dogfood repo for three closely related efforts:

- an agent execution and orchestration runtime
- a typed `io.ts` plus `io.md` context and configuration model
- a graph-native runtime and schema-driven UI stack

The repo is intentionally mixed-purpose. It is both:

- the product surface for agent and operator workflows
- the proving ground for the graph and schema-driven UI architecture that IO is
  moving toward

## Current Streams

### 1. Agent runtime and orchestration

This is the code that schedules issue work, runs Codex, retains runtime output,
and drives operator-facing commands such as `io agent start`, `io agent tail`,
and `io agent tui`.

Start here:

- `agent/src/server.ts`
- `agent/src/service.ts`
- `agent/src/workspace.ts`
- `agent/src/runner/codex.ts`
- `agent/src/session-events.ts`
- `agent/src/tui.ts`
- `agent/src/tui-runtime.ts`

### 2. IO config and context model

This is the repo-entrypoint layer that decides how IO loads structured config,
which docs become context, and how issue routing selects agents and profiles.

Start here:

- `io.ts`
- `io.md`
- `lib/src/config.ts`
- `config/src/index.ts`
- `agent/src/workflow.ts`
- `agent/src/issue-routing.ts`
- `agent/src/builtins.ts`
- `agent/doc/context.md`
- `agent/doc/context-defaults.md`

### 3. Graph runtime and schema-driven UI

This is the experimental application/runtime direction for IO: typed graph
storage, type modules, typed refs, schema-driven web rendering, and typed query
and filter capabilities.

Start here:

- `graph/doc/big-picture.md`
- `graph/doc/overview.md`
- `graph/doc/schema-driven-ui-implementation-plan.md`
- `graph/doc/schema-driven-ui-backlog.md`
- `graph/doc/typed-refs.md`
- `graph/doc/type-modules.md`
- `graph/doc/web-bindings.md`
- `graph/src/graph/client.ts`
- `app/src/graph/app.ts`
- `app/src/web/bindings.ts`
- `app/src/web/resolver.tsx`
- `app/src/web/company-proof.tsx`
- `app/src/web/filter.tsx`
- `app/src/web/relationship-proof.tsx`

## What Has Landed

The completed IO work is no longer just planning material.

Important shipped pieces:

- `io.ts` is now the main structured config entrypoint, with shared loading in
  `lib/src/config.ts`
- `io.md` plus built-ins plus repo docs now form the context bundle for agent
  runs
- issue routing, doc references, and context profiles exist in the runtime
- the agent TUI ships with live, attach, and replay modes
- retained runtime output and normalized session events power both TUI and
  plain-text operator workflows
- the graph stack has landed typed refs, type modules, generic web field
  rendering, nested and relationship proofs, and the first query/filter proof

That means agents should treat the repo as an active product surface, not just a
spec sandbox.

## How To Use These Topic Docs

Use the docs in `llm/topic/` as repo-level entry points.

Suggested order:

1. read this file for the broad project map
2. read the topic doc closest to the current stream
3. read any linked implementation docs
4. only then move into the affected code

Current topic docs:

- `llm/topic/overview.md`
- `llm/topic/agent.md`
- `llm/topic/graph.md`
- `llm/topic/agent-opentui.md`
- `llm/topic/io-ts-config.md`

## Long-Term Goal

Long term, IO should become one coherent system where:

- repo config, context selection, and issue routing are explicit and typed
- operator workflows can observe and manage multi-agent work safely
- application state, schema, UI generation, and query/filter behavior can all be
  driven from the same graph-native model

The unifying idea is not "more tooling." It is one explicit platform where
humans and agents can discover context quickly, make safe changes, and work from
the same durable project model.
