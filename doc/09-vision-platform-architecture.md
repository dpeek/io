# Vision Platform Architecture

This document collects the platform-shape sections from
[`../vision.md`](../vision.md): deployment model, topology, privacy, federation,
and storage.

## Cloudflare Deployment Model

The deployable unit should be one Worker application plus supporting Cloudflare
resources.

Likely building blocks:

- Workers for HTTP APIs, web delivery, auth hooks, and orchestration
- Durable Objects for authoritative graph partitions and low-latency serialized
  coordination
- R2 for large blobs such as uploads, documents, and image originals
- Queues for asynchronous ingestion, indexing, import, and fan-out work

The vision explicitly avoids hard-coding current platform limits inside the
architecture. Those limits should be re-verified before the final topology is
locked.

## Durable Object Topology

The current single authority Durable Object is treated as a proof, not the
final product shape. The target model is a small directory object plus many
shard objects.

### Directory object

Responsibilities:

- graph bootstrap and metadata
- module manifest and installed versions
- shard map
- graph-level capabilities and trust relationships
- query planner entrypoint
- import and export coordination

The directory object should remain a control plane, not the hot data plane.

### Shard objects

Responsibilities:

- authoritative storage for a subset of facts
- validation and transaction application for that shard
- local indexes for common predicates
- incremental history and cursor continuity for that shard

### Auxiliary objects

Likely later additions:

- blob ingest coordinators
- background job coordinators
- shared-link or federation coordinators
- module installation and migration coordinators

## Sharding Model

The default sharding strategy is subject-home sharding:

- every entity has a home shard
- facts whose subject is that entity live on that shard
- most single-entity reads and writes stay local
- typed refs still feel singular because the directory resolves the home shard

The design also needs room for secondary structures:

- predicate indexes for reverse lookup
- materialized relationship edges for high-value traversals
- time-partitioned event shards for append-heavy logs
- blob metadata shards for large media collections

The vision is explicit that arbitrary distributed joins are not free and should
not be hidden behind a misleadingly simple query model.

## Query Model

The query system should stay layered:

### Local entity and neighborhood queries

Fast paths for:

- fetch entity by id
- fetch fields for one subject
- traverse a small relationship neighborhood

These should hit one shard or a tightly bounded set of shards.

### Indexed collection queries

Examples:

- all contacts with a given tag
- events in a date range
- all emails in one thread

These should rely on shard-local or global materialized indexes, not raw graph
scans.

### Federated queries

Examples:

- fetch linked contact profiles from a trusted external graph
- resolve organization records shared by another person
- let an agent search across explicitly linked project graphs

These should be capability-bounded and plan-driven rather than open-ended
distributed traversal.

Practical query rules:

- local graph queries may compose freely inside one user graph
- cross-shard queries require indexes or bounded fan-out
- cross-graph queries require explicit capabilities, explicit entrypoints, and
  cost limits

## Privacy, Auth, And Principals

The current predicate `visibility` and `write` metadata should grow into a
principal-aware policy system.

Likely visibility classes:

- owner-only
- graph-member
- explicitly shared
- public
- authority-only

Likely write classes:

- local user edit
- authorized member edit
- module command only
- authority or ingest only

The key requirement is that policy attaches to predicates and is enforced at:

- sync time
- query planning time
- command execution time
- module installation time
- remote graph linking time

### Auth boundary

The vision suggests Better Auth as the authentication framework while keeping
durable principals and authorization relationships in the graph.

Clean boundary:

- Better Auth owns sessions, providers, passkeys, passwords, verification
  flows, and auth plugins
- the graph owns users, people, memberships, roles, capabilities, sharing
  grants, agent permissions, and audit-linked identity references

The graph remains the application model for who the user is, which graph they
own or can access, and which predicates or commands they may read and write.

## Graph Linking And Federation

The product goal is not one global shared graph. It is many user-owned graphs
that can link under strict policy.

The intended model is capability-based federation:

- graphs keep data private by default
- graphs expose selected predicates or views to another graph
- graphs grant query capabilities to other graphs or principals
- graphs receive imported projections from other graphs
- graphs retain explicit provenance for remote facts

The system distinguishes:

- local facts authored in the owner graph
- mirrored remote facts imported from another graph
- references to remote entities that remain remote
- derived facts computed from local and remote data

### Recommended federation pattern

Remote graphs should not directly query arbitrary raw predicates. Instead,
owners expose narrow auditable surfaces such as:

- shared predicates with explicit policy
- shared named views
- shared workflows or commands
- shared indexes designed for federation

### Predicate-level sharing

Predicate sharing means:

- a predicate may be marked shareable
- the owner may grant a capability for that predicate to a target graph or role
- only the allowed value projection is exposed
- hidden sibling predicates remain hidden

### Cross-graph efficiency

The vision expects efficient cross-graph access to come from precomputed
surfaces:

- materialized outbound projections
- indexes over those projections
- local caching with provenance metadata where appropriate
- explicit planner and UI treatment for cross-graph queries

## Storage Tiers

Not all data belongs in the same storage substrate.

### Graph facts and metadata

Durable Objects with SQLite-backed state are the natural fit for:

- entities and edges
- schema metadata
- indexes
- sync cursors
- module manifests
- workflow state
- agent execution records

### Large blobs

Large raw payloads belong outside the graph fact store:

- uploaded files
- image originals and derivatives
- document binaries
- email attachments
- imported archives

The graph should store blob identity, ownership, hashes, MIME, extracted
metadata, processing status, access policy, and object-storage references.

### Derived indexes

These should be materialized and rebuildable from authoritative graph and blob
state:

- full-text indexes
- time-range indexes
- relationship indexes
- remote-share projections
- agent retrieval indexes
