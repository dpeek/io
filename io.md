Project-local guidance for the `io` workspace.

Purpose:

- this repo owns the agent runtime, CLI, shared config surface, and the graph package used to prove the model end to end

Read first:

- `./llm/topic/overview.md`
- `./io/context/project-overview.md`
- `./io/context/architecture.md`
- `./io/context/workflow-migration.md` when touching repo entrypoints, docs, or examples
- any docs linked from the issue body
- only then the affected code

Validation:

- `bun check` is required before the change is done
- run focused tests for the packages and config/docs you touch

Local constraints:

- keep changes narrow and reviewable across workspaces
- update docs, examples, and tests together when entrypoint or context behavior changes
- treat `WORKFLOW.md` as a compatibility fallback; new repo-local guidance belongs in `io.md` and `io/context/*.md`

Output:

- summary of what changed
- validation result
