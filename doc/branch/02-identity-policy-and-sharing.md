# Identity, Policy, And Sharing Canonical Contract

## Overview

### Mission

Make principals, predicate-level privacy, auth projection, and capability-based
sharing concrete enough that the rest of the platform can build against them.

### Why This Is A Separate Branch

Privacy and capability rules are not UI concerns. They shape sync, query,
module permissions, agent behavior, and any future federation surface.

### In Scope

- graph principal model
- Better Auth boundary and projection into graph principals
- predicate visibility and write policy model
- secret-use authorization rules
- capability and sharing grant contracts
- install-time module permission shape
- single-graph sharing rules and the first federation-safe contracts

### Out Of Scope

- full remote graph query planner
- live cross-graph subscriptions
- rich end-user sharing UX
- broad multi-tenant collaboration product features

### Durable Contracts Owned

- principal identity model
- session claim to principal projection model
- predicate policy metadata
- capability grant model
- module permission request model

### Likely Repo Boundaries

- graph policy contracts
- auth bridge code in `src/web/`
- future authority policy runtime
- module permission descriptors

### Dependencies

- Branch 1 for stable graph entities, writes, and authority enforcement points

### Downstream Consumers

- Branch 3 needs policy-filtered scope semantics
- Branch 4 needs install-time permission contracts
- Branch 6 needs principal-aware workflow and agent permissions
- Branch 7 needs capability-aware UX and session handling

### First Shippable Milestone

Add a first-class principal and predicate-policy model with Better Auth session
projection and policy-filtered graph reads in the current single-graph proof.

### Done Means

- one authenticated principal maps cleanly into graph identity
- policy rules can hide authority-only or owner-only predicates from client
  reads
- write paths can reject mutations that violate policy class
- module installs can declare requested permissions

### First Demo

Sign in, load the same entity as two different principals, and prove that the
visible predicate set changes according to policy.

### What This Unlocks

- scoped sync per principal in Branch 3
- safe module installation in Branch 4
- durable agent permissions in Branch 6
- future sharing and federation work

### Source Anchors

- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/08-vision-overview.md`
- `doc/09-vision-platform-architecture.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`

The remainder of this document is the implementation contract for
identity, authorization policy, capability grants, and first-cut sharing in the
io platform. It is grounded in the current graph authority contracts, the
existing `GraphFieldAuthority` and command policy surfaces, and the roadmap
direction toward Better Auth, principal-scoped sync, and capability-bounded
sharing.

## 1. Purpose

This branch owns the durable meaning of "who is acting," "what they may see or
change," and "how that access may be delegated."

It exists separately from the graph kernel because these rules must be reused by
sync, query, module installation, workflow execution, secret use, and future
cross-graph sharing without being reimplemented in each consumer.

Platform outcomes this branch must deliver:

- a durable principal model inside the graph
- a clean boundary between Better Auth session state and graph identity
- predicate-level policy descriptors that extend the current field authority
  metadata into principal-aware evaluation
- capability and share grant contracts that can be enforced by the authority
  runtime
- install-time permission contracts that downstream module work can depend on

Stability target for this branch:

- `stable`: request principal projection, principal and grant model, module
  permission request model, principal-aware policy evaluation semantics
- `provisional`: Better Auth bridge implementation details, share-surface shape
  for the first single-graph cut
- `future`: remote graph grants, federation handshakes, and cross-graph live
  sharing

## 2. Scope

In scope:

- durable graph principals, roles, memberships, and capability grants
- request-time projection from Better Auth session state into an
  `AuthorizationContext`
- predicate-level read and write policy evaluation
- command capability enforcement
- module permission request and grant contracts
- single-graph sharing grants
- federation-safe grant targets and share-surface references, even if the
  remote runtime is not implemented yet

Out of scope:

- Better Auth credential storage, providers, passkeys, and password flows
- full query planning, scope compilation, and materialized share projections
- rich sharing UX, invitations, notifications, or collaboration product
  workflows
- remote graph transport, remote query execution, and live cross-graph
  subscriptions
- secret plaintext storage or reveal mechanics beyond the authorization
  contract

Assumptions inherited from Branch 1:

- graph entity ids, predicate ids, transactions, and cursors are already stable
- authoritative write validation exposes a write-scope seam
- total and incremental sync already have field-level replication filters
- command execution crosses an explicit authority boundary
- the authority runtime remains the only place that can accept canonical writes

## 3. Core Model

Branch 2 owns a principal-and-grant model on top of the Branch 1 graph kernel.
The graph, not Better Auth, is the durable application model for identity and
authorization.

```ts
type PrincipalKind = "human" | "service" | "agent" | "anonymous" | "remoteGraph";

