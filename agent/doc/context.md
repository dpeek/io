# IO Context And Linear Plan

## Purpose

This document proposes how `io` should move from the current `WORKFLOW.md`-centric setup to a JSON config plus Markdown context model:

- `io.json` becomes the machine-readable configuration entrypoint in the current working directory
- `io.md` becomes the default project instruction entrypoint in the current working directory
- most of today's workflow body moves into reusable context docs
- agent selection and context selection become explicit, especially for Linear-backed issue work

The goal is to make the default project surface small and legible while still letting `io` ship opinionated execution and backlog guidance.

The first-version defaults in this proposal are now settled in `agent/doc/context-defaults.md`.

## Current State

Today the agent runtime effectively uses two layers:

1. config plus prompt body from `WORKFLOW.md`
2. a hard-coded prompt override for io-labeled backlog issues via `llm/agent/backlog.md`

Shared project context is still mostly implicit and path-based:

- `WORKFLOW.md`
- `llm/agent/execute.md`
- `llm/agent/backlog.md`
- `llm/topic/overview.md`

There is also already an `io.json` file in the repo today for install-oriented configuration. This proposal expands `io.json` into the main structured entrypoint rather than introducing a second config file.

This creates several problems:

- the main entrypoint is too verbose for project-local customization
- reusable guidance is encoded as prompt prose instead of structured context selection
- backlog-vs-execution routing is partly hidden in code
- shipped docs and repo docs do not have a consistent override model
- Linear issues cannot cleanly declare which agent and which context set they need

## Desired End State

The default contract in a repo should be:

- `io.json`: structured config and context registry
- `io.md`: short, project-specific instructions for this repo

Built-in docs shipped with `io` should provide most of the durable operating guidance:

- generic execution-agent rules
- generic backlog-agent rules
- tracker usage guidance
- workspace and git safety rules
- common context about how `io` resolves docs and issue context

Project authors should only need to write:

- project overview and architecture docs
- project-specific policies or constraints
- small repo-local instructions in `io.md`

## Design Principles

- Keep machine-readable selection in JSON, not markdown front matter.
- Keep durable instructions in small markdown docs, not giant entrypoint files.
- Make context resolution explicit and inspectable.
- Make agent choice explicit instead of inferring too much from hidden label logic.
- Prefer additive project extension over editing shipped docs.
- Support override by doc id when projects must replace a built-in default.

## Proposed File Model

### Required repo entrypoints

- `io.json`
- `io.md`

### Shipped built-in docs

These live inside `io` and are addressed by stable ids rather than repo-relative paths.

Suggested families after the `builtin:` prefix:

- `io.core.*`
- `io.agent.execute.*`
- `io.agent.backlog.*`
- `io.linear.*`
- `io.context.*`

Examples:

- `builtin:io.core.git-safety`
- `builtin:io.core.validation`
- `builtin:io.agent.execute.default`
- `builtin:io.agent.backlog.default`
- `builtin:io.linear.issue-routing`
- `builtin:io.context.resolution`

### Project docs

Project docs stay in the repo.

Reusable project docs should usually be registered in `io.json`, but repo-relative paths remain valid for issue-linked one-offs and small repos.

Suggested default location:

- `./io/context/**/*.md`

This keeps them near the repo root, avoids the current `llm/topic` naming ambiguity, and makes the intent obvious.

## Proposed `io.json` Responsibilities

`io.json` should own all structured concerns:

- tracker configuration
- workspace configuration
- agent runtime configuration
- context doc registry
- context profiles
- issue routing rules
- per-agent defaults

`io.json` should not contain large natural-language prompt bodies.

### Sketch

```json
{
  "tracker": {
    "kind": "linear",
    "apiKey": "$LINEAR_API_KEY",
    "projectSlug": "$LINEAR_PROJECT_SLUG",
    "activeStates": ["Todo"],
    "terminalStates": ["Done", "Canceled", "Cancelled", "Duplicate"]
  },
  "workspace": {
    "root": "$AGENT_WORKSPACE_ROOT"
  },
  "agent": {
    "maxConcurrentAgents": 1,
    "maxTurns": 1
  },
  "context": {
    "entrypoint": "./io.md",
    "docs": {
      "project.overview": "./io/context/project-overview.md",
      "project.architecture": "./io/context/architecture.md"
    },
    "profiles": {
      "execute": {
        "include": [
          "builtin:io.agent.execute.default",
          "builtin:io.core.git-safety",
          "builtin:io.core.validation"
        ]
      },
      "backlog": {
        "include": ["builtin:io.agent.backlog.default", "builtin:io.core.git-safety"]
      }
    }
  },
  "issues": {
    "defaultAgent": "execute",
    "routing": [
      {
        "if": { "labelsAny": ["backlog", "planning"] },
        "agent": "backlog",
        "profile": "backlog"
      }
    ]
  }
}
```

