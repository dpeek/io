# Graph Secrets

## Purpose

Describe a concrete proposal for representing secret-backed values in the graph
without treating them as normal replicated scalars.

The goal is to move from the current env-var-specific implementation toward a reusable
schema-level model that client, server, and sync can all enforce consistently.

## Status

Current implementation state:

- Phase 1 is complete: the env-var flow uses sealed `secretHandle` vocabulary
- Phase 2 is complete: field definitions carry `authority` metadata and
  secret-backed references can use `defineSecretField(...)`
- Phase 3 is now enforced in the authoritative runtime: ordinary graph
  transactions may only write `client-tx` fields, while authority flows such as
  env-var secret rotation must opt into `server-command` writes explicitly
- Phase 4 is now enforced in sync: total snapshots exclude `authority-only`
  predicates and incremental sync projects each authoritative transaction down
  to its replicated predicate slice while still advancing the sync cursor
- Phase 5 is underway: `secretHandle` has been promoted to `core:secretHandle`,
  while env-var naming rules remain schema-owned and secret mutation flows now
  live in the web authority

## Problem

Today the web runtime already models environment variables with a secret
handle, but the actual secret semantics do not live in the graph contract
yet.

What exists today:

- the schema can say an `envVar` points at a `secretHandle`
- the synced graph only carries safe metadata such as version and rotation time
- the plaintext value lives in authority-owned side storage
- writes go through an env-var-specific server mutation rather than a generic
  graph-level secret contract

That shape proves an important idea, but it is still too narrow:

- "secret" is modeled as env-var behavior rather than as a reusable field policy
- the server authority owns bespoke mutation logic for one domain type
- sync does not yet have a generic predicate-visibility contract
- the client is safe largely because plaintext never enters the graph, not
  because the schema/runtime explicitly understand secret-backed predicates

The result is that secrets are partially represented in the graph model, but
the rules that make them safe are still spread across authority and UI code.

## Design Goal

Treat "secret-backed value" as a first-class graph concept with three explicit
properties:

1. a schema can declare that a predicate is secret-backed
2. the authoritative runtime can enforce writes and reads for that predicate
3. sync can guarantee that untrusted runtimes only receive the allowed
   replicated slice

The important shift is:

- not "add a better hidden string scalar"
- but "add schema-declared policy around a sealed secret handle"

## Core Model

The right mental model is a sealed secret handle.

The graph should store:

- a stable node or reference that represents the existence and identity of a
  secret
- safe metadata about that secret
- relationships from ordinary domain objects to that secret handle

The graph should not store:

- client-readable plaintext
- a scalar that ordinary synced clients decode as the secret value
- replicated facts whose normal query path would expose secret bytes

In other words, the logical graph model includes secrets, but the ordinary
replicated graph slice only includes secret metadata and references.

## Proposed Schema Contract

### 1. Add field-level authority metadata

Field definitions should be able to declare visibility and write policy close
to the predicate itself.

Suggested shape:

```ts
type GraphFieldAuthority = {
  visibility?: "replicated" | "authority-only";
  write?: "client-tx" | "server-command" | "authority-only";
  secret?: {
    kind: "sealed-handle";
    metadataVisibility?: "replicated" | "authority-only";
    revealCapability?: string;
    rotateCapability?: string;
  };
};
```

This belongs with field authoring, not route code.

The important semantics would be:

- `visibility: "replicated"` means the field may appear in total and
  incremental sync payloads
- `visibility: "authority-only"` means the field never appears in ordinary sync
- `write: "client-tx"` means normal graph transactions may set it
- `write: "server-command"` means callers must go through an explicit
  authoritative command surface
- `secret.kind === "sealed-handle"` means the graph stores an opaque handle plus
  safe metadata rather than a directly readable scalar payload

### 2. Introduce a reusable secret-handle type

The reusable type is now `core:secretHandle`. App slices such as env vars point
at that core type while keeping domain-specific naming rules and command flows
outside the core schema.

Suggested safe fields:

- `version`
- `status`
- `lastRotatedAt`
- `provider`
- `fingerprint?`
- `algorithm?`
- `externalKeyId?`

Possible example:

```ts
secret: defineReferenceField({
  range: secretHandle,
  cardinality: "one?",
  meta: {
    label: "Secret",
  },
  authority: {
    visibility: "replicated",
    write: "server-command",
    secret: {
      kind: "sealed-handle",
      metadataVisibility: "replicated",
      revealCapability: "secret:reveal",
      rotateCapability: "secret:rotate",
    },
  },
});
```

