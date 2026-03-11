# Parallel Module Stream Workflow Plan

## Purpose

This plan describes how to turn the current stream-oriented IO runtime into a
module-oriented backlog system for a monorepo using:

- durable parent issues in Linear
- package labels for module identity
- an `io` label for managed streams
- `@io ...` comments as the trigger for backlog refresh and expansion

Target outcome:

- each managed module has one long-lived parent Linear issue
- that parent issue owns one long-lived stream branch
- the backlog agent keeps roughly 5 ordered child issues ready under that
  parent
- those child issues stay aligned with one repo-wide focus document
- humans can write whatever they want in the issue description and comments
- the agent organizes that information into stable managed sections
- execution stays narrow enough that rebasing against `main` is usually not a
  problem

## What Already Exists

The current repo is not starting from zero.

Useful pieces already exist:

- issue routing and context bundles are explicit in [`/Users/dpeek/code/io/io.ts`](/Users/dpeek/code/io/io.ts)
- linked-doc resolution and issue-level context assembly already exist in
  [`/Users/dpeek/code/io/agent/src/context.ts`](/Users/dpeek/code/io/agent/src/context.ts)
- the scheduler already serializes work inside one parent stream while allowing
  multiple streams in parallel in
  [`/Users/dpeek/code/io/agent/src/service.ts`](/Users/dpeek/code/io/agent/src/service.ts)
- workspaces already use a parent-owned stream branch and land child commits
  onto that branch in
  [`/Users/dpeek/code/io/agent/src/workspace.ts`](/Users/dpeek/code/io/agent/src/workspace.ts)
- the design intent for parent issue streams already exists in
  [`/Users/dpeek/code/io/agent/doc/stream-workflow.md`](/Users/dpeek/code/io/agent/doc/stream-workflow.md)
- the repo already depends on `@linear/sdk` in `agent/package.json`, but is
  only using it for a narrow part of issue interaction today

Important current behavior:

- parent issues with children already route toward backlog/planning rather than
  direct execute
- child issues already inherit the parent stream key
- child issues can already express ordering through `blockedBy`
- child issues are marked `Done` once they land on the stream branch

## Main Gaps

The current runtime is missing the pieces that make this useful as a continuous
module backlog system.

Missing capabilities:

- no first-class notion of a managed stream label such as `io`
- no module registry describing which package label maps to which path
- no repo-wide focus document that planning runs treat as the shared source of
  truth
- no comment-driven trigger model such as `@io backlog`
- no webhook or polling loop that notices new `@io ...` comments
- no persistence for seen/handled comments and comment edits
- no Linear writeback flow that proposes options and updates the parent issue
- no maintenance loop that continuously tops the module backlog back up to
  about 5 ready issues
- no merge policy for long-lived module branches beyond the existing stream
  mechanics

## Proposed Workflow

### 1. Repo-wide focus document

Add one repo-wide planning document under `io/topic`:

- `io/topic/goals.md`

This document should answer:

- what the current repo-wide priorities are
- what constraints all managed module streams must respect
- what kinds of work should be deprioritized right now
- what shared interfaces or migrations are currently in flight

This becomes the default planning anchor for every managed module stream.

### 2. Managed parent issue identity

Each module gets one parent Linear issue that acts as the durable stream owner.

The issue becomes managed when it has:

- the label `io`
- exactly one package label such as `agent`

The package label resolves to a module path through a checked-in module
registry.

Example:

- `io` means the issue is agent-managed
- `agent` resolves to `./agent`

This removes the need for user-authored HTML metadata blocks.

### 3. Human-authored description, agent-owned sections

The issue description should stay freeform for the user.

The agent should reorganize the issue into two conceptual layers:

- human-authored intent, constraints, links, and notes
- agent-owned managed sections for summary, proposal, backlog state, and next
  actions

The agent should never assume the whole description is disposable.

Instead, it should rewrite only clearly marked managed sections.

### 4. Comment-driven refresh

The trigger for review and update should be a comment that mentions `@io`.

Examples:

- `@io backlog`
- `@io refresh this stream around the runtime/context direction`
- `@io expand the chosen option into child issues`
- `@io review the backlog and top it back up to 5`