type PrincipalStatus = "active" | "disabled" | "deleted";

interface GraphPrincipal {
  id: string;
  kind: PrincipalKind;
  status: PrincipalStatus;
  homeGraphId: string;
  personId?: string;
  defaultRoleIds: readonly string[];
  capabilityVersion: number;
}

interface AuthSubjectProjection {
  id: string;
  principalId: string;
  issuer: "better-auth";
  provider: string;
  providerAccountId: string;
  authUserId: string;
  status: "active" | "revoked";
  mirroredAt: string;
}

interface PrincipalRoleBinding {
  id: string;
  principalId: string;
  roleKey: string;
  status: "active" | "revoked";
}
```

```ts
type PolicyAudience = "owner" | "graph-member" | "capability" | "public" | "authority";

type PolicyMutationMode =
  | "owner-edit"
  | "graph-member-edit"
  | "capability"
  | "module-command"
  | "authority";

interface PredicatePolicyDescriptor {
  predicateId: string;
  transportVisibility: "replicated" | "authority-only";
  requiredWriteScope: "client-tx" | "server-command" | "authority-only";
  readAudience: PolicyAudience;
  writeAudience: PolicyMutationMode;
  shareable: boolean;
  requiredCapabilities?: readonly string[];
}

type CapabilityResource =
  | { kind: "predicate-read"; predicateId: string }
  | { kind: "predicate-write"; predicateId: string }
  | { kind: "command-execute"; commandKey: string }
  | { kind: "module-permission"; permissionKey: string }
  | { kind: "share-surface"; surfaceId: string };

type CapabilityTarget =
  | { kind: "principal"; principalId: string }
  | { kind: "graph"; graphId: string }
  | { kind: "bearer"; tokenHash: string };

interface CapabilityGrant {
  id: string;
  resource: CapabilityResource;
  target: CapabilityTarget;
  grantedByPrincipalId: string;
  constraints?: {
    rootEntityId?: string;
    predicateIds?: readonly string[];
    expiresAt?: string;
    delegatedFromGrantId?: string;
  };
  status: "active" | "expired" | "revoked";
  issuedAt: string;
  revokedAt?: string;
}
```

```ts
interface AuthorizationContext {
  graphId: string;
  principalId: string | null;
  principalKind: PrincipalKind | null;
  sessionId: string | null;
  roleKeys: readonly string[];
  capabilityGrantIds: readonly string[];
  capabilityVersion: number;
  policyVersion: number;
}

type ModulePermissionRequest =
  | {
      kind: "predicate-read";
      predicateIds: readonly string[];
      reason: string;
    }
  | {
      kind: "predicate-write";
      predicateIds: readonly string[];
      writeScope: "client-tx" | "server-command" | "authority-only";
      reason: string;
    }
  | {
      kind: "command-execute";
      commandKeys: readonly string[];
      reason: string;
    }
  | {
      kind: "secret-use";
      capabilityKeys: readonly string[];
      reason: string;
    }
  | {
      kind: "share-admin";
      surfaceIds?: readonly string[];
      reason: string;
    };

