# Test Performance Plan

## Goal

Bring `bun test ./src` down from the current roughly `239s` wall-clock
baseline to a materially faster default developer loop without losing coverage
by accident.

As of 2026-03-28, root `bun check` runs one cached repo-wide static
format/lint/type-check task and then cached Bun tests for workspace packages
through `turbo run test --affected`.

As of 2026-03-28, Turborepo is also configured to:

- treat package `build` outputs as cached `out/**` artifacts instead of hashing
  committed build output back into `build` and `test`
- make `test` depend on dependency `build` tasks for cleaner cache correctness
- use task-level `inputs` for `--affected`
- default task logs to `errors-only` with hash markers so agent runs stay quiet

## Current Baseline

Measured on 2026-03-23:

- `bun test ./src --only-failures`: `238.7s`
- `bun test ./src --only-failures --reporter=junit --reporter-outfile tmp/bun-junit.xml`:
  `233.0s`
- suppressing normal console output only saves about `6s`, so output noise is
  not the primary problem

The current run profile is concentrated in a small number of suites:

- `lib/app/src/web/lib/authority.test.ts`: about `73.6s`
- `lib/app/src/web/lib/graph-authority-do.test.ts`: about `53.4s`
- `lib/app/src/web/lib/workflow-authority.test.ts`: about `50.9s`
- `lib/app/src/web/lib/example-runtime.test.ts`: about `14.2s`
- `lib/cli/src/agent/workspace.test.ts`: about `16.4s`
- `lib/cli/src/mcp/graph.test.ts`: about `7.5s`

The web authority tests alone account for about `194s` of testcase time. That
is the critical path.

## Post-Change Profile

Measured on 2026-03-23 after the latest pass:

- `bun test ./src --reporter=junit --reporter-outfile tmp/bun-junit.xml`:
  `31.83s`
- `bun check src`: `42.09s`

The repo guardrail command covers a slightly broader set than `./src`, so the
test counts differ, but the tracked perf target remains the JUnit-profiled
`bun test ./src` command.

Intermediate milestones from the same day:

- `bun test ./src --reporter=junit --reporter-outfile tmp/bun-junit.xml`:
  `107.05s`
- `bun test ./src --reporter=junit --reporter-outfile tmp/bun-junit.xml`:
  `62.17s`
- `bun test ./src --reporter=junit --reporter-outfile tmp/bun-junit.xml`:
  `42.56s`

Slowest files in that JUnit profile:

- `lib/cli/src/agent/workspace.test.ts`: `7.13s`
- `lib/app/src/web/lib/graph-authority-do.test.ts`: `2.70s`
- `lib/cli/src/mcp/graph.test.ts`: `2.69s`
- `lib/app/src/web/components/explorer/catalog.test.ts`: `2.40s`
- `lib/app/src/web/lib/authority.test.ts`: `2.32s`
- `lib/app/src/graph/validation-lifecycle.test.ts`: `2.07s`
- `lib/app/src/web/lib/example-runtime.test.ts`: `1.73s`

Slowest individual testcases in that profile:

- `lib/cli/src/mcp/graph.test.ts`: `reports synced graph status for the product namespace` at `2.32s`
- `lib/cli/src/agent/workspace.test.ts`: `WorkspaceManager lands task work onto the latest parent feature branch` at `1.48s`
- `lib/cli/src/agent/workspace.test.ts`: `WorkspaceManager squashes a done feature branch onto its stream branch and cleans up` at `1.36s`
- `lib/app/src/web/lib/example-runtime.test.ts`: `proves peers catch up through ordered incremental delivery without extra total snapshots` at `1.32s`
- `lib/app/src/web/components/explorer/catalog.test.ts`: `builds entity entries with handles for every explorer entity type` at `1.22s`
- `lib/app/src/web/lib/authority.test.ts`: `allows authority-only commands to reuse the shared authority command seam` at `1.19s`

This clears both the primary `<120s` target and the secondary `<90s` target.

## Landed In This Run

Implemented on 2026-03-23:

- `lib/app/src/web/lib/authority.ts` now supports `seedExampleGraph: false` so tests
  can skip seeded PKM example content when they do not need it.
- `lib/app/src/web/lib/authority-test-helpers.ts` now provides a no-seed test
  authority factory plus a cached persisted workflow baseline
  (project/repository/branch/repository-branch) for reuse across slow web
  authority tests.
- `lib/app/src/web/lib/authority.test.ts`, `lib/app/src/web/lib/workflow-authority.test.ts`,
  and `lib/app/src/web/lib/graph-authority-do.test.ts` now use that no-seed path; the
  workflow-heavy suites also reuse the cached persisted baseline instead of
  replaying the same setup flow in every test.
- `lib/app/src/web/lib/mutation-planning.ts` now records asserted and retracted store
  operations directly from a snapshot-backed mutation store; both
  `lib/app/src/web/lib/workflow-authority.ts` and the secret-field path in
  `lib/app/src/web/lib/authority.ts` now use that planner instead of whole-store
  before/after diffing.
- `lib/graph-authority/src/persisted-authority.ts` now reuses a single pre-write
  snapshot through `applyWithSnapshot(...)` in the authoritative write session
  instead of snapshotting the full store again after every accepted write.
- `lib/app/src/web/lib/authority.ts` now caches compiled graph metadata plus a
  bootstrapped empty snapshot per graph, which removes most repeated
  authority-construction overhead from both tests and runtime callers.
- `lib/app/src/web/lib/example-runtime.ts` now reuses a cached seeded authority
  baseline and records hidden-only cursor mutations directly instead of
  rebuilding and diffing a fresh seeded runtime graph for every test case.
