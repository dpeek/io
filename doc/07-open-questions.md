# Open Questions

This document collects the decisions that the roadmap still marks as requiring
validation.

## Questions Requiring Validation

1. Which subset of today’s graph exports should become the first stable public
   platform contracts?
2. Should Better Auth use D1, dedicated Worker-side SQLite, or another auth
   store, and how should graph principal projection be versioned?
3. What is the exact scope-definition language for query, module, entity, share,
   and agent-context scopes?
4. Which collection queries justify global materialized indexes versus shard-
   local indexes plus bounded fan-out?
5. What should the first packaging substrate for modules be: local or Git-backed
   modules, npm, or signed bundles?
6. How should outbound sharing projections be represented and invalidated?
7. What observability schema should exist for transaction commit, projection
   build, sync fallback, and agent runs?
8. Which parts of the current issue-driven agent runtime are durable product
   primitives versus temporary bootstrapping scaffolding?
9. How much of the current `app:` taxonomy should move into foundation modules,
   and what should stay module-local?
10. What is the migration story for shard moves and scope invalidation when an
    entity’s home shard changes?

## Review Guidance

If these docs are used as the basis for implementation planning, the first pass
should answer the questions in this order:

1. Stable platform contracts
2. Auth and principal projection boundary
3. Scope-definition language
4. Indexing strategy
5. Module packaging substrate

Those five decisions shape most of the later sharding, federation, and workflow
work.
