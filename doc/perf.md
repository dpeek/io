# Test Performance Plan

## Goal

Bring `bun test ./src` down from the current roughly `239s` wall-clock
baseline to a materially faster default developer loop without losing coverage
by accident.

## Current Baseline

Measured on 2026-03-23:

- `bun test ./src --only-failures`: `238.7s`
- `bun test ./src --only-failures --reporter=junit --reporter-outfile tmp/bun-junit.xml`:
  `233.0s`
- suppressing normal console output only saves about `6s`, so output noise is
  not the primary problem

The current run profile is concentrated in a small number of suites:

- `src/web/lib/authority.test.ts`: about `73.6s`
- `src/web/lib/graph-authority-do.test.ts`: about `53.4s`
- `src/web/lib/workflow-authority.test.ts`: about `50.9s`
- `src/web/lib/example-runtime.test.ts`: about `14.2s`
- `src/agent/workspace.test.ts`: about `16.4s`
- `src/mcp/graph.test.ts`: about `7.5s`

The web authority tests alone account for about `194s` of testcase time. That
is the critical path.

## What Is Expensive

### Authority bootstrap

`src/web/lib/authority.ts` currently bootstraps a fresh store, seeds example
data, and hydrates persisted authority state on every `createWebAppAuthority()`
call.

Observed micro-benchmark:

- fresh `createWebAppAuthority()` averages about `1.09s`

### Replayed workflow setup

Many web tests replay the same setup flow:

- create project
- create repository
- create branch
- attach branch repository target

Observed micro-benchmarks:

- fresh authority plus common workflow fixture averages about `5.12s`
- starting from a persisted post-fixture snapshot averages about `0.98s`

That means the repeated fixture replay costs about `4s` each time we do it.

### Full-store clone and diff on each workflow mutation

`src/web/lib/workflow-authority.ts` currently creates a fresh store, bootstraps
namespaces, snapshots before and after mutation, and diffs the full graph to
derive a transaction. This is expensive in tests and in the runtime path.

Observed micro-benchmark:

- repeated `attachBranchRepositoryTarget` mutations average about `1.05s` each

### Full-store snapshots around authoritative writes

`src/graph/runtime/persisted-authority.ts` snapshots the full store before and
after every authoritative write so it can roll back on durable commit failure.

### Real integration work in non-web tests

`src/agent/workspace.test.ts` shells out to real `git`, worktree, merge, and
rebase flows. Those tests are valid, but they are integration-heavy by design.

## Success Criteria

### Primary target

- reduce the default `bun test ./src` run to under `120s`

### Secondary target

- reduce the default `bun test ./src` run to under `90s` without hiding major
  coverage gaps behind optional suites

### Non-goals

- rewriting the entire test stack in one pass
- deleting integration coverage just to make the number look better

## Plan

### 1. Add repeatable profiling and keep the baseline visible

- keep a documented JUnit profiling command so every optimization pass can be
  measured the same way
- capture the slowest files and testcases after each change
- use the same `tmp/bun-junit.xml` output shape for before/after comparison

Expected outcome:

- no more guesswork about where time moved

### 2. Reuse persisted baseline fixtures in web authority tests

Start with:

- `src/web/lib/authority.test.ts`
- `src/web/lib/workflow-authority.test.ts`

Approach:

- build a helper that creates a known-good persisted authority snapshot once
- build a second helper that spins up a fresh authority from that stored state
- stop replaying the same project/repository/branch setup in every test

Why this goes first:

- it is the highest-leverage test-only change
- the measured fixture replay cost is already large enough to save tens of
  seconds on its own
- it does not require changing core runtime semantics

Expected outcome:

- save roughly `20-40s` from the default run, depending on how many repeated
  setup paths collapse

### 3. Add a minimal or test-only authority bootstrap path

Approach:

- let tests opt out of `seedExampleGraph(...)` when they do not actually
  require seeded PKM example content
- prefer a minimal graph/bootstrap shape for workflow and secret tests

Why:

- every seeded authority makes bootstrap slower
- every later snapshot, diff, and validation pass gets more expensive when the
  starting graph is larger than the test needs

Expected outcome:

- save another `10-20s`
- make later runtime-path optimizations more effective because the working set
  shrinks

### 4. Remove full-store clone and diff from workflow mutation planning

Start with:

- `src/web/lib/workflow-authority.ts`

Approach:

- replace whole-store fork/snapshot/diff planning with a mutation path that
  records operations directly
- keep the current transaction output contract, but generate it incrementally
  rather than reconstructing it from two full snapshots

Why:

- this is the most obvious runtime hot path in the current profile
- it helps both tests and product code

Expected outcome:

- save roughly `30-60s`

### 5. Reduce snapshot churn in the persisted authority path

Start with:

- `src/graph/runtime/persisted-authority.ts`
- `src/web/lib/authority.ts`

Approach:

- audit every `store.snapshot()` call in the authoritative write path
- only take rollback snapshots where the durable storage boundary actually
  needs them
- avoid redundant snapshotting for authorization checks when a read-only view
  of the current store is enough

Why:

- full snapshots are repeated around almost every write
- the current web authority tests exercise this path heavily

Expected outcome:

- save another `10-20s`

### 6. Triage the remaining integration-heavy suites

Targets:

- `src/web/lib/graph-authority-do.test.ts`
- `src/agent/workspace.test.ts`
- `src/mcp/graph.test.ts`

Approach:

- keep a small number of end-to-end integration tests
- move duplicated behavior checks down to unit-level seams where possible
- for git-heavy tests, share repo fixtures where practical instead of
  rebuilding repositories from scratch for every case

Optional fallback:

- if the default developer loop still needs to be much faster, split slow
  integration suites into a separate command and keep `bun test ./src` focused
  on the fast path

Expected outcome:

- integration coverage remains, but the default loop stops paying for every
  expensive end-to-end case on every edit

## Recommended Order

1. Add reusable persisted fixture helpers for the web authority tests.
2. Add minimal bootstrap or no-seed test paths.
3. Rework workflow mutation planning to avoid whole-store diffing.
4. Trim snapshot churn in the persisted-authority write path.
5. Revisit the remaining git, Durable Object, and MCP integration suites.

## Validation After Each Step

- run `bun test ./src --only-failures`
- run the JUnit profile command and compare top offenders
- confirm that the slowest files actually moved, not just the reporting layer
- keep the plan updated with the new baseline after each meaningful win
