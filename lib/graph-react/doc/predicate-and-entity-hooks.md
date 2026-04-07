---
name: Graph react predicate and entity hooks
description: "Predicate hooks, metadata readers, and entity traversal helpers in @io/graph-react."
last_updated: 2026-04-03
---

# Graph react predicate and entity hooks

## Read this when

- you are changing host-neutral predicate or entity hooks
- you need to understand how `graph-react` reads authored field metadata
- you are tracing typed relationship traversal without dropping to DOM code

## Main source anchors

- `../src/predicate.ts`: predicate hooks and metadata readers
- `../src/entity.tsx`: entity traversal helpers
- `../../graph-surface/doc/ui-stack.md`: cross-package ref and UI boundary

## What this layer owns

- subscription-backed predicate value hooks
- host-neutral metadata readers over authored field contracts
- entity and related-entity traversal helpers over typed refs

It does not own typed refs themselves. Those stay in `@io/graph-client`.

## Predicate hooks

The core hook surface is:

- `usePredicateValue(...)`
- `usePredicateSlotValue(...)`
- `usePredicateField(...)`

Important behavior:

- subscriptions stay keyed to the underlying typed ref or predicate slot
- snapshots are stabilized so logically equal Date, URL, array, and plain
  object values do not trigger pointless rerenders
- `usePredicateField(...)` resolves one binding object that includes the
  predicate, field, range type, metadata, display kind, editor kind,
  collection kind, and current value

## Metadata readers

`predicate.ts` is the host-neutral bridge from authored field metadata to later
adapter behavior.

It exports helpers for:

- `getPredicateFieldMeta(...)`
- `getPredicateEntityReferencePolicy(...)`
- `getPredicateDisplayKind(...)`
- `getPredicateEditorKind(...)`
- editor placeholder, input type, input mode, autocomplete, parser, and
  formatter access
- collection kind resolution for `many` fields

Important rule:

- entity-reference policy is read from authored metadata and turned into host
  defaults such as the fallback display or editor kind, but this package does
  not pick DOM widgets.

## Enum and entity-reference helpers

The package also owns host-neutral helpers for closed-option and
entity-reference predicates:

- `getPredicateEnumOptions(...)`
- `formatPredicateValue(...)`
- `getPredicateEntityReferenceOptions(...)`
- `getPredicateEntityReferenceSelection(...)`

These helpers stay at the typed-ref and authored-metadata level. They do not
own combobox rendering or async search UX.

## Entity traversal helpers

`entity.tsx` packages route-neutral traversal helpers over typed entity refs:

- `useEntityPredicateEntries(...)`
- `EntityPredicates`
- `usePredicateRelatedEntities(...)`
- `PredicateRelatedEntities`

Important behavior:

- nested field-group refs are flattened into stable path entries
- path labels are explicit dot-joined paths
- related-entity traversal only activates for entity-range predicates
- selected related ids are resolved back through the typed ref APIs

## Practical rules

- Keep typed ref construction in `@io/graph-client`.
- Keep metadata reading and typed traversal here.
- Leave browser-specific rendering and input widgets to adapter packages.
