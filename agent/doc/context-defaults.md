# IO Context Model Defaults

Status: Accepted

This document settles the first-version defaults that were left open in
[`agent/doc/context.md`](./context.md). Follow-on implementation issues should
treat these defaults as the baseline contract unless a later decision record
replaces them.

## Decisions

| Area | Default | Why |
| --- | --- | --- |
| Built-in doc ids | Use explicit `builtin:`-prefixed ids such as `builtin:io.agent.execute.default`. | Built-ins stay visually distinct from project ids and repo-relative paths, which makes overrides and debugging easier. |
| `io.md` inclusion | Include `io.md` automatically in every resolved context bundle unless a profile explicitly opts out. | Projects should get one predictable local instruction layer without repeating `./io.md` in every profile. |
| Issue-body hints | Parse a single HTML comment block with YAML-style fields. | The hints stay machine-readable without adding visible fenced blocks to issue descriptions in Linear. |
| Project doc references | Allow repo-relative paths like `./io/context/architecture.md` without prior registration. | Registration is useful for stable shared ids, but requiring it for every one-off doc adds friction with little value. |
| Initial issue routing | Start with label-based routing only. | Labels cover the immediate execution/backlog split and avoid forcing extra tracker queries before the model is proven. |

## Accepted Forms

### Built-in docs

Always reference built-ins with the `builtin:` prefix:

- `builtin:io.agent.execute.default`
- `builtin:io.agent.backlog.default`
- `builtin:io.core.git-safety`

Project doc ids remain unprefixed:

- `project.overview`
- `project.architecture`

Repo-relative paths remain literal paths:

- `./io/context/architecture.md`

### Issue-body hints

Use an HTML comment block and keep the body YAML-shaped:

```md
<!-- io
agent: backlog
profile: backlog
docs:
  - project.architecture
  - ./io/context/schema-rules.md
-->
```

This block is optional and is meant for exceptions. Repo defaults and routing
rules remain the primary mechanism.

### Profile behavior

Profiles should describe built-ins and named project docs. The resolver should
inject `io.md` automatically after built-ins and before issue-linked docs unless
that profile explicitly disables the project entrypoint.

## Consequences For Implementation

- Treat `builtin:*`, registered doc ids, and repo-relative paths as three
  different reference classes during resolution.
- Keep profile configuration declarative; profiles should not need to repeat
  `./io.md` just to preserve the default behavior.
- Keep first-version routing inputs narrow. Labels are required; state,
  hierarchy, and project-structure routing can be added later without changing
  the default contract.
- Surface unresolved doc references as warnings rather than silently dropping
  them.

## Deferred For Later

These are intentionally not part of the first-version default set:

- state- or hierarchy-aware routing predicates
- additional issue-body formats such as fenced code blocks
- forcing every repo-relative doc into the registry before it can be linked