The exact field names can change, but the separation of concerns should remain:

- JSON selects
- Markdown instructs

Profiles do not need to list `./io.md` explicitly; the resolver should include it by default unless a profile opts out.

## Proposed `io.md` Role

`io.md` should be short and project-specific.

It should be part of the default resolved bundle unless a profile explicitly
turns it off.

It should answer:

- what this repository is
- what a good change looks like here
- what docs matter most
- what local validation is expected
- any local constraints not already covered by built-ins

It should not restate generic execution rules already shipped with `io`.

### Recommended shape

`io.md` should usually stay under roughly one screen of content and primarily link outward.

Suggested sections:

- repo purpose
- key proof surfaces or main subsystems
- local developer workflow
- project docs to consult first
- project-specific constraints

## Context Resolution Model

Context should be resolved as an ordered bundle before each run.

### Resolution layers

1. built-in docs selected by the chosen agent/profile
2. `io.md`, included by default unless the selected profile explicitly disables the repo entrypoint
3. project docs selected by profile or issue-routing rules
4. docs explicitly linked from the issue body
5. any issue-local synthesized context generated by the system

### Why order matters

The system should treat earlier layers as defaults and later layers as more specific.

That gives a predictable model:

- built-ins define the baseline contract
- `io.md` states project-local defaults
- project docs add domain detail
- issue-linked docs narrow the run to the specific work item

### Override model

Project repos should be able to override a built-in doc by id.

Example shape:

```json
{
  "context": {
    "overrides": {
      "builtin:io.agent.execute.default": "./io/context/custom-execute-agent.md"
    }
  }
}
```

The override should be a full replacement, not a partial merge.

Full replacement is easier to reason about, easier to debug, and avoids hidden prompt composition.

## Agent Model

The system now has at least two first-class agent roles:

- `execute`
- `backlog`

These should become explicit runtime concepts instead of being inferred only from labels.

### `execute`

Use when the issue is expected to produce code or repo changes that satisfy the issue directly.

Primary context should include:

- built-in execution rules
- project-local execution guidance from `io.md`
- domain docs relevant to the changed area

### `backlog`

Use when the issue is expected to refine scope, split work, improve durable docs, or rewrite the issue into an implementation-ready plan.

Primary context should include:

- built-in backlog rules
- project-local planning constraints from `io.md`
- architecture and roadmap docs
- nearby backlog or implementation-plan docs

## Linear Interface Plan

The key question is: how does a user get the right agent with the right context for a given issue?

The answer should be: mostly through explicit routing rules in `io.json`, with a small number of issue-level escape hatches.

### Recommendation

Use three layers of control:

1. repo defaults in `io.json`
2. automatic issue routing rules in `io.json`
3. explicit issue-level hints from Linear when an issue needs to opt out

### Repo defaults

Every repo should define:

- the default agent for issue execution
- the default context profile for that agent
- the routing rules that promote some issues to backlog mode

This handles the common case with no per-issue author effort.

### Automatic routing

For the first implementation, routing should inspect labels only.

That keeps the initial resolver small and matches the current hard-coded backlog split closely enough to migrate incrementally.

Suggested first-version rule types:

- `labelsAny`
- `labelsAll`

State, project, and hierarchy-aware routing can be added later once there are concrete cases that justify the extra fetches and config surface.

Example:

```json
{
  "issues": {
    "defaultAgent": "execute",
    "defaultProfile": "execute",
    "routing": [
      {
        "if": { "labelsAny": ["backlog", "spec", "planning"] },
        "agent": "backlog",
        "profile": "backlog"
      },
      {
        "if": { "labelsAny": ["docs-only"] },
        "agent": "backlog",
        "profile": "backlog"
      }
    ]
  }
}
```

### Explicit issue-level hints

