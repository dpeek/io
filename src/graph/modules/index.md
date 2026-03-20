# Graph Modules

## Purpose

This root now owns built-in graph module authoring as the package tree shifts
from top-level `schema/` ownership toward explicit module ownership.

## Current State

- canonical built-in schema now lives under `../../src/graph/modules/`
- `@io/core/graph/modules`, `@io/core/graph/modules/core`, and
  `@io/core/graph/modules/app` are the ownership-first package entry surfaces
- focused app slices stay available from `@io/core/graph/modules/app/env-vars`
  and `@io/core/graph/modules/app/topic`
- `../../src/graph/schema/` and `@io/core/graph/schema*` remain as compatibility
  wrappers for existing imports
- follow-up slices can extend module families here without reintroducing the
  legacy `../../src/graph/graph/` compatibility bucket
