# Graph Modules

## Purpose

This root now owns built-in graph module authoring as the package tree shifts
from top-level `schema/` ownership toward explicit module ownership.

## Current State

- canonical built-in schema now lives under `../../src/graph/modules/`
- `@io/core/graph/modules`, `@io/core/graph/modules/core`,
  `@io/core/graph/modules/ops`, and `@io/core/graph/modules/pkm` are the
  ownership-first package entry surfaces
- structured core value families such as `duration`, `percent`, `quantity`,
  and `money` live here as authored modules instead of being modeled as loose
  number/string conventions
- focused product slices stay available from `@io/core/graph/modules/pkm/topic`
  and `@io/core/graph/modules/ops/env-var`
- per-type authoring stays in singular folders such as
  `../../src/graph/modules/pkm/topic/`, with `schema.ts` as the slice entry
  file and direct compatibility shims at `../../src/graph/schema/<namespace>/<type>.ts`
- `../../src/graph/schema/` and `@io/core/graph/schema*` remain as compatibility
  wrappers for existing imports
- follow-up slices can extend module families here without reintroducing the
  legacy `../../src/graph/graph/` compatibility bucket
