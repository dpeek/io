# Architecture And Vision Docs

This directory breaks both [`../roadmap.md`](../roadmap.md) and
[`../vision.md`](../vision.md) into smaller documents. The source drafts remain
canonical; these files reorganize them into reviewable slices.

## Roadmap Docs

1. [`01-executive-summary.md`](./01-executive-summary.md): current thesis,
   target product, and the platform primitives that should be stabilized first
2. [`02-current-state-architecture.md`](./02-current-state-architecture.md):
   what the repo proves today, including storage, sync, web, agent, and
   security boundaries
3. [`03-target-platform-architecture.md`](./03-target-platform-architecture.md):
   the intended end-state platform model, including modules, sync scopes,
   auth, secrets, and observability
4. [`04-gap-analysis.md`](./04-gap-analysis.md): what is missing, what must be
   refactored, and what should be preserved
5. [`05-recommended-architecture.md`](./05-recommended-architecture.md): the
   proposed package/runtime split, storage model, query model, and deployment
   topology
6. [`06-migration-plan.md`](./06-migration-plan.md): phased rollout, sequencing
   rationale, fallback options, and the first 90 days
7. [`07-open-questions.md`](./07-open-questions.md): roadmap decisions that
   still need validation

## Vision Docs

8. [`08-vision-overview.md`](./08-vision-overview.md): product purpose, current
   proof surfaces, product thesis, differentiators, and core product
   requirements
9. [`09-vision-platform-architecture.md`](./09-vision-platform-architecture.md):
   Cloudflare deployment model, Durable Object topology, sharding, query,
   privacy, federation, and storage tiers
10. [`10-vision-product-model.md`](./10-vision-product-model.md): module
    system, taxonomy, workflow, agent memory, UI direction, sync model, and
    ingestion model
11. [`11-vision-execution-model.md`](./11-vision-execution-model.md): repo and
    contract boundaries, major risks, phased plan, research questions, platform
    anchors, and the closing recommendation

## Working Docs

- [`perf.md`](./perf.md): measured test-performance baseline, primary
  bottlenecks, and the current optimization plan for `bun test ./src`

## Branch Docs

- [`branch/README.md`](./branch/README.md): platform branches as parallel
  workstreams with dependencies, critical-path guidance, and canonical branch
  specs where available
- [`branch/01-graph-kernel-and-authority.md`](./branch/01-graph-kernel-and-authority.md):
  canonical contract for Branch 1 graph kernel and authority work
- [`branch/02-identity-policy-and-sharing.md`](./branch/02-identity-policy-and-sharing.md):
  canonical contract for Branch 2 identity, policy, and sharing work
- [`branch/03-sync-query-and-projections.md`](./branch/03-sync-query-and-projections.md):
  canonical contract for Branch 3 sync, query, and projection work
- [`branch/04-module-runtime-and-installation.md`](./branch/04-module-runtime-and-installation.md):
  canonical contract for Branch 4 module runtime and installation work
- [`branch/05-blob-ingestion-and-media.md`](./branch/05-blob-ingestion-and-media.md):
  canonical contract for Branch 5 blob, ingestion, provenance, and media work
- [`branch/06-workflow-and-agent-runtime.md`](./branch/06-workflow-and-agent-runtime.md):
  canonical contract for Branch 6 workflow and agent runtime work
- [`branch/07-web-and-operator-surfaces.md`](./branch/07-web-and-operator-surfaces.md):
  canonical contract for Branch 7 web and operator surface work

## Source Mapping

### Roadmap

- Section `1. Executive summary` -> `01-executive-summary.md`
- Section `2. Current-state architecture` ->
  `02-current-state-architecture.md`
- Section `3. Target-state platform architecture` ->
  `03-target-platform-architecture.md`
- Section `4. Gap analysis` -> `04-gap-analysis.md`
- Section `5. Recommended architecture` plus `ASCII summary diagrams` ->
  `05-recommended-architecture.md`
- Section `6. Migration plan` plus `Recommended first 90 days` ->
  `06-migration-plan.md`
- Section `7. Open questions and decisions requiring validation` ->
  `07-open-questions.md`

### Vision

- Sections `Purpose` through `Product Shape` -> `08-vision-overview.md`
- Sections `Architecture Direction` through `Storage tiers` ->
  `09-vision-platform-architecture.md`
- Sections `Module system` through `Ingestion model` ->
  `10-vision-product-model.md`
- Sections `Monorepo and development model` through `Recommendation` ->
  `11-vision-execution-model.md`