The command surface should stay loose and natural-language oriented.

The important contract is:

- `@io` means "the agent should interpret this request"
- the rest of the comment is freeform intent

### 5. Proposal pass

When a fresh managed parent issue is created and a user comments `@io backlog`,
the backlog agent should:

- read the repo-wide focus doc
- read the module's package manifest, source tree, tests, and local docs
- understand how that module fits into the monorepo
- rewrite the managed sections of the parent issue with:
  - a short module summary
  - current constraints and risks
  - three concrete candidate work options
  - recommended ordering between those options

The three options should be shaped for human editing, not final execution.

Good option format:

- option name
- expected outcome
- why it matters relative to repo-wide focus
- likely touched surfaces
- likely dependencies
- risk level

### 6. Human narrowing pass

The human edits the parent issue down to one selected direction or a mix of the
three options.

The parent issue then becomes the working brief for that module stream, not just
an inbox item.

### 7. Expansion pass

When the parent issue contains an approved direction and a user comments
something like `@io expand`, the backlog agent should:

- reread the parent issue
- rewrite the managed backlog sections as needed
- create child issues under that parent
- add `blockedBy` edges between child issues
- link relevant docs in each child issue body
- keep enough detail in each child issue that the execute agent can work
  without rereading the whole repo from scratch

Target steady state:

- about 5 child issues under the parent that are genuinely ready or nearly
  ready
- 2 to 3 immediately runnable when dependencies allow
- the rest queued behind explicit dependencies

### 8. Continuous maintenance pass

The parent issue should be treated as a durable backlog container, not a
one-shot planning artifact.

On later `@io ...` backlog runs, the agent should:

- reread the repo-wide focus doc
- detect changes in module state or neighboring modules
- preserve completed or in-progress child issues
- avoid destructive rewrites of active child issues
- add new child issues when the ready queue falls below the target depth
- reorder or relink backlog items when priorities shift
- close or demote stale items if the repo-wide focus no longer justifies them

The rule should be:

- stable child issues are append-only once active
- speculative backlog can be rewritten aggressively

### 9. Comment tracking and dedupe

The runtime needs explicit state for comment processing.

Track at least:

- `commentId`
- `issueId`
- `bodyHash`
- `createdAt`
- `updatedAt`
- `handledAt`
- `result`

Processing rules:

- dedupe retries by `commentId`
- only process comments containing `@io`
- first version should probably react only to comment creation
- later versions can optionally re-handle edited comments if the body changes
  and still contains `@io`

The durable state can live in runtime-owned files under `.io` as long as it is
easy to inspect and replay.

## Branch and Merge Model

The current stream branch model is already the right base.

Recommended policy:

- one parent module issue owns one long-lived branch
- branch name stays derived from the parent issue, not the child issue
- every child issue lands onto that module branch
- only one active execute run per module stream at a time
- multiple module streams may run in parallel

### Rebase minimization strategy

To keep rebasing rare, execution tasks need a stronger scope contract than the
current runtime enforces.

Add a module boundary policy:

- default rule: child issues may only change files inside the module path
- allowed shared surfaces must be explicitly declared
- cross-module API work should be split into a dedicated shared-interface stream
  when possible
- repo-wide codemods should be handled as their own stream, not mixed into a
  module stream

Practical rule of thumb:

- module stream branches own local implementation
- shared contracts get their own stream when they affect multiple modules
- accidental drive-by edits outside the module are treated as scope violations

### Landing to `main`

Do not merge every child directly to `main`.

Instead:

- keep landing child work onto the module stream branch
- open or update one PR per module stream against `main`
- merge that PR when the stream reaches a coherent checkpoint
- after merge, reset the stream branch to the merged `main` commit or recreate
  it from `main` if the stream goal is complete

This makes rebasing a stream problem rather than a child-issue problem.

## Data Model Changes

### In repo config

Extend `io.ts` with a module-aware planning profile, for example:

- `module-backlog`
- `module-execute`

Also add a small module registry, either in `io.ts` or a dedicated checked-in
file, with:

- package label
- module path
- module name
- primary docs
- allowed shared paths
- upstream module dependencies
- downstream dependents

