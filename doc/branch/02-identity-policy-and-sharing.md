---
name: Identity, policy, and sharing branch
description: "Canonical cross-package contract for Branch 2 identity, authorization, capability, and sharing work."
last_updated: 2026-04-07
---

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
- graph-backed admission policy and first-use provisioning model
- capability grant model
- module permission request model

### Likely Repo Boundaries

- graph policy contracts
- auth bridge code in `lib/app/src/web/`
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

- `doc/index.md`
- `doc/vision.md`
- `lib/graph-authority/doc/authority-stack.md`
- `lib/graph-authority/doc/authorization.md`
- `lib/graph-authority/doc/replication.md`
- `lib/app/doc/auth-store.md`
- `lib/app/doc/roadmap.md`
- `lib/graph-module/doc/module-stack.md`

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

type AdmissionBootstrapMode = "manual" | "first-user";

type AdmissionSignupPolicy = "closed" | "open";

interface AdmissionProvisioning {
  roleKeys: readonly string[];
}

interface AdmissionPolicy {
  graphId: string;
  bootstrapMode: AdmissionBootstrapMode;
  signupPolicy: AdmissionSignupPolicy;
  allowedEmailDomains: readonly string[];
  firstUserProvisioning: AdmissionProvisioning;
  signupProvisioning: AdmissionProvisioning;
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

Schema authors attach the audience, sharing, and capability metadata under
`GraphFieldAuthority.policy`; the shared graph runtime resolves the full
`PredicatePolicyDescriptor` by combining that metadata with the field id,
transport visibility, and required write scope.

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

Current first-cut target boundary:

- `principal` targets are stable and lower directly into the current
  `AuthorizationContext.capabilityGrantIds` projection
- `graph` and `bearer` targets are durable graph vocabulary now, but remain
  provisional until later sharing and federation work makes them live
  authorization inputs
- the current bearer-share proof is intentionally narrower than principal
  sharing: issuance returns plaintext once, the durable graph stores only a
  `sha256:` bearer token hash, lookups reject missing, expired, or revoked
  tokens before protected reads continue, and the current Worker bridge only
  lowers bearer shares into anonymous shared-read `GET /api/sync` requests
- only principal-target grants participate in `capabilityVersion`
  invalidation in the current proof

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

type ModulePermissionKey = string;

type ModulePermissionRequestBase = {
  key: ModulePermissionKey;
  reason: string;
  required: boolean;
};

type ModulePermissionRequest =
  | (ModulePermissionRequestBase & {
      kind: "predicate-read";
      predicateIds: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      kind: "predicate-write";
      predicateIds: readonly string[];
      writeScope: "client-tx" | "server-command" | "authority-only";
    })
  | (ModulePermissionRequestBase & {
      kind: "command-execute";
      commandKeys: readonly string[];
      touchesPredicates?: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      kind: "secret-use";
      capabilityKeys: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      kind: "share-admin";
      surfaceIds?: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      kind: "external-service";
      serviceKeys: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      kind: "background-job";
      jobKeys: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      kind: "blob-class";
      blobClassKeys: readonly string[];
    });

type ModulePermissionGrantResource = Extract<CapabilityResource, { kind: "module-permission" }>;

type ModulePermissionLowering =
  | {
      kind: "capability-grant";
      grant: CapabilityGrant & {
        resource: ModulePermissionGrantResource;
      };
    }
  | {
      kind: "role-binding";
      binding: PrincipalRoleBinding;
    };

type ModulePermissionApprovalRecord =
  | {
      moduleId: string;
      permissionKey: ModulePermissionKey;
      request: ModulePermissionRequest;
      status: "approved";
      decidedAt: string;
      decidedByPrincipalId: string;
      note?: string;
      lowerings: readonly [ModulePermissionLowering, ...ModulePermissionLowering[]];
    }
  | {
      moduleId: string;
      permissionKey: ModulePermissionKey;
      request: ModulePermissionRequest;
      status: "denied";
      decidedAt: string;
      decidedByPrincipalId: string;
      note?: string;
      lowerings: readonly [];
    }
  | {
      moduleId: string;
      permissionKey: ModulePermissionKey;
      request: ModulePermissionRequest;
      status: "revoked";
      decidedAt: string;
      decidedByPrincipalId: string;
      note?: string;
      revokedAt: string;
      revokedByPrincipalId: string;
      revocationNote?: string;
      lowerings: readonly [ModulePermissionLowering, ...ModulePermissionLowering[]];
    };

interface ShareGrant {
  id: string;
  surface: {
    surfaceId: string;
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
- `AdmissionPolicy` is the graph-owned rule set that decides whether an
  authenticated subject may self-admit into the current graph and which role
  keys first-use provisioning grants.
- `PredicatePolicyDescriptor` is the schema-owned policy contract for one
  predicate.
- `CapabilityGrant` is the durable delegation record for extra rights beyond
  default owner or member rules.
- `AuthorizationContext` is request-local derived state. It is never accepted
  from the client as authoritative input.
- `ModulePermissionRequest` is the canonical manifest-facing install-time
  declaration surface. Branch 2 evaluates the union member and records any
  resulting approval or revocation against the stable `key`.
- `ModulePermissionApprovalRecord` is the durable install-time review result for
  one declared permission key. It persists approval, denial, and revocation
  without creating ambient hidden rights.
- `ShareGrant` is a narrowed sharing wrapper over a capability grant and the
  explicit share-surface selector it exposes.

Identifier rules:

- `principalId`, `capabilityGrantId`, and `shareGrantId` are stable graph node
  ids.
- `ShareGrant.surface.surfaceId` is the durable share-surface reference lowered
  through `CapabilityGrant.resource.surfaceId` in the first cut.
- `provider + providerAccountId` must map to at most one active
  `AuthSubjectProjection` per graph.
- `capabilityVersion` starts at `0` when a principal is created.
- `capabilityVersion` is monotonic for each principal and increments once per
  committed authority transaction that creates, reassigns, revokes, expires, or
  retracts a `PrincipalRoleBinding` or principal-target `CapabilityGrant`
  affecting that principal.
- graph-target and bearer-target grants publish durable records now, but they do
  not invalidate a principal `capabilityVersion` until those target kinds
  become live inputs to principal projection.
- `policyVersion` is the authority-served policy snapshot version for one graph.
  In the current single-graph web proof, the authoritative source is the
  compiled contract snapshot in `lib/app/src/web/lib/policy-version.ts`, not a graph
  row or client cache.
- the Worker auth bridge and the authority runtime must import that same
  `policyVersion` source so request projection and stale-context checks compare
  against one compiled policy contract.
- derive `policyVersion` from one explicit compiled path that includes:
  - resolved predicate policy descriptors for the shipped web graph, so
    authored policy changes automatically change the served version
  - an explicit fallback-policy contract epoch for predicates without authored
    policy metadata
  - an explicit share-surface contract epoch for validation or lowering changes
  - an explicit authority policy-evaluator epoch for
    `authorizeRead(...)`, `authorizeWrite(...)`, `authorizeCommand(...)`, or
    scoped-sync `policyFilterVersion` semantics
- do not increment `policyVersion` for ordinary graph-content writes, Better
  Auth session churn, principal or role mutations, capability grant mutations,
  or other changes already covered by `capabilityVersion` or normal data sync.
- current proof behavior:
  - the Worker fetches the current served value through the Durable Object's
    internal `GET /_internal/policy-version` seam before it forwards each graph
    API request
  - authority-owned read, write, command, and scoped-sync entrypoints reject
    mismatched request contexts with `policy.stale_context`
  - a fresh request built after that lookup succeeds without any separate
    invalidation channel
- proof anchors:
  - `lib/app/src/web/lib/policy-version.test.ts`
  - `lib/app/src/web/worker/index.test.ts`
  - `lib/app/src/web/lib/authority.test.ts`
  - `lib/app/src/web/lib/graph-authority-do.test.ts`

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

| Name                             | Purpose                                                                            | Caller                                        | Callee                                         | Inputs                                                              | Outputs                                       | Failure shape                                                            | Stability                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GraphFieldAuthority`            | Low-level replication and write-scope metadata already used by validation and sync | schema authors, authority runtime             | graph runtime                                  | field definition                                                    | authored metadata                             | validation error if malformed                                            | `stable`                                                                                                                           |
| `PredicatePolicyDescriptor`      | Principal-aware read, write, and sharing rule for a predicate                      | schema authors, module authors                | policy evaluator                               | predicate id, policy audiences, capabilities                        | descriptor                                    | `policy.write.forbidden` or `policy.read.forbidden` when violated        | `provisional`                                                                                                                      |
| `AuthorizationContext`           | Request-local resolved actor and version snapshot                                  | auth bridge, authority runtime                | policy evaluator, sync, commands               | Better Auth session plus graph projection                           | principal id, roles, grants, versions         | `auth.unauthenticated`, `auth.principal_missing`, `policy.stale_context` | `stable`                                                                                                                           |
| `WebPrincipalBootstrapPayload`   | Minimal browser bootstrap contract for principal summary consumers                 | Worker bootstrap route, app shell, tools      | web shell or operator bootstrap consumer       | request session plus graph principal projection                     | `WebPrincipalSession`, optional principal     | signed-out, expired, or bootstrap transport failure                      | `stable` for session and principal summary only                                                                                    |
| `AdmissionPolicy`                | Graph-owned bootstrap, signup, domain-gate, and first-use provisioning contract    | auth bridge, authority runtime, operator UX   | authority persistence plus admission evaluator | graph id, bootstrap mode, signup mode, allowed domains, role grants | durable policy snapshot                       | admission denied or policy validation error                              | `stable` for bootstrap, signup, domain, and provisioning shape                                                                     |
| `projectSessionToPrincipal(...)` | Map a Better Auth session to graph identity                                        | Worker auth bridge                            | Better Auth store plus graph projection lookup | request session, graph id                                           | `AuthorizationContext`                        | `auth.unauthenticated`, `auth.principal_missing`                         | `stable`                                                                                                                           |
| `authorizeRead(...)`             | Decide whether a predicate may materialize for a principal                         | query and sync paths                          | policy evaluator                               | `AuthorizationContext`, subject id, predicate id                    | allow or deny                                 | `policy.read.forbidden` on explicit reads; sync omits denied predicates  | `stable`                                                                                                                           |
| `authorizeWrite(...)`            | Decide whether a mutation may touch a predicate                                    | write validator, command executor             | policy evaluator                               | `AuthorizationContext`, subject id, predicate id, write scope       | allow or deny                                 | `policy.write.forbidden`                                                 | `stable`                                                                                                                           |
| `authorizeCommand(...)`          | Enforce command capability requirements                                            | command executor                              | policy evaluator                               | `AuthorizationContext`, command key, touched predicates             | allow or deny                                 | `policy.command.forbidden`                                               | `stable`                                                                                                                           |
| `CapabilityGrant`                | Durable delegated permission                                                       | share service, install flow, workflow runtime | authority persistence                          | resource, target, constraints                                       | stored grant id                               | `grant.invalid`                                                          | `stable` for principal targets, `provisional` for bearer and graph targets                                                         |
| `ModulePermissionRequest`        | Canonical manifest-facing install-time permission request                          | module manifest loader                        | module installer and policy runtime            | stable `key`, `required`, `reason`, and kind-specific target fields | approval or denial keyed by `permissionKey`   | `policy.command.forbidden`, `grant.invalid`                              | `stable` for key space plus predicate, command, and secret kinds; `provisional` for `share-admin` details and host-expansion kinds |
| `ModulePermissionApprovalRecord` | Durable reviewed outcome for one declared module permission                        | module installer, install review UI           | authority persistence plus Branch 2 lowering   | `moduleId`, `permissionKey`, reviewed `request`, and lowerings      | stored approval, denial, or revocation record | `policy.command.forbidden`, `grant.invalid`                              | `stable` for approval, denial, revocation, and explicit lowering references                                                        |
| `ShareGrant`                     | Narrow grant for shareable entity predicate slices                                 | share service, future federation bridge       | authority persistence plus policy runtime      | surface selector, grant target                                      | stored share grant id                         | `share.surface_invalid`, `grant.invalid`                                 | `provisional`                                                                                                                      |

Contract rules:

- `projectSessionToPrincipal(...)` must never trust a client-supplied
  `principalId`
- `WebPrincipalSession` is the stable browser-visible shell identity state:
  `booting`, `signed-out`, `ready`, or `expired`
- `WebPrincipalBootstrapPayload` is the stable minimum bootstrap payload for the
  current proof: `{ session, principal }`
- `principal` in that bootstrap payload must be `null` unless
  `session.authState = "ready"`
- broader app-shell payloads may add routes, module contributions, or richer
  account-profile fields, but they must not redefine the stable
  `WebPrincipalSession` or `WebPrincipalSummary` fields
- `WebPrincipalSummary.access` is authority-owned derived state published so
  shells do not reconstruct authority, graph-member, or delegated-share access
  from raw role and grant records on their own
- `WebPrincipalSummary` intentionally omits account-management profile data,
  raw share-surface selectors, and grant metadata beyond stable ids; those stay
  outside the minimum bootstrap contract for now
- `AdmissionPolicy` is graph-owned authorization data. Better Auth runtime
  config such as secrets, provider callbacks, database bindings, and route
  mounts remain outside this contract even when the Worker composes both during
  request handling.
- `allowedEmailDomains` stores normalized domain strings only. It never stores
  full email addresses or provider-owned account metadata.
- `firstUserProvisioning` applies exactly once when
  `bootstrapMode = "first-user"` and the graph has no admitted human
  principal; `signupProvisioning` applies to later self-signups when
  `signupPolicy = "open"` and any domain gate passes.
- first authenticated use in the current single-graph proof follows one of five
  durable paths:
  - first-user bootstrap: when `bootstrapMode = "first-user"` and no admitted
    human principal exists, the authority creates the principal, creates the
    exact auth-subject projection, and records eligibility for a later explicit
    role-binding step using `firstUserProvisioning.roleKeys`
  - explicit approval allowlist: when an active `core:admissionApproval`
    matches the normalized email, the authority admits the principal even if
    `signupPolicy = "closed"`
  - domain-gated open signup: when `signupPolicy = "open"` and
    `allowedEmailDomains` is empty or contains the normalized email domain, the
    authority creates the principal and records eligibility for a later explicit
    role-binding step using `signupProvisioning.roleKeys`
  - deny: when none of those gates admits the request, first authenticated use
    fails closed with `auth.principal_missing` and no principal, projection, or
    role binding is created
  - explicit initial role binding: once a principal is admitted, a separate
    authority-owned workflow creates the durable `PrincipalRoleBinding`
    records; admission alone never grants graph membership or operator rights
- the stable projection input is the `graphId`, `sessionId`, and auth-subject
  tuple (`issuer`, `provider`, `providerAccountId`, `authUserId`); Better Auth
  request parsing remains a provisional Worker-bridge detail
- `authorizeRead(...)` is applied after transport visibility filtering, not
  instead of it
- `authorizeWrite(...)` must satisfy both principal-aware policy and the
  existing Branch 1 write-scope check
- `authorizeCommand(...)` uses command policy plus predicate policy; either may
  deny
- `ModulePermissionRequest` is published once from
  `lib/graph-authority/src/contracts.ts`; Branch 2 does not define a second
  install request shape
- `ModulePermissionRequest.key` is the stable permission identifier used for
  install plans, durable grants, approval UI state, and revocation
- approval lowers every `ModulePermissionRequest` into the same grant key space
  by recording `CapabilityResource = { kind: "module-permission",
permissionKey: request.key }`; the union member determines what Branch 2
  evaluates before that grant is issued
- approved `ModulePermissionApprovalRecord`s must reference at least one
  explicit `module-permission` capability grant or reusable role binding
- denied `ModulePermissionApprovalRecord`s must keep `lowerings = []` so the
  reviewed request remains durable without introducing hidden rights
- revoking a module permission must revoke or deactivate the referenced grants
  or role bindings and update the durable review record; revocation must not
  silently delete the approval history
- `predicate-read`, `predicate-write`, `command-execute`, and `secret-use`
  are the stable Branch 2 authorization-backed kinds
- `share-admin` already occupies the same `permissionKey` space, but its
  `surfaceIds` detail remains provisional with the share-surface contract
- `external-service`, `background-job`, and `blob-class` are provisional
  manifest kinds that already occupy the same `permissionKey` space, but their
  detailed approval semantics stay owned by later host and media branches
- `command-execute.touchesPredicates`, when present, is review metadata that
  must summarize rather than replace the authoritative
  `GraphCommandSpec.policy.touchesPredicates` surface
- first-cut `ShareGrant.surface` records are always
  `kind = "entity-predicate-slice"` with one explicit `surfaceId`, one
  `rootEntityId`, and one explicit predicate set
- first-cut share issuance must reject empty, duplicate, malformed, or
  non-shareable predicate selections with `share.surface_invalid`
- first-cut share lowering must keep
  `CapabilityGrant.resource = { kind: "share-surface", surfaceId }` aligned
  with `ShareGrant.surface.surfaceId`, and
  `CapabilityGrant.constraints.{ rootEntityId, predicateIds }` must mirror the
  same selector exactly rather than broadening it
- authority-owned write and command paths must fail closed with
  `policy.stale_context` when the request-bound `AuthorizationContext` carries
  an older `policyVersion` than the authority currently serves
- until every current web-graph predicate publishes an explicit
  `PredicatePolicyDescriptor`, the current web authority proof may lower
  predicates without schema-authored policy metadata to an authority-only
  descriptor so deny behavior stays explicit and Branch 3 / Branch 7 can target
  one contract instead of route-local fallbacks
- grant creation and revocation are authoritative writes and therefore reuse the
  normal Branch 1 transaction guarantees

Current Branch 2 read baseline in the single-graph proof:

- total and incremental sync apply transport visibility first, then omit
  predicates the current principal is not allowed to read; the sync cursor may
  still advance with fewer or zero visible operations
- principal-target `share-surface` grants plus active `ShareGrant` records may
  additionally expose one explicit shareable replicated predicate slice to a
  delegated principal through those same sync and direct-read surfaces
- when delegated share visibility changes, incremental sync falls back to total
  recovery so previously hidden data can materialize and revoked data can clear
  without leaving stale client-visible state behind
- predicates outside the granted slice, non-shareable predicates, and revoked
  shared predicates remain omitted from sync and fail explicit direct reads with
  `policy.read.forbidden`
- the end-to-end proof for those read-path outcomes lives in
  `lib/app/src/web/lib/authority.test.ts` and `lib/app/src/web/lib/graph-authority-do.test.ts`

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
- browser sync does not replicate hidden identity entities such as principals,
  auth-subject projections, admission records, capability grants, or share
  grants; those records contain authority-only predicates that must stay on
  direct authority read paths
- Worker request handlers are trusted to produce `AuthorizationContext`, but not
  to bypass authority decisions
- Durable Object authority remains the authoritative write point
- future remote-graph access must terminate in the same policy evaluator, not a
  separate bypass path
- current web proof note: `/api/tx` and `/api/commands` already apply that
  rule, surface stable deny codes on failure, and use `policyVersion` as the
  coherence token Branch 3 and Branch 7 should refresh against

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

Stored in the current single-graph web authority code:

- the authoritative compiled `policyVersion` constant in
  `lib/app/src/web/lib/policy-version.ts`

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
- in the current proof, a `policyVersion` mismatch means the caller projected
  against an older compiled authority policy contract and must rebuild request
  authorization context before retrying protected reads, writes, commands, or
  scoped sync
- bearer share tokens are stored only as token hashes; plaintext bearer tokens
  are write-only at issuance time
- the current single-graph bearer proof requires an explicit `expiresAt`
  constraint on bearer-target share grants so the anonymous read surface stays
  narrow, auditable, and revocable

## 7. Integration Points

| Branch                                    | Dependency direction         | Imported contracts                                                                                 | Exported contracts                                                | What may be mocked                                               | What must be stable                                                    |
| ----------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Branch 1: Graph Kernel And Authority      | Branch 2 depends on Branch 1 | stable ids, transaction application, write scopes, sync filtering seams, command dispatch boundary | principal-aware policy evaluation, grant records, policy versions | allow-all principal model for early prototypes                   | write-scope enforcement hook and filtered sync hook                    |
| Branch 3: Sync Query And Projections      | Branch 3 depends on Branch 2 | `AuthorizationContext`, predicate policy, share-surface ids, policy versions                       | principal-scoped visibility semantics for scoped sync             | temporary whole-graph reads filtered by current field visibility | stable deny-by-default read contract and versioned policy filter       |
| Branch 4: Module Runtime And Installation | Branch 4 depends on Branch 2 | `ModulePermissionRequest`, grant creation, command authorization                                   | install-time approval model and durable permission grant shape    | built-in module allowlist                                        | manifest permission keys, kind-specific lowering, and revocation rules |
| Branch 5: Blob Ingestion And Media        | mutual dependency            | secret-use capabilities, command authorization, shareability rules                                 | blob and secret command keys referenced by grants                 | local operator-only secrets                                      | capability names for reveal, rotate, and ingest flows                  |
| Branch 6: Workflow And Agent Runtime      | Branch 6 depends on Branch 2 | agent and service principal kinds, command authorization, share grants                             | durable agent permission model                                    | operator-run workflows under one principal                       | service and agent principal semantics                                  |
| Branch 7: Web And Operator Surfaces       | Branch 7 depends on Branch 2 | auth bridge contract, principal summary, share grant contract                                      | capability-aware UX requirements                                  | developer-only sign-in and single-user mode                      | request context contract and explicit forbidden behavior               |

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

- denied predicates are omitted from total sync snapshots and incremental sync
  transaction operations
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

- `lib/graph-kernel/src/schema.ts`: keep `GraphFieldAuthority` stable and add
  the principal-aware policy descriptor surface beside it rather than inside
  route code
- `lib/graph-authority/src/contracts.ts`: publish the canonical
  `AdmissionPolicy` contract beside the existing auth and grant vocabulary
- `lib/graph-authority/src/contracts.ts`: publish the canonical
  `ModulePermissionRequest` plus the command-policy vocabulary it lowers
  through
- `lib/graph-authority/src/replication.ts`: add principal-aware filtering
  on top of the existing replication visibility rules
- `lib/app/src/web/lib/authority.ts`: introduce request-bound `AuthorizationContext`
  evaluation and final read or write enforcement
- `lib/app/src/web/lib/auth-bridge.ts`: add the Better Auth session-to-principal
  projection seam
- `lib/graph-module-core/src/core/`: add core principal, role, capability, and share
  graph types that downstream branches can reference, including
  `core:admissionPolicy`
