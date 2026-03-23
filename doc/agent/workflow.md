# Agent Workflow And Context

## Purpose

This page is the entry point for workflow loading, issue routing, context
assembly, and module-scoped doc selection. For the user-facing
`Stream -> Feature -> Task` planning contract, start with
[Backlog Workflow](./backlog.md).

## Current Entry Model

- [workflow.ts](../../src/agent/workflow.ts) accepts either `./io.ts` or
  `./io.md` as the entrypoint path.
- When no path is passed, the loader looks for both files in the repo root and
  fails if only one exists.
- `./io.ts` supplies runtime config; `./io.md` is the prompt template rendered
  into the assembled context bundle.

## Current Repo Config

`./io.ts` currently defines:

- registered docs:
  `project.backlog -> ./doc/agent/backlog.md`,
  `project.mcp -> ./doc/graph/mcp.md`,
  `project.overview -> ./doc/index.md`,
  `project.review -> ./doc/agent/review.md`,
  `project.workflow -> ./doc/agent/workflow.md`
- profiles: `backlog`, `execute`, and `review`
- modules: `agent` and `graph`
- routing:
  `backlog` or `planning` labels route to backlog;
  everything else falls back to `execute`

The `review` profile is still defined, but the current repo config does not add
an active routing rule for `In Review` issues.

The configured `agent` module docs are current:

- `./doc/agent/index.md`
- `./doc/agent/workflow.md`

The configured `graph` module docs are current:

- [../graph/index.md](../graph/index.md)
- [../graph/icon.md](../graph/icon.md)
- [../graph/architecture.md](../graph/architecture.md)

Because module docs are resolved as hard requirements, keeping those references
current matters for `graph`-labeled issue context.

## Routing

[issue-routing.ts](../../src/agent/issue-routing.ts) uses first-match routing:

- the first matching explicit rule wins
- otherwise the fallback default agent/profile from `workflow.issues` is used

There is no score-based merge or multi-rule combination.

## Context Assembly

[context.ts](../../src/agent/context.ts) builds one ordered context bundle from:

1. built-in docs
2. the entrypoint prompt doc, unless the selected profile opts out
3. profile-selected registered docs
4. module default docs
5. issue-linked doc references found in the issue description
6. a synthesized issue-description tail doc

The bundle preserves source, order, override status, and file path when
available.

## Doc Reference Rules

- `builtin:*` references resolve from
  [builtins.ts](../../src/agent/builtins.ts)
- registered doc ids resolve from `workflow.context.docs`
- repo-path docs must use `./...`
- issue descriptions are scanned in source order for builtins, registered doc
  ids, and repo-path doc references
- module scoping only applies to repo-path references
- module scoping is active only when exactly one issue label matches a configured
  module id such as `agent` or `graph`
- unknown or out-of-scope issue doc refs become warnings
- missing profile or module docs are hard failures, not warnings

## Current Prompt Model

- prompt rendering is string-template substitution over the assembled bundle and
  runtime context
- built-ins lead the bundle so role and safety guidance arrive first
- the entrypoint doc sits between built-ins and most repo docs unless a profile
  disables it
- module docs are appended after profile docs
- the synthesized issue-description doc is appended last when the issue has a
  description

## Current Constraints

- workflow loading is repo-local and file-based; there is no remote config
  source
- routing precedence is first-match only
- module scoping applies only to repo-path docs, not built-ins or registered ids
- prompt rendering is template-based rather than schema-driven
- profile names and doc ids are explicit config contracts, not discovered
  automatically
