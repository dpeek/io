---
name: Graph react edit sessions and validation
description: "Edit-session contracts, validation issue modeling, and validated mutation helpers in @io/graph-react."
last_updated: 2026-04-02
---

# Graph react edit sessions and validation

## Read this when

- you are changing shared draft or touched state contracts
- you need to understand the path or scope validation model
- you are wiring mutation validation into host-neutral field or form logic

## Main source anchors

- `../src/edit-session.ts`: edit-session and field-controller contracts
- `../src/validation-issue.ts`: shared validation issue model
- `../src/mutation-validation.ts`: validated mutation helper
- `../src/edit-session.test.ts`: commit-policy and controller-shape coverage
- `../src/validation-issue.test.ts`: normalization and aggregation coverage

## What this layer owns

- edit-session controller interfaces and commit-policy metadata
- path and scope validation issue modeling
- aggregation helpers for field and form surfaces
- host-neutral validated mutation orchestration

It does not own draft scheduling. Hosts interpret the commit policy.

## Edit-session contracts

The shared edit-session contract distinguishes:

- `EditSessionController`
- `EditSessionFieldController`

Supported commit-policy modes are:

- `immediate`
- `blur`
- `debounce`
- `submit`

Important rule:

- the package describes commit policy but does not schedule `commit()` itself

That means hosts decide when blur, debounce, or submit semantics actually
become committed values.

## Validation issue model

The shared validation model has two issue kinds:

- `path`
- `scope`

Use:

- path issues for field-addressable errors
- scope issues for form, command, or other non-field surfaces

The main helpers are:

- `createPathValidationIssue(...)`
- `createScopedValidationIssue(...)`
- `normalizeGraphValidationIssue(...)`
- `normalizeGraphValidationIssues(...)`
- `collectValidationIssuesForPath(...)`
- `collectValidationIssuesForScope(...)`
- `aggregateValidationIssues(...)`

Important behavior:

- issue paths are cloned and frozen
- aggregation builds exact-match lookup tables for path and scope
- graph-client validation issues normalize into the same shared path issue
  shape

## Validated mutation helper

`performValidatedMutation(...)` is the host-neutral bridge between local
validation and one actual mutation call.

Behavior:

- if validation returns a failing graph validation result, the helper reports a
  `GraphValidationError` through `onMutationError` and skips mutation
- if mutation succeeds and returns `true`, the helper calls
  `onMutationSuccess`
- if mutation throws `GraphValidationError`, the helper reports it through
  `onMutationError`
- non-validation exceptions still throw

## Practical rules

- Keep path and scope issue shapes consistent across fields, forms, commands,
  and authority failures.
- Keep commit-policy metadata descriptive rather than imperative.
- Reuse `performValidatedMutation(...)` when host-neutral mutation wiring needs
  one shared validation boundary.
