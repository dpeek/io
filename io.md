Project-local guidance for the default IO built-in docs.

Read first:

- `./llm/topic/overview.md`
- any docs linked from the issue body
- only then the affected code

Local constraints:

- stay inside the current worker checkout and do not disturb unrelated local changes
- the execution harness handles git; do not interact with git directly
- use existing Linear MCP tools for issue reads and writes when useful
- repo work is not complete until `bun check` passes

Output:

- summary of what changed
- validation result
