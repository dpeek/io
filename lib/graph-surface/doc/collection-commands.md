---
name: Graph surface collection commands
description: "Collection command subjects and proving-ground binding behavior in @io/graph-surface."
last_updated: 2026-04-03
---

# Graph surface collection commands

## Read this when

- you are changing `resolveCollectionCommandBindings(...)`
- you need to understand what collection command surfaces the current browser
  host supports
- you are wiring row or selection actions over query results

## Main source anchors

- `../src/collection-command-surface.ts`: command subject and binding helpers
- `../src/collection-command-surface.test.ts`: supported and unsupported
  binding examples
- `../src/react-dom/collection-command-buttons.tsx`: current browser trigger UI

## What this layer owns

- entity and selection command subjects over query result items
- collection command binding resolution for the current proving-ground browser
  host
- explicit issue reporting for unsupported command surface shapes

It does not own command execution policy or command dialog composition.

## Execution subjects

The package supports two execution subject shapes:

- `entity`
- `selection`

Helpers:

- `createEntityCollectionCommandSubject(item)`
- `createSelectionCollectionCommandSubject(items)`

Important behavior:

- entity subjects require one `QueryResultItem.entityId`
- selection subjects keep only items with `entityId`
- a subject helper returns `null` when no usable entity ids are available

That means collection command execution only runs over entity-backed query
rows today.

## Binding model

`resolveCollectionCommandBindings(...)` takes:

- one authored `CollectionSurfaceSpec`
- one host-supplied binding map keyed by command surface key

On success it produces:

- ordered entity command bindings
- ordered selection command bindings
- collected binding issues

The command ordering follows the original `collection.commandSurfaces` list.

## Current support boundary

The current browser host is intentionally narrower than the authored command
contract.

Supported today:

- subject kinds `entity` and `selection`
- post-success behaviors `refresh` and `openCreatedEntity`

Unsupported today:

- `scope` subjects
- any other post-success behavior

Unsupported bindings are reported as issues rather than being coerced into a
best-guess runtime.

## Issue model

Current issue codes are:

- `binding-missing`
- `unsupported-post-success`
- `unsupported-subject-kind`

That keeps authored metadata problems separate from host integration gaps.

## Browser button layer

The current `react-dom` button layer is small on purpose.

`CollectionCommandButtons`:

- renders nothing when there is no subject or no commands
- handles one pending command at a time
- supports inline confirmation when `submitBehavior.kind === "confirm"`
- forwards completion through `onExecuted(...)`

It does not build dialog or sheet input flows yet. That still stays host-owned.

## Practical rules

- Use these helpers for row and selection actions over query results.
- Expect scope-level command surfaces to stay unsupported until the host grows
  a broader collection command runtime.
- Keep command execution and richer input composition outside this package.