- `lib/cli/src/mcp/schema.ts` and `lib/cli/src/mcp/graph.ts` now cache MCP schema/session
  metadata per namespace, and `lib/cli/src/mcp/graph.test.ts` plus
  `lib/graph-authority/src/authority.test.ts` now reuse cached bootstrapped or
  seeded snapshots instead of repeating raw schema bootstrap in every case.
- `lib/app/src/web/lib/example-runtime.test.ts` now uses an explicit `20_000ms`
  default timeout so the full profiled suite is stable under the slower JUnit
  reporter.
- `lib/cli/src/agent/workspace.test.ts` now keeps only the essential git integration
  proofs: detached issue bootstrap, dirty-work resume/issue switch guard,
  detached landing, standalone stream finalization, child-task landing onto
  the latest parent feature branch, rebase-conflict preservation, feature to
  stream squash finalization, and interrupted issue resume. Duplicated
  recovery and finalization variants were removed.

Validation completed for this pass:

- `bun check lib/cli/src/agent`
- `bun test lib/cli/src/agent/workspace.test.ts`
- `bun check src`
- `bun test ./src --reporter=junit --reporter-outfile tmp/bun-junit.xml`

Remaining hotspots:

- `lib/cli/src/agent/workspace.test.ts`
- `lib/cli/src/mcp/graph.test.ts`
- `lib/app/src/web/lib/graph-authority-do.test.ts`
- `lib/app/src/web/components/explorer/catalog.test.ts`
- `lib/app/src/graph/validation-lifecycle.test.ts`

## What Is Expensive Now

### Git-heavy workspace integration

`lib/cli/src/agent/workspace.test.ts` still shells out to real `git`, worktree,
merge, and rebase flows, but it is now down to the eight end-to-end behaviors
that matter most. At `7.13s`, it is still the slowest individual file, but it
no longer dominates the loop. Further reduction would likely mean mocking away
behavior we still want covered with real repositories.

### MCP cold-start integration

`lib/cli/src/mcp/graph.test.ts` is now mostly one cold-start case:
`createGraphMcpSession > reports synced graph status for the product
namespace`. The rest of the MCP suite is already down in the tens of
milliseconds.

### Durable Object and explorer integration

`lib/app/src/web/lib/graph-authority-do.test.ts` and
`lib/app/src/web/components/explorer/catalog.test.ts` are now the main non-git
integration costs after the workspace suite.

### Real integration work in non-web tests

The original web authority bottleneck is no longer first-order:

- `lib/cli/src/agent/workspace.test.ts`: `17.82s` -> `7.13s`
- `lib/app/src/web/lib/authority.test.ts`: `22.20s` -> `2.32s`
- `lib/app/src/web/lib/graph-authority-do.test.ts`: `25.55s` -> `2.70s`
- `lib/app/src/web/lib/workflow-authority.test.ts`: `6.53s` -> `0.49s`
- `lib/app/src/web/lib/example-runtime.test.ts`: `14.47s` -> `1.73s`
- `lib/cli/src/mcp/graph.test.ts`: `7.72s` -> `2.69s`
- `lib/graph-authority/src/authority.test.ts`: `2.76s` -> `0.31s`

## Success Criteria

### Primary target

- reduce the default `bun test ./src` run to under `120s`
- status: met on 2026-03-23 at `31.83s`

### Secondary target

- reduce the default `bun test ./src` run to under `90s` without hiding major
  coverage gaps behind optional suites
- status: met on 2026-03-23 at `31.83s`

### Non-goals

- rewriting the entire test stack in one pass
- deleting integration coverage just to make the number look better

## Plan

### 1. Triage MCP graph integration bootstrap

- focus on the remaining cold-start `createGraphMcpSession` status proof
- keep write-gate and authority-policy coverage end to end

Expected outcome:

- shave the largest remaining non-git runtime/graph testcase

### 2. Triage Durable Object and explorer integration

- focus on `lib/app/src/web/lib/graph-authority-do.test.ts` and
  `lib/app/src/web/components/explorer/catalog.test.ts`
- look for repeated authority/session bootstrap that can be shared without
  weakening the end-to-end assertions

Expected outcome:

- trim the next cluster of `2s` to `3s` suites without changing behavior

### 3. Reassess the reduced workspace suite only if needed

- the suite now covers just eight essential real-git flows
- only revisit it if a clear fixture-sharing win appears without reducing the
  retained confidence envelope

Expected outcome:

- avoid spending engineering effort on a suite that is no longer the main
  blocker

### 4. Decide whether the remaining integration cost is acceptable

- the default `bun test ./src` loop is now around thirty-two seconds
- further changes should justify their complexity against the real developer
  value of the remaining end-to-end coverage

Expected outcome:

- avoid over-optimizing away useful integration confidence now that the main
  perf targets are already met

## Recommended Order

1. Triage the cold-start `lib/cli/src/mcp/graph.test.ts` session-status case.
2. Triage `lib/app/src/web/lib/graph-authority-do.test.ts` and `lib/app/src/web/components/explorer/catalog.test.ts`.
3. Revisit `lib/cli/src/agent/workspace.test.ts` only if a low-complexity fixture-sharing improvement appears.
4. Reassess whether further optimization is worth the maintenance cost.

## Validation After Each Step

- run `bun test ./src --only-failures`
- run the JUnit profile command and compare top offenders
- confirm that the slowest files actually moved, not just the reporting layer
- keep the plan updated with the new baseline after each meaningful win