interface ShareGrant {
  id: string;
  surface: {
    kind: "entity-predicate-slice";
    rootEntityId: string;
    predicateIds: readonly string[];
  };
  capabilityGrantId: string;
  status: "active" | "revoked" | "expired";
}
```

Entity and concept responsibilities:

- `GraphPrincipal` is the durable actor record used by all graph policy
  decisions.
- `AuthSubjectProjection` is a mirrored lookup record from Better Auth into the
  graph. It is not the source of truth for credentials.
- `PrincipalRoleBinding` groups reusable permissions without hard-coding them
  into the session layer.
- `PredicatePolicyDescriptor` is the schema-owned policy contract for one
  predicate.
- `CapabilityGrant` is the durable delegation record for extra rights beyond
  default owner or member rules.
- `AuthorizationContext` is request-local derived state. It is never accepted
  from the client as authoritative input.
- `ModulePermissionRequest` is the install-time declaration surface that Branch
  4 consumes.
- `ShareGrant` is a narrowed sharing wrapper over a capability grant.

Identifier rules:

- `principalId`, `capabilityGrantId`, and `shareGrantId` are stable graph node
  ids.
- `provider + providerAccountId` must map to at most one active
  `AuthSubjectProjection` per graph.
- `capabilityVersion` is monotonic for each principal and changes whenever a
  role binding or capability grant affecting that principal changes.
- `policyVersion` is monotonic for the graph and changes whenever predicate
  policy or share-surface contracts change.

Lifecycle rules:

- principals move from `active` to `disabled` to `deleted`; deleted principals
  are never reassigned
- role bindings and grants are append-oriented and revoke by status transition,
  not by silent deletion
- session projection may become stale, but the underlying principal and grant
  records remain authoritative

Relationship rules:

- one Better Auth user may project to one graph principal in the owning graph
- one principal may have multiple auth subject projections
- one principal may bind to many roles and receive many grants
- one share grant must reference exactly one capability grant
- module permissions never create ad hoc hidden rights; they lower to explicit
  capability grants or role bindings

## 4. Public Contract Surface

### Error Envelope

All public authorization surfaces return a structured error envelope on hard
failure.

```ts
type PolicyErrorCode =
  | "auth.unauthenticated"
  | "auth.principal_missing"
  | "policy.read.forbidden"
  | "policy.write.forbidden"
  | "policy.command.forbidden"
  | "policy.stale_context"
  | "grant.invalid"
  | "share.surface_invalid";

