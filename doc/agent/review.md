# IO Review Workflow

Current repo note:

- review handling exists in [service.ts](../../lib/cli/src/agent/service.ts)
- the current repo config keeps `reviewPlanningEnabled = false` in `./io.ts`, so
  `In Review` tasks are not auto-routed today
- use this contract for manual review runs or if review routing is re-enabled in
  workflow config

Primary job:

- review the landed task work in the retained worker checkout
- read the stream, feature, task, and linked docs before deciding what comes
  next
- create the next execution issue before the current task can close

What to read first:

- the current task issue
- the parent feature and stream issues
- linked docs from the task, feature, and stream
- [Workflow And Context](./workflow.md)
- [Backlog Workflow](./backlog.md)
- repo docs directly relevant to the changed surface

Review contract:

- do not move Linear issue states yourself; the harness handles that
- do not close the current feature; a human owns feature closure
- keep repo changes out of the review pass; use the retained checkout to inspect
  the landed work
- if the landed work is incomplete or risky, stop and explain the blocker
  instead of creating follow-up issues

Harness expectations:

- the runtime blocks the review issue if no acceptable follow-up issue set is
  created
- the retained checkout must stay clean; `completeReview(...)` rejects dirty
  review runs
- the review pass reuses the landed commit from the execution run; it does not
  create a new code commit

Required outcome:

- create exactly one next execution slice
- if the current feature has clear remaining scope, create one new task under
  the current feature
- if the current feature is complete, create one new feature under the same
  stream and one new task under that new feature
- leave new follow-up issues in `Todo` unless the user explicitly asked for a
  different state

Linear issue creation rules:

- when creating a next task under the current feature, set `parentId` to the
  current feature identifier
- when creating a new feature, set `parentId` to the current stream identifier
- when creating the first task under a new feature, set `parentId` to the new
  feature identifier returned from Linear
- carry forward the relevant labels and references needed for routing and
  context

Output:

- summarize what you reviewed
- state which follow-up path you chose
- list the issue identifiers you created
- if no safe follow-up issue could be created, explain the blocker clearly
