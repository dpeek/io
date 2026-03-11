# WORKFLOW Migration

Use this mapping when moving a repo from the legacy `WORKFLOW.md` entrypoint to
the IO context model.

Target layout:

- `io.json` or `io.ts` for structured config
- `io.md` for short repo-local instructions
- `io/context/*.md` for reusable project docs
- `WORKFLOW.md` as a compatibility fallback only

Move content like this:

- `WORKFLOW.md` front matter becomes structured config in `io.json` or `io.ts`
- small repo-specific instructions move into `io.md`
- reusable sections from the old workflow body move into named docs under `io/context`
- agent/profile switching moves into `issues.routing`
- shared doc bundles move into `context.docs` and `context.profiles`
- full built-in replacements move into `context.overrides`

Example `io.json`:

```json
{
  "tracker": {
    "kind": "linear",
    "apiKey": "$LINEAR_API_KEY",
    "projectSlug": "$LINEAR_PROJECT_SLUG"
  },
  "workspace": {
    "root": ".io"
  },
  "context": {
    "docs": {
      "project.overview": "./io/context/project-overview.md",
      "project.architecture": "./io/context/architecture.md"
    },
    "profiles": {
      "execute": {
        "include": [
          "builtin:io.agent.execute.default",
          "builtin:io.context.discovery",
          "builtin:io.linear.status-updates",
          "builtin:io.core.validation",
          "builtin:io.core.git-safety",
          "project.overview",
          "project.architecture"
        ]
      }
    }
  },
  "issues": {
    "defaultAgent": "execute",
    "defaultProfile": "execute",
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

Migration steps:

1. Copy structured fields out of `WORKFLOW.md` front matter into `io.json` or `io.ts`.
2. Reduce `io.md` to repo-local instructions and links instead of restating shipped built-ins.
3. Extract reusable prose from the old workflow body into `io/context/*.md`.
4. Register those docs in `context.docs` and include them from `context.profiles`.
5. Keep `WORKFLOW.md` small and compatibility-only until the repo no longer needs the fallback.
6. Update tests and examples to exercise `io.json` plus `io.md`, while keeping focused compatibility coverage for `WORKFLOW.md`.

Compatibility notes:

- `io agent start` and `io agent validate` prefer `io.ts`, then `io.json`, then `WORKFLOW.md`
- if runtime config exists but `io.md` is absent, the runtime reuses the prompt body from `WORKFLOW.md`
- if config is install-only, the runtime falls back to full `WORKFLOW.md` loading
- this repo currently authors `io.ts`, but tests and migration examples still use `io.json` because that compatibility path is shipped behavior
