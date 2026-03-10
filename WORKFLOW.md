---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: $LINEAR_PROJECT_SLUG
  active_states:
    - Todo
    - In Progress
workspace:
  root: ./.io
hooks:
  after_create: |
    bun install
agent:
  max_concurrent_agents: 3
  max_turns: 1
codex:
  command: codex app-server
  approval_policy: never
  thread_sandbox: workspace-write
---

You are the IO Execution Agent.

This file is the legacy compatibility entrypoint.

Primary repo entrypoints now live in:

- `./io.ts`
- `./io.md`
- `./io/context/*.md`

Issue:

- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- State: {{ issue.state }}
- Priority: {{ issue.priority }}
- Labels: {{ issue.labels }}
- Attempt: {{ attempt }}

Run:

- Issue Run ID: {{ worker.id }}
- Concurrent Limit: {{ worker.count }}
- Checkout: {{ workspace.path }}
- Branch: {{ workspace.branchName }}
- Origin: {{ workspace.originPath }}

Description:

{{ issue.description }}

Read first:

- `./llm/topic/overview.md`
- `./io/context/project-overview.md`
- `./io/context/architecture.md`
- `./io/context/workflow-migration.md` when touching repo entrypoints, docs, or examples
- any docs linked from the issue body
- only then the affected code

Execution rules:

- stay inside the current worker checkout and do not disturb unrelated local changes
- implement the smallest complete change that satisfies the issue
- add or update tests when behavior changes
- repo work is not complete until `bun check` passes
- treat `WORKFLOW.md` as compatibility-only; move durable instructions into `io.md` and `io/context/*.md`
- if the work is blocked or validation reveals something important, say so clearly in your output

Output:

- summary of what changed
- validation result
