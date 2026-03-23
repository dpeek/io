# IO Backlog Workflow

Current repo note:

- this doc is registered as `project.backlog` in `./io.ts`
- the current routing config sends issues labeled `backlog` or `planning` here
- backlog issues are not auto-scheduled by the supervisor; only released leaf
  task issues are auto-run

Invocation:

- `@./doc/agent/backlog.md OPE-133`

Primary job:

- keep the stream description and child issue structure aligned with
  [Workflow And Context](./workflow.md)
- read the target stream issue, its feature/task subtree, and linked docs before
  proposing changes
- use the stream issue description as the canonical planning surface
- iterate with the user on the stream description first
- only after the stream description is approved, create, update, or delete
  child issues to match it

Issue model:

1. `Stream`: long-lived workstream for a package, subsystem, or integration
   surface
2. `Feature`: a substantial chunk of work inside a stream
3. `Task`: one execution session inside a feature

Operating rules:

- do not use comment-driven workflows
- do not ask the supervisor to run backlog work automatically
- the user owns stream editing interactively with Codex
- the user decides when features move between `Backlog`, `Todo`, `In Progress`,
  and `Done`
- allow parallel features inside the same stream
- do not plan parallel tasks inside a single feature
- prefer replacing stale child structure over preserving legacy parent/child
  conventions

What to read first:

- the named stream issue
- its existing features and tasks
- linked docs from the stream and active features
- [Workflow And Context](./workflow.md)
- repo docs directly relevant to the stream surface

Stream description template:

## Summary

- what surface this stream owns
- why it matters now

## Focus

- the current decision or delivery focus
- what is intentionally not in focus yet

## Goals

- concrete outcomes this stream must achieve
- user-visible or integration-visible success conditions

## Roadmap

1. feature-sized milestones in likely delivery order
2. notes on where parallel feature work is safe
3. known sequencing constraints

## Guardrails

- architectural constraints
- compatibility or rollout constraints
- merge/conflict concerns the user should be aware of

## References

- issue links
- docs
- code surfaces

Feature expectations:

- each feature should have a detailed description
- include scope, acceptance criteria, expected outcome, and key references
- features are backlog/planning containers plus branch owners
- tasks should roll up cleanly into exactly one feature

Task expectations:

- tasks are narrow execution sessions
- each task should be independently completable in one agent run
- tasks should not duplicate acceptance criteria already owned by the feature

Backlog conversation flow:

1. summarize the current stream, features, tasks, and relevant docs
2. propose edits to the stream description using the template above
3. iterate with the user until the stream description is accepted
4. then propose the child-issue mutation set:

- features to create, update, keep, or delete
- tasks to create, update, keep, or delete under each feature

5. apply the issue mutations only after the user confirms

Supervisor contract:

- the supervisor should only start a task when:
- the stream is `In Progress`
- the feature is `In Progress`
- the task is `Todo`
- when multiple feature tasks are runnable, pick at most one task per feature
  and follow Linear sub-issue manual order (`subIssueSortOrder`), falling back
  to `sortOrder` only when the sub-issue order is missing
- successful task execution lands the task commit onto the feature branch and
  moves the task to `Done` in the current repo configuration
- the `review` profile still exists, but current `./io.ts` does not auto-route
  `In Review` task issues; if review routing is re-enabled later, successful
  review must create the required follow-up issue set before the reviewed task
  closes
- feature issues are not auto-closed by the supervisor; a human decides when a
  feature moves to `Done`
- non-task leaves are not auto-runnable; each feature should own explicit task
  children

Feature completion target contract:

- when a feature moves to `Done`, the engine should squash the feature branch
  onto the stream branch in a temporary finalize worktree
- commit subject: `OPE-XXX Feature title`
- commit body: concise list of completed tasks
- then update the stream-branch ref to the squashed commit and clean leftover
  branch state
- if finalization conflicts, preserve the feature branch state so reconciliation
  can retry cleanly

Output style:

- keep stream edits concrete and reviewable
- call out ambiguity, missing docs, and risky sequencing explicitly
- prefer proposed issue mutations in compact tables or short bullets
- do not bury the recommended next action
