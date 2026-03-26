Project-local guidance for the `io` workspace.

Purpose:

- this repo owns the agent runtime, CLI, shared config surface, and the graph packages used to prove the model end to end

Read first:

- `./src/index.md`
- any docs linked from the issue body
- only then the affected code

Validation:

- `bun check` is required before the change is done
- run focused tests for the packages and config/docs you touch

Local constraints:

- keep changes narrow and reviewable across workspaces
- update docs, examples, and tests together when entrypoint or context behavior changes
- keep repo-local guidance in `io.md` and `src/index.md`
- repo default Codex sessions run with `AGENT=1` so `bun test` output stays compact

Output:

- summary of what changed
- validation result
