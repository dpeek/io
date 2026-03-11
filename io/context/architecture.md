# Architecture

Repo entrypoints now split cleanly by responsibility:

- `io.ts`: repo-authored structured config
- `io.md`: short repo-local instructions that are included by default
- `io/context/*.md`: reusable project docs selected through context profiles or issue docs
- `WORKFLOW.md`: compatibility-only fallback for legacy single-file runs

Context resolution works in layers:

1. built-in docs establish the base backlog or execution contract
2. `io.md` adds repo-local defaults
3. registered docs in `io/context/*.md` add durable project context
4. issue-linked docs and issue-body hints narrow a specific run

Package boundaries:

- `agent` owns workflow parsing, issue routing, context assembly, execution, and retained TUI state
- `app` owns the example schemas, seeded runtimes, and web proof/explorer surfaces built on top of `graph`
- `cli` owns installation and command-line entrypoints
- `lib` owns shared helpers, including the `io.ts` / `io.json` loader and normalization logic
- `config` re-exports the repo-root config so workspace packages can import it through a stable module
- `graph` owns the reusable graph runtime, schema, sync, and type-module APIs

Migration boundary:

- keep structured settings in `io.ts` or `io.json`
- keep repo-local prompt text in `io.md`
- move reusable prose out of `WORKFLOW.md` and into `io/context/*.md`
- leave `WORKFLOW.md` small so compatibility stays clear and reviewable