This keeps relationships in the graph while making the handling rules explicit.

### 3. Add a helper for authoring secret-backed fields

Field authoring should not require every caller to hand-assemble the same
policy metadata.

Suggested helper:

```ts
defineSecretField({
  range: secretHandle,
  cardinality: "one?",
  label: "Secret",
  metadataVisibility: "replicated",
  revealCapability: "secret:reveal",
  rotateCapability: "secret:rotate",
});
```

This would be similar in spirit to the current reference-policy helpers:

- keep the durable contract in graph-owned authoring code
- let renderers and runtimes inspect that metadata later
- avoid pushing policy interpretation into arbitrary app routes

## Proposed Runtime Contract

## Client

The client should never receive plaintext through the normal synced graph path.

Client behavior should become explicit rather than incidental:

- synced clients materialize secret handles and allowed metadata only
- local graph queries can observe whether a secret exists, its version, and
  other safe metadata
- local validation can still enforce ordinary structural rules, such as whether
  a secret handle reference is present when required
- local code cannot set authority-only secret-backed predicates through ordinary
  graph transactions

That means the client may know:

- a secret exists
- the secret is missing, stale, or rotated
- which entity owns or references it

But it may not know:

- the plaintext
- any hidden field values that derive from it unless those are separately
  materialized as safe replicated fields

## Server Authority

The server should treat secret-backed fields as first-class authority boundary
cases.

The authoritative runtime should enforce at least three rules:

1. ordinary graph transactions may not directly set secret plaintext
2. secret-backed fields that require `server-command` writes must reject direct
   client transaction attempts
3. reveal and rotate behavior must run through an explicit authoritative
   command path with policy checks

The existing env-var mutation flow becomes an instance of a generic pattern:

- resolve the secret-backed field being changed
- authorize the requested operation
- write or rotate secret material in the authority-owned secret store
- update the graph with safe metadata and handle relationships
- emit only the safe replicated graph changes through sync

## Sync

Sync should stop assuming that every graph fact in the authoritative store is
replicable.

Instead, total and incremental sync should materialize a policy-filtered view of
the authoritative graph.

That means:

- total sync excludes authority-only predicates
- incremental replay excludes authoritative write facts that target hidden
  predicates
- synced clients reconcile against the filtered graph slice, not the raw full
  authority store

This is the key generalization that turns today's "the app simply never syncs
plaintext secrets" into a durable engine rule.

## Proposed Command Contract

Secret operations should be modeled as commands, not as generic field writes.

This matches the existing command direction:

- `localOnly`
- `optimisticVerify`
- `serverOnly`

Secret-bearing operations should default to `serverOnly`.

Suggested reusable command families:

- `setSecret`
- `rotateSecret`
- `clearSecret`
- `revealSecret`

Possible descriptor shape:

```ts
const rotateSecretCommand: GraphCommandSpec<
  {
    subjectId: string;
    field: string;
    plaintext: string;
  },
  {
    secretId: string;
    version: number;
    rotatedAt: string;
  }
> = {
  key: "secret.rotate",
  label: "Rotate secret",
  execution: "serverOnly",
  input: undefined as never,
  output: undefined as never,
  policy: {
    capabilities: ["secret:rotate"],
    touchesPredicates: ["app:envVar:secret"],
  },
};
```

The important point is not the exact syntax. The important point is:

- the user intent crosses the wire as an explicit command
- the authority can inspect, authorize, audit, and replay it
- the resulting graph update only contains safe metadata

## Secret Storage Model

The graph should not become the secret blob store.

Instead, the authoritative runtime should depend on a secret storage adapter,
for example:

```ts
type SecretStore = {
  put(input: { secretId: string; plaintext: string; previousVersion?: number }): Promise<{
    version: number;
    storedAt: Date;
    fingerprint?: string;
    provider?: string;
    externalKeyId?: string;
  }>;
  reveal(secretId: string): Promise<string>;
  clear(secretId: string): Promise<void>;
};
```

The graph stores the durable identity and safe metadata.
The secret store owns the plaintext lifecycle.

That cleanly separates:

- graph relationships and replicated metadata
- sealed secret material and reveal paths

## Validation and Enforcement

The current validation stack already distinguishes:

- scalar and enum value rules
- field-level validation
- runtime/store-dependent validation
- authoritative reconciliation validation

