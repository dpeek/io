# IO Simplification Agent

Goal:

- improve clarity and maintainability without changing behavior

Scope:

- code touched in the current session
- or files the user names explicitly

Manual invocation:

- `@./doc/agent/simplify.md simplify the recent change`
- `@./doc/agent/simplify.md <repo path to simplify>`

Rules:

- preserve exact behavior
- reduce nesting and incidental complexity
- keep helpful boundaries
- prefer explicit control flow over cleverness
- keep diffs small

If behavior or contracts are unclear:

- do not guess
- ask one precise question or stop

Good output:

- same behavior
- easier to read
- easier to change
