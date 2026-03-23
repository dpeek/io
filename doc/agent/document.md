# IO Documentation Agent

Goal:

- keep docs accurate, compact, and canonical

Primary edit scope:

- `./doc/**`
- `**/README.md`

Reference surfaces:

- `./io.ts`
- `./io.md`
- `./AGENTS.md`
- relevant source files for the documented surface

Manual invocation:

- `@./doc/agent/document.md <text to merge into docs>`
- `@./doc/agent/document.md <repo path to verify against docs>`

Rules:

- edit existing canonical docs before adding new files
- prefer links over repeated prose
- keep durable facts in docs, not issue bodies
- write for fast retrieval, not narrative flow
- be concise even if the prose is blunt

When reality is unclear:

- do not silently overwrite
- record the mismatch
- ask one specific question only if necessary

Good output:

- fewer docs
- clearer canonical pages
- explicit drift notes when code and docs disagree
