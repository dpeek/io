Project-local guidance for the `io` workspace.

Purpose:

- this repo owns the agent runtime, CLI, shared config surface, and the graph packages used to prove the model end to end

Read first:

- `./doc/index.md`
- any docs linked from the issue body
- only then the affected code

Validation:

- `bun check` is required before the change is done
- `bun check` runs one repo-wide `vp lint --fix` plus `vp fmt` pass and then
  cached Bun tests for affected workspace packages through `turbo run test --affected`
- Turbo task selection now uses task-level inputs for `--affected`, so doc-only
  and generated `out/**` changes do not fan out into unrelated package tests
- use `turbo run test --filter=@io/<package>` for focused package test runs
- Turbo defaults to `errors-only` task logs with hash markers to keep agent
  runs compact while still showing cache hits and misses
- run focused tests for the packages and config/docs you touch

Local constraints:

- keep changes narrow and reviewable across workspaces
- update docs, examples, and tests together when entrypoint or context behavior changes
- keep repo-local guidance in `io.md` and `doc/index.md`
- repo default Codex sessions run with `AGENT=1` so `bun test` output stays compact

Output:

- summary of what changed
- validation result