interface PolicyError {
  code: PolicyErrorCode;
  message: string;
  retryable: boolean;
  refreshRequired?: boolean;
}
```

### Contract Table

| Name                             | Purpose                                                                            | Caller                                        | Callee                                         | Inputs                                                        | Outputs                               | Failure shape                                                            | Stability                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `GraphFieldAuthority`            | Low-level replication and write-scope metadata already used by validation and sync | schema authors, authority runtime             | graph runtime                                  | field definition                                              | authored metadata                     | validation error if malformed                                            | `stable`                                                                   |
| `PredicatePolicyDescriptor`      | Principal-aware read, write, and sharing rule for a predicate                      | schema authors, module authors                | policy evaluator                               | predicate id, policy audiences, capabilities                  | descriptor                            | `policy.write.forbidden` or `policy.read.forbidden` when violated        | `provisional`                                                              |
| `AuthorizationContext`           | Request-local resolved actor and version snapshot                                  | auth bridge, authority runtime                | policy evaluator, sync, commands               | Better Auth session plus graph projection                     | principal id, roles, grants, versions | `auth.unauthenticated`, `auth.principal_missing`, `policy.stale_context` | `stable`                                                                   |
| `projectSessionToPrincipal(...)` | Map a Better Auth session to graph identity                                        | Worker auth bridge                            | Better Auth store plus graph projection lookup | request session, graph id                                     | `AuthorizationContext`                | `auth.unauthenticated`, `auth.principal_missing`                         | `stable`                                                                   |
| `authorizeRead(...)`             | Decide whether a predicate may materialize for a principal                         | query and sync paths                          | policy evaluator                               | `AuthorizationContext`, subject id, predicate id              | allow or deny                         | `policy.read.forbidden` on explicit reads; sync omits denied predicates  | `stable`                                                                   |
| `authorizeWrite(...)`            | Decide whether a mutation may touch a predicate                                    | write validator, command executor             | policy evaluator                               | `AuthorizationContext`, subject id, predicate id, write scope | allow or deny                         | `policy.write.forbidden`                                                 | `stable`                                                                   |
| `authorizeCommand(...)`          | Enforce command capability requirements                                            | command executor                              | policy evaluator                               | `AuthorizationContext`, command key, touched predicates       | allow or deny                         | `policy.command.forbidden`                                               | `stable`                                                                   |
| `CapabilityGrant`                | Durable delegated permission                                                       | share service, install flow, workflow runtime | authority persistence                          | resource, target, constraints                                 | stored grant id                       | `grant.invalid`                                                          | `stable` for principal targets, `provisional` for bearer and graph targets |
| `ModulePermissionRequest`        | Declared install-time permission request                                           | module manifest loader                        | module installer and policy runtime            | request union                                                 | approval or denial                    | `policy.command.forbidden`, `grant.invalid`                              | `stable`                                                                   |
| `ShareGrant`                     | Narrow grant for shareable entity predicate slices                                 | share service, future federation bridge       | authority persistence plus policy runtime      | surface selector, grant target                                | stored share grant id                 | `share.surface_invalid`, `grant.invalid`                                 | `provisional`                                                              |

Contract rules:

- `projectSessionToPrincipal(...)` must never trust a client-supplied
  `principalId`
- the stable projection input is the `graphId`, `sessionId`, and auth-subject
  tuple (`issuer`, `provider`, `providerAccountId`, `authUserId`); Better Auth
  request parsing remains a provisional Worker-bridge detail
- `authorizeRead(...)` is applied after transport visibility filtering, not
  instead of it
- `authorizeWrite(...)` must satisfy both principal-aware policy and the
  existing Branch 1 write-scope check
- `authorizeCommand(...)` uses command policy plus predicate policy; either may
  deny
- grant creation and revocation are authoritative writes and therefore reuse the
  normal Branch 1 transaction guarantees

## 5. Runtime Architecture

The runtime boundary is intentionally split into three layers.

### Better Auth boundary

Better Auth owns sessions, providers, passkeys, passwords, verification flows,
and auth plugins. It runs against a dedicated auth store that is separate from
graph storage.

### Auth bridge

The Worker request layer owns session verification and projection into an
`AuthorizationContext`.

Responsibilities:

- read the Better Auth session from the incoming request
- resolve the current graph principal through `AuthSubjectProjection`
- repair or create a missing projection idempotently on first authenticated use
- attach `capabilityVersion` and `policyVersion` to the request context
- reject stale or invalid share bearer tokens before they reach graph reads

### Authority policy runtime

The authoritative graph runtime owns final authorization decisions.

Responsibilities:

- evaluate predicate policy during sync, query, and command execution
- enforce write rules before a Branch 1 transaction is accepted
- resolve grants, roles, and share surfaces against the request context
- publish policy-relevant invalidation when versions change

Process and trust boundaries:

- browser or TUI clients only hold policy-filtered replicated state
- Worker request handlers are trusted to produce `AuthorizationContext`, but not
  to bypass authority decisions
- Durable Object authority remains the authoritative write point
- future remote-graph access must terminate in the same policy evaluator, not a
  separate bypass path

Authoritative versus derived state:

- principals, roles, grants, and share grants are authoritative
- Better Auth session state is authoritative for authentication, not for graph
  authorization
- `AuthorizationContext` and any session capability snapshot are derived
- share projections and scoped sync results are derived and rebuildable

## 6. Storage Model

This branch does not own a separate persistence engine. It owns canonical
records that live in two existing storage domains.

### Authoritative records

Stored in the Branch 1 graph tables:

- principal entities
- auth subject projection entities
- role bindings
- capability grants
- share grants
- module permission grants or approvals
- graph-level `policyVersion`

Stored in the Better Auth store:

- sessions
- provider accounts
- passwords, passkeys, verification tokens, and auth plugin state

### Retained history versus current state

- current principal, role, and grant status are authoritative current-state
  facts in the graph
- grant issuance and revocation remain reconstructable from retained graph
  transaction history
- Better Auth keeps its own session history independently of graph history

### Derived state

Derived and rebuildable:

- lookup index from auth subject to principal id
- request-local `AuthorizationContext`
- capability snapshots embedded in sessions or cached near the Worker
- share projections and principal-scoped sync scopes

Not owned here:

- secret plaintext storage
- blob storage
- query indexes and outbound projection tables

### Rebuild and migration rules

- if the auth-subject lookup cache is lost, it must rebuild from graph records
  plus the Better Auth store
- if session capability snapshots are stale, the request path refreshes from
  current graph state before serving protected reads
- policy model changes must be additive and versioned; older sessions must fail
  closed when they cannot satisfy the current `policyVersion`
- bearer share tokens are stored only as token hashes; plaintext bearer tokens
  are write-only at issuance time

## 7. Integration Points

| Branch                                    | Dependency direction         | Imported contracts                                                                                 | Exported contracts                                                | What may be mocked                                               | What must be stable                                              |
| ----------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Branch 1: Graph Kernel And Authority      | Branch 2 depends on Branch 1 | stable ids, transaction application, write scopes, sync filtering seams, command dispatch boundary | principal-aware policy evaluation, grant records, policy versions | allow-all principal model for early prototypes                   | write-scope enforcement hook and filtered sync hook              |
| Branch 3: Sync Query And Projections      | Branch 3 depends on Branch 2 | `AuthorizationContext`, predicate policy, share-surface ids, policy versions                       | principal-scoped visibility semantics for scoped sync             | temporary whole-graph reads filtered by current field visibility | stable deny-by-default read contract and versioned policy filter |
| Branch 4: Module Runtime And Installation | Branch 4 depends on Branch 2 | `ModulePermissionRequest`, grant creation, command authorization                                   | install-time approval model and durable permission grant shape    | built-in module allowlist                                        | manifest permission keys and revocation rules                    |
| Branch 5: Blob Ingestion And Media        | mutual dependency            | secret-use capabilities, command authorization, shareability rules                                 | blob and secret command keys referenced by grants                 | local operator-only secrets                                      | capability names for reveal, rotate, and ingest flows            |
| Branch 6: Workflow And Agent Runtime      | Branch 6 depends on Branch 2 | agent and service principal kinds, command authorization, share grants                             | durable agent permission model                                    | operator-run workflows under one principal                       | service and agent principal semantics                            |
| Branch 7: Web And Operator Surfaces       | Branch 7 depends on Branch 2 | auth bridge contract, principal summary, share grant contract                                      | capability-aware UX requirements                                  | developer-only sign-in and single-user mode                      | request context contract and explicit forbidden behavior         |

Integration rules:

- Branch 2 never defines query plans; it only defines whether a requested read
  is allowed
- Branch 2 never installs modules; it only defines what permissions must be
  requested and granted
- Branch 2 never stores secret plaintext; it only defines who may invoke secret
  commands

## 8. Main Flows

### 1. Sign-In And Principal Resolution

Initiator: browser or operator request carrying a Better Auth session.

Components involved: Better Auth handler, Worker auth bridge, principal
projection lookup, authority runtime.

Contract boundaries crossed:

- Better Auth session verification
- auth-subject to principal projection
- request attachment of `AuthorizationContext`

Authoritative write point:

- only when a missing auth projection must be repaired or created

Failure and fallback behavior:

- no valid session yields an anonymous context
- an authenticated session with no repairable principal mapping fails with
  `auth.principal_missing`
- a stale capability or policy version triggers refresh before protected reads

### 2. Policy-Filtered Read Or Sync

Initiator: synced client, query route, or operator view.

Components involved: auth bridge, policy evaluator, Branch 1 store, later
Branch 3 scoped sync.

Contract boundaries crossed:

- request context resolution
- predicate transport visibility filter
- principal-aware `authorizeRead(...)`

Authoritative write point:

- none for the read itself

Failure and fallback behavior:

- denied predicates are omitted from sync payloads
- explicit direct reads over denied predicates return `policy.read.forbidden`
- stale request context refreshes once, then fails closed

### 3. Authorized Mutation Or Command Execution

Initiator: client transaction flush, server command, workflow step, or agent
action.

Components involved: local preflight, authority validator, command executor,
policy evaluator, Branch 1 transaction commit.

Contract boundaries crossed:

- client intent to authority command or transaction
- write-scope validation
- principal-aware `authorizeWrite(...)` or `authorizeCommand(...)`

Authoritative write point:

- Branch 1 transaction commit inside the authority runtime

Failure and fallback behavior:

- a policy violation rejects the entire mutation
- no partial graph state or partial grant state may persist
- retry is only valid after a real permission change, not after blind replay

### 4. Module Installation Permission Grant

Initiator: operator installs or upgrades a module.

Components involved: Branch 4 manifest loader, Branch 2 permission evaluator,
authority runtime.

Contract boundaries crossed:

- module manifest `permissions`
- approval or denial of requested permissions
- durable grant or role binding creation

Authoritative write point:

- the same authority transaction that records the install or approval

Failure and fallback behavior:

- undeclared permission use is always denied
- denied permissions abort installation rather than silently degrading
- a later revocation invalidates future module actions without mutating past
  data

### 5. Single-Graph Share Grant

Initiator: owner or authorized operator shares a specific entity predicate
slice.

Components involved: share service, capability grant creation, optional bearer
token issuer, policy evaluator.

Contract boundaries crossed:

- share request
- share-surface validation
- grant issuance to a principal or bearer target

Authoritative write point:

- capability grant and share grant commit

Failure and fallback behavior:

- non-shareable predicates fail with `share.surface_invalid`
- revoked or expired grants immediately block future reads
- branch-local projection caches may lag, but the authority decision must not
  lag

### 6. Federation-Safe Remote Grant Handshake

Initiator: future remote graph or remote principal requests access.

Components involved: grant verifier, named share-surface resolver, remote trust
boundary.

Contract boundaries crossed:

- target graph validation
- share-surface lookup
- capability grant enforcement

Authoritative write point:

- remote-target capability grant issuance or revocation

Failure and fallback behavior:

- no raw remote predicate traversal is allowed
- unknown target graphs fail closed
- remote access remains behind named surfaces until Branch 3 and federation work
  exist

## 9. Invariants And Failure Handling

Invariants:

- the authority runtime is the only source of final authorization decisions
- a client may never choose its own `principalId`
- read permission is the intersection of transport visibility, predicate policy,
  and capability grants
- write permission is the intersection of Branch 1 write scope, predicate
  policy, and command capability policy
- hidden predicates must not leak through sync, direct reads, command outputs,
  logs, or derived client caches
- revocation takes effect on the next authority decision even if a cached
  session snapshot is stale
- share grants may only expose explicitly shareable surfaces
- module code may exercise only permissions that were declared and granted
- principal ids, grant ids, and auth-subject mappings are never recycled

Important failure modes:

| What fails                                               | What must not corrupt               | Retry or fallback                                                                         | Observability                                            |
| -------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Better Auth store unavailable                            | graph principal or grant state      | serve only anonymous or cached public surfaces; deny protected actions                    | auth bridge latency and failure counters                 |
| Missing or stale auth projection                         | existing graph state                | idempotent repair once, then fail with `auth.principal_missing` or `policy.stale_context` | projection repair attempts and stale-version metrics     |
| Policy evaluator rejects write                           | graph snapshot and retained history | no partial commit; caller may retry only after permission changes                         | deny audit with principal, predicate, command, and scope |
| Share grant expired or revoked                           | authoritative share records         | reject access immediately; rebuild caches asynchronously                                  | grant issuance, use, expiry, and revocation events       |
| Unknown policy descriptor or malformed module permission | grant graph and module state        | fail closed; abort install or read path                                                   | policy schema validation and install diagnostics         |

## 10. Security And Policy Considerations

- Better Auth and graph authorization are separate trust domains. Better Auth
  proves authentication; the graph proves authorization.
- Browser-visible state is limited to policy-filtered replicated data. Hidden
  predicates are absent, not masked.
- Secret-backed fields require explicit command paths and capabilities such as
  reveal or rotate. Branch 2 authorizes those commands; Branch 5 owns secret
  storage and reveal mechanics.
- Share bearer tokens are bearer credentials and therefore must be hash-stored,
  revocable, scope-limited, and auditable.
- Module installation is not trusted by default. Modules declare permission
  requests up front and are denied any undeclared access.
- Service and agent principals are explicit first-class actors, not overloaded
  human sessions.
- Federation must reuse the same grant model. Remote graphs only receive named,
  auditable surfaces, never implicit raw graph traversal rights.

## 11. Implementation Slices

1. Principal types and auth projection. Goal: add graph principal, auth subject
   projection, role binding, and `AuthorizationContext` contracts. Prerequisite
   contracts: Branch 1 ids and authoritative writes. What it proves: one Better
   Auth session maps cleanly to one graph principal. What it postpones:
   capability grants and sharing.

2. Predicate policy descriptors and authority evaluation. Goal: extend the
   current field authority model with principal-aware read and write rules plus
   `policyVersion`. Prerequisite contracts: current `GraphFieldAuthority`,
   sync filtering, and command policy hooks. What it proves: the same entity can
   materialize differently for two principals. What it postpones: scoped sync
   planning and remote federation.

3. Principal-filtered sync and direct read enforcement. Goal: apply
   `authorizeRead(...)` on top of existing replicated sync behavior. Prerequisite
   contracts: slices 1 and 2. What it proves: single-graph proof with
   principal-aware visibility. What it postpones: Branch 3 query and projection
   optimization.

4. Capability grants and module permissions. Goal: persist grants, authorize
   commands, and define `ModulePermissionRequest` plus approval flow.
   Prerequisite contracts: slices 1 and 2, plus Branch 4 manifest shape.
   What it proves: install-time permissions and delegated rights. What it
   postpones: polished sharing UX.

5. Single-graph share grants. Goal: issue revocable predicate-slice grants to a
   principal or bearer token. Prerequisite contracts: slices 2 through 4 and a
   minimal share-surface selector. What it proves: auditable first-cut sharing
   without federation. What it postpones: remote graph transport and live
   shared subscriptions.

## 12. Open Questions

- Should `AuthSubjectProjection` live purely in graph storage, or should a
  Worker-local SQLite cache exist for cold-start lookup speed?
- Is `personId` on `GraphPrincipal` mandatory for human principals, or can some
  principals remain non-person actors permanently?
- How much policy variability should be allowed beyond schema-authored
  `PredicatePolicyDescriptor` defaults before the model becomes too dynamic to
  reason about?
- Should bearer share grants require an expiry by default, or is revocation-only
  sufficient for the first cut?
- What is the smallest role model that still supports teams, agents, modules,
  and federation without duplicating grant records everywhere?

## 13. Recommended First Code Targets

- `src/graph/runtime/schema.ts`: keep `GraphFieldAuthority` stable and add the
  principal-aware policy descriptor surface beside it rather than inside route
  code
- `src/graph/runtime/contracts.ts`: extend command policy contracts so command
  authorization and touched predicates share one durable vocabulary
- `src/graph/runtime/sync/replication.ts`: add principal-aware filtering on top
  of the existing replication visibility rules
- `src/web/lib/authority.ts`: introduce request-bound `AuthorizationContext`
  evaluation and final read or write enforcement
- `src/web/lib/auth-bridge.ts`: add the Better Auth session-to-principal
  projection seam
- `src/graph/modules/core/`: add core principal, role, capability, and share
  graph types that downstream branches can reference
