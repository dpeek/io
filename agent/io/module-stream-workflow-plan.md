# Agent Workflow And Context

## Purpose

This document is the entry point for agents working on workflow loading, issue routing, context assembly, or module-scoped doc selection.

## Current Workflow Surface

### Entrypoints

`../src/workflow.ts` uses a single repo-local entry style:

- `io.ts` for runtime config plus `io.md` for prompt body

Resolved workflow state already includes:

- agent concurrency and retry settings
- Codex command, timeouts, and sandbox config
- tracker settings
- hook scripts
- context docs, overrides, and profiles
- issue routing rules
- module path and shared-path boundaries

### Routing

`../src/issue-routing.ts` currently picks backlog versus execute runs from:

- first matching explicit routing rule
- fallback repo defaults

Retained compatibility note:

- legacy top-level issues with `io` plus exactly one configured module label are
  still recognized by retained docs and compatibility paths, but routing itself
  now depends on explicit rules rather than an implicit backlog fallback

Issue-body hints parsed by `../src/context.ts` can still override the base selection with:

- `agent`
- `profile`
- `docs`

### Context assembly

`../src/context.ts` already builds one ordered context bundle from:

- built-in docs
- the resolved entrypoint prompt
- profile-specific registered docs
- module default docs
- issue-linked doc references
- issue-body hint docs
- synthesized issue description context

The bundle preserves source, order, override status, and file path when available.

## Current Doc Reference Rules

- `builtin:*` references resolve from `../src/builtins.ts`
- registered doc ids resolve from `workflow.context.docs`
- repo-path docs must use `./...`
- module-labeled issues may only pull repo-path docs from the module root or configured shared paths
- unknown or out-of-scope issue doc refs become warnings rather than silent omissions

## Current Prompt Model

- prompt rendering is simple template substitution over the assembled doc bundle and runtime context
- built-ins lead the bundle so role and safety guidance arrives before repo detail
- the entrypoint doc sits between built-ins and most repo docs unless a profile opts out
- issue description context is synthesized at the end for `io`-style entrypoints

This is already real runtime behavior, not a draft plan.

## Current Constraints

- workflow loading is repo-local and file-based; there is no remote config source
- routing precedence is first-match rather than score-based or merge-based
- module scoping only applies to repo-path references, not built-ins or registered ids
- prompt rendering is string-template-based rather than schema-driven
- profile names and doc ids are configuration contracts, not discovered automatically

## Roadmap

- clarify which workflow fields are intended as stable public config versus repo proof surface
- add better diagnostics for why one profile or routing rule won
- improve doc navigation for common tasks without widening the prompt assembly model
- decide whether richer structured prompt sections belong here or in a higher-level package

## Future Work Suggestions

1. Add one end-to-end example showing `io.ts`, `io.md`, issue hints, and the resulting context bundle order.
2. Document the expected stability of issue-body hint keys and doc-id conventions.
3. Add a compact routing precedence table with representative examples.
4. Clarify when a doc should be registered by id versus linked by repo path.
5. Add a short debugging checklist for unresolved doc warnings and scope failures.
