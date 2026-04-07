---
name: CLI agent workflow
description: "Current workflow loading, issue routing, and context assembly owned by @op/cli."
last_updated: 2026-04-07
---

# CLI agent workflow

## Read this when

- you are changing workflow entrypoint loading, issue routing, context
  assembly, or module-scoped doc selection in `lib/cli/src/agent/*`
- you need the current repo's `io.ts` integration points for the agent runtime
- you want the package-owned replacement for `doc/agent/workflow.md`

## Current entry model

- `workflow.ts` accepts either `./io.ts` or `./io.md` as the entrypoint path
- when no path is passed, the loader resolves both files from the repo root
  and fails if only one exists
- `./io.ts` supplies runtime config and `./io.md` supplies the prompt template
  rendered into the assembled context bundle
- unsupported entrypoint files fail closed instead of silently falling back

## Current repo config

`./io.ts` currently defines:

- registered docs:
  `project.backlog -> ./doc/agent/backlog.md`,
  `project.mcp -> ./lib/cli/doc/graph-mcp.md`,
  `project.overview -> ./doc/index.md`,
  `project.review -> ./doc/agent/review.md`,
  `project.workflow -> ./lib/cli/doc/agent-workflow.md`
- profiles: `backlog`, `execute`, and `review`
- modules: `agent` and `graph`
- routing:
  `backlog` or `planning` labels route to backlog;
  everything else falls back to `execute`

The `review` profile is defined, but the current repo config does not add an
active routing rule for `In Review` issues.

The configured `agent` module docs are:

- `./lib/cli/doc/agent-runtime.md`
- `./lib/cli/doc/agent-workflow.md`

## Routing

- `issue-routing.ts` uses first-match routing
- the first matching explicit rule wins
- otherwise the fallback default agent and profile from `workflow.issues` are
  used
- there is no score-based merge or multi-rule combination

## Context assembly

`context.ts` builds one ordered context bundle from:

1. built-in docs
2. the entrypoint prompt doc, unless the selected profile opts out
3. profile-selected registered docs
4. module default docs
5. issue-linked doc references found in the issue description
6. a synthesized issue-description tail doc

The resolved bundle preserves source, order, override status, and file path
when available.

## Doc reference rules

- `builtin:*` references resolve from `builtins.ts`
- registered doc ids resolve from `workflow.context.docs`
- repo-path docs must use `./...`
- issue descriptions are scanned in source order for builtins, registered doc
  ids, and repo-path doc references
- module scoping only applies to repo-path references
- module scoping is active only when exactly one issue label matches a
  configured module id such as `agent` or `graph`
- unknown or out-of-scope issue doc refs become warnings
- missing profile or module docs are hard failures

## Current constraints

- workflow loading is repo-local and file-based; there is no remote config
  source
- prompt rendering is string-template substitution over the assembled bundle
  and runtime context
- module scoping does not apply to built-ins or registered doc ids
- profile names and doc ids are explicit config contracts, not discovered
  automatically

## Main source anchors

- `../src/agent/workflow.ts`
- `../src/agent/context.ts`
- `../src/agent/issue-routing.ts`
- `../src/agent/builtins.ts`
- `../../../io.ts`
- `../../../io.md`

## Related docs

- [`./agent-runtime.md`](./agent-runtime.md): runtime behavior above this
  config layer
- [`../../../doc/agent/backlog.md`](../../../doc/agent/backlog.md): planning
  skill
- [`../../../doc/agent/review.md`](../../../doc/agent/review.md): review skill
