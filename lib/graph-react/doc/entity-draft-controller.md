---
name: Graph react entity draft controller
description: "Draft-value helpers and the draft-backed entity controller in @io/graph-react."
last_updated: 2026-04-02
---

# Graph react entity draft controller

## Read this when

- you are changing `createEntityDraftController(...)`
- you need to understand how `graph-react` builds draft-backed predicate refs
- you are debugging draft input cloning, logical equality, or field-level
  validation behavior

## Main source anchors

- `../src/entity-draft.ts`: draft controller implementation
- `../src/draft-value.ts`: draft cloning and logical equality helpers
- `../src/edit-session.ts`: controller interfaces consumed by the draft
  controller

## What this layer owns

- draft cloning and logical equality helpers
- the draft-backed entity controller
- draft predicate refs with cardinality-aware mutation helpers

It does not own persisted graph writes.

## Draft-value helpers

`draft-value.ts` owns the shared value semantics for draft editing:

- `cloneDraftValue(...)`
- `sameLogicalValue(...)`
- `getDraftValue(...)`
- `setDraftValue(...)`
- `removeDraftItem(...)`

Important behavior:

- Date and URL values are cloned structurally
- arrays and plain objects are cloned recursively
- missing `many` values read back as `[]`
- nested objects are created on demand during `setDraftValue(...)`
- item removal uses logical equality rather than raw identity

## Draft controller shape

`createEntityDraftController(...)` returns:

- `fields`
- `session`
- `getInput()`

The controller is built from:

- a draft subject id
- a field tree
- initial input
- entity lookup helpers
- a type map
- a validation function

## Session and field policy

The draft controller is intentionally submit-oriented.

Current behavior:

- the session default commit policy is `{ mode: "submit" }`
- every field controller also defaults to submit policy
- session commit or revert operates over the whole draft input
- field commit or revert operates only over that field path

That makes the controller suitable for draft-backed create and form flows
rather than immediate graph mutation.

## Draft-backed predicate refs

The controller builds predicate refs over the draft input, not over a live
store.

Current behavior by cardinality:

- `many`: `add`, `remove`, `replace`, `clear`, plus validation variants
- `one?`: `set`, `clear`, plus validation variants
- `one`: `set`, plus a validation variant

Entity-range draft refs also expose:

- `listEntities()`
- `resolveEntity(...)`

That keeps typed relationship ergonomics available during draft editing.

## Validation behavior

Field-level `validate*` helpers apply the candidate mutation and run the shared
validator.

Important rule:

- if validation fails only on other predicates, the field-level helper still
  returns an ok result for the local predicate change

That behavior is intentional. These helpers are local predicate checks, not
whole-form submit gates.

## Practical rules

- Use this controller for draft-backed form and create flows.
- Keep its refs draft-only and host-neutral.
- Leave persisted mutation timing and authority writes to later layers.
