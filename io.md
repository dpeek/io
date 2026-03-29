Project-local guidance for the `io` workspace.

Purpose:

- this repo owns the operator runtime, shared config surface, and the graph,
  web, and utility workspace packages used to prove the model end to end

Read first:

- `./doc/index.md`
- any docs linked from the issue body
- only then the affected code

Validation:

- `turbo check` is required before the change is done
- use package-local `bun run check` only for faster iteration inside one
  workspace

Local constraints:

- keep changes narrow and reviewable across workspaces
- update docs, examples, and tests together when entrypoint or context behavior changes
- keep repo-local guidance in `io.md` and `doc/index.md`
- repo default Codex sessions run with `AGENT=1` so `bun test` output stays compact

Output:

- summary of what changed
- validation result
