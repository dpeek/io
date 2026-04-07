---
name: Graph module workflow documents
description: "Workflow-owned document, document-block, and document-placement slices in @io/graph-module-workflow."
last_updated: 2026-04-03
---

# Graph module workflow documents

## Read this when

- you are changing workflow-owned documents or placements
- you need to understand the document block kinds or placement tree model
- you are tracing workflow context or goal references that point at documents

## Main source anchors

- `../src/document.ts`: document, block, and placement slices
- `../src/type.ts`: workflow types that reference workflow-owned documents
- `./workflow-stack.md`: cross-package workflow product contract

## What this layer owns

- `workflow:document`
- `workflow:documentBlockKind`
- `workflow:documentBlock`
- `workflow:documentPlacement`

It does not own markdown rendering chrome or route-local editors.

## Document slice

`workflow:document` is the reusable workflow-owned document entity.

Current fields include:

- inherited node title and description fields
- `isArchived`
- `slug`
- unordered `tags` references to `core:tag`

## Block kinds

`workflow:documentBlockKind` currently has three built-in values:

- `markdown`
- `entity`
- `repo-path`

`workflow:documentBlock` stores ordered block content under one document and
can point at:

- inline markdown content
- another graph entity
- a repository path

The current default block kind is `markdown`.

## Placement tree

`workflow:documentPlacement` stores ordered document placement within one named
tree.

Current important fields are:

- `document`
- `treeKey`
- `parentPlacement`
- `order`

`parentPlacement` uses the shared existing-entity reference contract with
`excludeSubject: true`, so placements cannot parent themselves.

## Relationship to the workflow model

Workflow branch and commit records still point at document ids for durable
context and goal references. That keeps authored workflow memory graph-native
instead of pushing it into browser-only state.

## Practical rules

- Keep workflow documents as package-owned graph entities.
- Reuse these slices for workflow context or goal references instead of
  inventing route-local document state.