This registry should stay small and explicit. It is there to bound planning and
reduce accidental cross-module edits.

### In Linear issue structure

Use:

- parent issue = module stream
- child issue = execution or documentation unit
- `blockedBy` = ordering within a stream
- `io` label = agent-managed stream
- one package label such as `agent` = module identity

Recommended small label set:

- `io`
- package labels such as `agent`, `graph`, `app`
- `cross-module` only when necessary

Avoid action labels such as `planning` or `refresh-now`. Those should be
comments, not durable issue metadata.

### In managed issue content

Use stable issue sections instead of user-authored machine metadata blocks.

Recommended managed sections:

- current summary
- current focus
- proposal options
- selected direction
- child backlog state
- latest `@io` action summary

The first version can mark those sections with headings alone if that proves
stable enough. If not, add lightweight hidden markers that the agent owns.

### In runtime state

Add a comment-processing layer to the runtime state.

Suggested fields:

- `lastSeenCommentAt`
- `processedCommentIds`
- `processedCommentBodiesById`
- `lastBacklogRefreshAt`
- `lastExpansionAt`
- `lastMaintenanceAt`

## Recommended Implementation Phases

### Phase 1: Planning contract

- create `io/topic/goals.md`
- create a focused doc for comment-driven managed streams
- update this module-stream plan
- define the parent issue and child issue templates around labels plus comments

### Phase 2: Module identity and routing

- add the module registry
- route managed parent issues from the `io` label plus package label
- keep issue-body metadata parsing only as compatibility, not the preferred UX

### Phase 3: Comment ingestion

- add comment event handling through Linear webhooks or a polling fallback
- detect `@io ...` comments on managed issues
- persist seen/handled comment state

### Phase 4: Proposal writeback

- extend the backlog flow so it can update the parent Linear issue body
- implement the three-option proposal format
- ensure reruns update only managed sections without clobbering human edits

### Phase 5: Expansion into child issues

- create child issues from the approved parent brief
- add `parentId`
- add `blockedBy` edges
- stamp each child with doc links and module scope
- keep roughly 5 child issues ready under the parent

### Phase 6: Maintenance loop

- detect when backlog depth falls below target
- add or reorder future child issues
- keep active and completed children stable
- surface drift between repo-wide focus and module backlog in the parent issue

### Phase 7: Merge discipline and guardrails

- define branch protection and PR expectations for stream branches
- require module-boundary validation before child completion
- decide when a change must become a shared-interface stream instead of staying
  in one module stream

## Guardrails

The workflow only stays healthy if planning and execution are constrained.

Required guardrails:

- parent issue owns strategy, child issues own implementation
- active child issues are not rewritten except for clarifications
- each child issue declares the module path it is allowed to touch
- module streams do not absorb opportunistic repo-wide cleanup
- cross-module work is explicit and rare
- every child issue links the docs needed to execute it
- the backlog agent should prefer adding new tasks over rewriting history
- only comments on `io`-labeled issues should trigger managed planning behavior

## Recommended First Slice

If this is implemented incrementally, start with the smallest loop that proves
the model:

1. introduce `goals.md`
2. add the `io` managed-stream label contract
3. add the package-label-to-path registry
4. teach the system to react to `@io backlog`
5. rewrite the parent issue with exactly three options
6. teach the backlog agent to expand an approved parent issue into child issues
   plus `blockedBy` edges
7. top the stream back up to 5 tasks on later `@io ...` runs

That first slice is enough to validate:

- label-driven module discovery
- repo-wide focus alignment
- human-in-the-loop narrowing
- ordered child issue creation
- comment-triggered backlog refresh
- compatibility with the existing stream branch runtime

## Why This Fits The Current Codebase

This plan matches the repo's current architecture rather than fighting it.

- The repo already thinks in terms of backlog vs execute agents.
- The runtime already serializes work inside a stream and parallelizes across
  streams.
- The workspace layer already lands child work onto a parent-owned branch.
- The missing work is mostly module identity, comment ingestion, tracker write
  APIs, and stricter module-boundary rules.

That means the implementation risk is mostly in Linear interaction and backlog
authoring behavior, not in the scheduler or worktree model.