Some issues will need to declare their own execution mode or extra context.

For that, use a small HTML comment block named `io` whose body is YAML.

First-version shape:

```md
<!-- io
agent: backlog
profile: backlog
docs:
  - project.architecture
  - ./io/context/schema-rules.md
-->
```

This should be optional and used sparingly.

Fenced code blocks are intentionally out of scope for the first version so the metadata stays out of the rendered issue body.

The general guidance should be:

- use `io.json` routing for patterns
- use issue-body hints for exceptions

### Linked docs in Linear

Users should be able to paste repo-relative doc paths or stable doc ids into issue bodies.

Recommended supported forms:

- repo-relative path: `./io/context/architecture.md`
- registered doc id: `project.architecture`
- built-in doc id: `builtin:io.agent.backlog.default`

At resolution time:

- doc ids should resolve through the registry
- repo-relative paths should resolve from the repo root
- repo-relative paths should not require prior registration in `io.json`
- unresolved references should surface as warnings in the run summary

### Manual user intent

There should also be a direct CLI path for users who already know what they want.

Examples of desired UX:

- `io agent start`
- `io issue run OPE-48`
- `io issue run OPE-48 --agent backlog`
- `io issue run OPE-48 --doc project.architecture`

The runtime should still apply repo defaults and routing rules, but explicit CLI flags should win for that invocation.

## Recommended User Workflow With Linear

For most users:

1. create an issue normally in Linear
2. apply one of a small set of routing labels when needed
3. link any unusually important docs in the issue body
4. let `io` select the default agent and context bundle

Recommended label vocabulary:

- `backlog`
- `planning`
- `execute`
- `docs-only`

Keep the set intentionally small.

If a team needs more nuance, they should add project docs and routing rules rather than inventing many labels.

## Migration Plan

### Phase 1: Introduce the new entrypoints

- add support for `io.json` as the default config file
- add support for `io.md` as the default project instruction file
- preserve the current install-oriented `io.json` keys and fold the new agent config into the same file
- continue to accept `WORKFLOW.md` for compatibility during migration

### Phase 2: Move generic workflow body into built-ins

- convert current execution guidance into built-in `io.agent.execute.*` docs
- convert current backlog guidance into built-in `io.agent.backlog.*` docs
- convert generic shared guidance into built-in `io.core.*` docs

### Phase 3: Add context registry and profile resolution

- allow `io.json` to register docs and profiles
- resolve built-ins, `io.md`, project docs, and issue-linked docs into one ordered bundle
- emit the resolved bundle in logs or run metadata for debuggability

### Phase 4: Add issue routing

- replace hard-coded backlog label switching with structured routing rules
- keep temporary compatibility for the current io-label behavior if needed

### Phase 5: Add explicit issue-body hints

- parse optional issue-body metadata blocks
- use them only as narrow overrides on top of repo defaults and routing

## First-Version Defaults

The durable decision record lives in `agent/doc/context-defaults.md`.

The first implementation should treat these defaults as settled:

- use explicit built-in ids with the `builtin:` prefix
- include `io.md` by default unless a profile explicitly disables it
- use an HTML comment `<!-- io ... -->` block for issue-body hints
- allow both registered doc ids and repo-relative paths, without requiring prior registration for paths
- start routing with labels only

This keeps the first version small while preserving a clear path to richer routing later.

## Implementation Notes

The current code should evolve roughly as follows:

- `agent/src/workflow.ts`
  - stop parsing markdown front matter as the primary config path
  - load and validate `io.json`
  - separately load `io.md`
  - parse the optional `<!-- io ... -->` issue-body hint block
- `agent/src/types.ts`
  - replace single `promptTemplate` assumptions with config plus resolved context bundle structures
  - distinguish built-ins, registered doc ids, and repo-relative paths during resolution
- `agent/src/service.ts`
  - replace hard-coded backlog prompt switching with agent/profile resolution
  - start with label-based routing rules before adding richer metadata-driven routing
  - resolve docs before prompt rendering
- `agent/src/tracker/linear.ts`
  - keep the first routing pass label-only
  - grow issue fetches only when routing expands beyond labels

The final prompt given to Codex should be rendered from:

- the chosen agent role
- resolved context docs in order
- issue metadata
- workspace metadata

That makes the runtime behavior inspectable and avoids burying major behavior inside a single handwritten workflow file.
