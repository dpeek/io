# Managed Stream Backlog Loop

Use this contract when a backlog run is refining an IO-managed parent issue into
child work for a long-lived stream.

This doc defines the backlog proposal block and child issue payload. Use
[`./managed-stream-goals.md`](./managed-stream-goals.md) for the parent label
contract, focus-doc shape, and ownership split, and
[`./managed-stream-comments.md`](./managed-stream-comments.md) for `@io ...`
comment triggers.

## Objective

Turn the parent brief into an execution-ready child backlog that stays healthy
over repeated backlog runs.

The result should be:

- concrete child issues, not planning prose
- implementation steps, not extra planning or review tiers
- ordered delivery through `blockedBy`
- descriptions that an execution agent can act on without reopening planning
- a short speculative tail that can be refreshed safely later

## Stable Parent Brief Payload

Backlog proposal writeback should manage one explicit block in the parent issue:

```md
<!-- io-managed:backlog-proposal:start -->
## Managed Brief

### Current Module State
- ...

### Constraints
- ...

### Work Options
1. **Option 1**
   Focus: ...
   Alignment: ...
2. **Option 2**
   Focus: ...
   Alignment: ...
3. **Option 3**
   Focus: ...
   Alignment: ...
<!-- io-managed:backlog-proposal:end -->
```

Rules:

- append the block on first write without rewriting human-authored prose outside it
- on reruns, replace only the content between the markers
- preserve operator notes, decisions, and narrowing sections outside the managed block
- keep the section names and marker ids stable so later backlog runs can refresh safely

## Stable Child Payload

Create or update child issues with one stable shape every time:

```yaml
title: "<verb-first shipping task>"
description: |
  ## Outcome
  ...

  ## Scope
  ...

  ## Acceptance Criteria
  - ...

  ## Module Scope
  - Primary module: <module id>
  - Shared paths: <only if needed>

  ## Dependencies And Docs
  - ...

  ## Out Of Scope
  - ...
parentId: "<parent issue id>"
labels:
  - agent
  - <primary module label>
priority: <inherit parent priority unless there is a clear reason not to>
state: "Todo"
blockedBy:
  - <previous child issue id or identifier when ordering is required>
```

Keep the field set and section order stable. Child descriptions must stay
execution-ready: concrete repository surfaces, concrete behavior, and concrete
acceptance criteria.

Rules:

- child issues are implementation-step only for this first pass
- current-approach bootstrap seeds new child issues in `Todo`
- parent stream phase, not a child-only planning tier, keeps seeded `Todo`
  children non-runnable until the parent moves to `In Progress`
- automatic backlog scheduling stops once the parent leaves `Todo`, but
  explicit backlog reruns may still target the parent while it is in
  `In Review` or `In Progress` through direct routing or top-level
  `@io backlog`
- reruns should treat untouched `Todo` children as the speculative tail unless
  they have already moved into active review or done states

## Safe Bootstrap

Seed new streams conservatively under the current runtime:

1. set the parent issue to `In Review`
2. create the initial implementation child backlog in `Todo`
3. keep the parent in `In Review` while humans edit and approve the brief
4. move the parent to `In Progress` only when execution may begin

This keeps the current 2-level parent/child model intact while preventing new
`Todo` child issues from becoming runnable before the parent stream is
explicitly released.

Transition split for the current approach:

- backlog success moves the parent from `Todo` to `In Review`
- a human later moves the parent from `In Review` to `In Progress` to release
  execution
- child execution success moves only the child to `Done`

## Transition Rules

Keep parent backlog transitions and child execution transitions separate:

- successful parent backlog runs start from parent `Todo` and return the parent
  to `In Review`
- successful child execution runs move the child to `Done`
- moving the parent to `In Progress` is the human release step for execution;
  it does not imply a child state change
- terminal worktree cleanup happens after the Linear state transition, once the
  runtime verifies the child landed on the stream branch or the parent landed
  on `main`

## Expansion Pass

On the first approved parent brief:

1. read the parent brief, existing children, and module docs before creating
   anything
2. break the work into small shipping tasks that can land cleanly on the stream
   branch
3. create child issues under the parent in delivery order
4. add `blockedBy` edges so only the next child is unblocked
5. stop once the stream has roughly five planned tasks unless the brief is
   genuinely smaller

Prefer tasks that stay within one module and one coherent change surface.

## Maintenance Pass

On later backlog runs for the same parent:

1. inspect the existing child backlog first
2. preserve active, in-review, and done children as-is
3. avoid duplicates by matching on outcome, module scope, and nearby repository
   surfaces before creating anything new
4. keep the next tasks stable unless the parent brief materially changed
5. refresh only the speculative tail of untouched `Todo` children
6. top the stream back up to about five planned tasks when the tail gets short
7. relink `blockedBy` edges if backlog edits changed ordering

Do not destructively rewrite children that are already active or completed.

## Module Guardrails

Each child should have one primary module label and one primary implementation
surface.

Cross-module work is allowed only when it is explicit. When a child needs it:

- add a `## Cross-Module Exception` section to the description
- name the extra module or shared path directly
- explain why the split cannot stay module-local
- keep the exception as small as possible

Accidental cross-module scope is a planning bug. Make the exception visible
instead of letting it hide in vague task text.

## Operator-Visible Output

Backlog runs should report the planning transitions that matter to an operator:

- stream status at start: new expansion or maintenance rerun
- existing child counts by preserved vs speculative work
- child issues created, reused, updated, or left untouched
- `blockedBy` edges added or changed
- whether the stream was topped up, skipped, or already healthy
- any explicit cross-module exceptions
- anything blocked on missing brief detail or unresolved design choices

Keep that summary concise, but make the transition clear enough that an
operator can tell how the backlog changed without diffing every child manually.