Secret handling should layer onto that existing structure rather than invent a
parallel system.

### Local validation

Local validation should still allow:

- shape checks
- required handle presence
- safe metadata validation

Local validation should not pretend it can validate:

- reveal permissions
- secret storage availability
- authoritative rotation semantics

### Authoritative validation

Authoritative validation should additionally enforce:

- hidden predicates do not appear in outbound sync payloads
- client transactions do not directly modify authority-only secret-backed fields
- write results do not leak secret material through transaction payloads

This is an authority rule, not just a UI rule.

## Replication Rules

The simplest durable rule is:

- secret plaintext never participates in ordinary graph replication

But that still leaves two useful categories of secret-related data:

### Replicated metadata

Safe to send to ordinary clients:

- secret exists or not
- version
- rotation timestamp
- provider
- health/status
- owning relationships

### Authority-only data

Never included in ordinary sync:

- plaintext
- wrapped ciphertext if that would be dangerous to expose
- reveal tokens
- provider credentials
- audit-sensitive internal storage material

This split should be driven by schema field policy, not by ad hoc route code.

## What Changes in the Current Env Var Proof

The env-var flow can become one consumer of the generic secret system.

Today:

- `envVar.secret -> secretHandle`
- the web authority persists plaintext in `secretValues[secretId]`
- `POST /api/secret-fields` performs generic secret creation and rotation logic

Under the proposed model:

- `envVar.secret -> secretHandle`
- env-var name validation remains env-var-specific
- secret write/reveal/rotate semantics move into generic secret field handling
- authority-side plaintext persistence is shared by every secret-backed field,
  not just env vars
- sync behavior is enforced generically by field visibility rules

This keeps env vars as a valid domain type while removing their special status
as the only place where secret semantics exist.

## Suggested Migration Path

### Phase 1: Rename and isolate the proof

- complete the `secretHandle` rename across the current proof
- keep behavior the same
- extract authority-side secret storage behind a reusable adapter interface

This gives the current proof a more general vocabulary without changing
behavior.

### Phase 2: Add schema field policy

- extend field metadata or edge definitions with authority policy
- encode `visibility`, `write`, and `secret` semantics at the field level
- add field authoring helpers such as `defineSecretField(...)`

At this point the schema starts describing the real rules.

### Phase 3: Enforce policy in authoritative writes

- reject direct client transaction attempts against `server-command` or
  `authority-only` fields
- route secret operations through explicit authoritative commands
- keep result payloads limited to safe metadata

This moves enforcement from "best effort app route discipline" to a durable
runtime rule.

### Phase 4: Filter sync by field visibility

- total sync emits only replicable predicates
- incremental sync emits only replicable authoritative changes
- synced clients reconcile against the filtered slice

This makes client safety a property of the sync contract itself.

### Phase 5: Generalize beyond env vars

Once the contract is stable, other types can use the same model:

- API credentials
- workspace integration tokens
- webhook signing secrets
- encrypted connection strings
- any future secret-bearing domain type

## Non-Goals

This proposal does not require the graph package to immediately ship:

- a production-grade secret manager backend
- a full ACL system
- partial query-scoped sync
- browser-side reveal support
- automatic optimistic secret editing

Those can come later.

The minimal useful contract is:

- schema-declared secret-backed fields
- authority-enforced writes
- sync-enforced visibility

## Open Questions

### Should secret handles live in `app:` or `core:`?

`core:` is now the right home. The type itself is graph-generic replicated
metadata, while env-var-specific naming, validation, and mutation contracts stay
in `app:`.

### Should hidden predicates exist in the same authoritative store?

Probably yes for now.

One logical graph model is simpler if the authority keeps the full graph and
sync projects a filtered slice outward. If that later proves too limiting, the
secret store can remain external while the graph still owns the handle and safe
metadata.

### Should reveal be modeled as graph read or command?

It should be treated as an explicit authority action, not an ordinary synced
graph read.

That keeps auditing and policy checks explicit and avoids confusing "the client
can query this field" with "the client is allowed to unseal this secret."

## Recommendation

Adopt the following rule as the durable direction:

Secret values are represented in the graph as schema-declared secret-backed
handles. Plaintext lives only in authority-owned secret storage. Client, server,
and sync all enforce the same field policy:

- schema declares which predicates are secret-backed and whether they replicate
- server authority requires explicit commands for secret operations
- sync projects only the safe replicated metadata slice

That turns the current env-var proof from a useful one-off into a reusable graph
contract.
