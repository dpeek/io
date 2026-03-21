# Branch 2: Identity, Policy, And Sharing

Canonical spec:
[`02-identity-policy-and-sharing-canonical.md`](./02-identity-policy-and-sharing-canonical.md)

## Mission

Make principals, predicate-level privacy, auth projection, and capability-based
sharing concrete enough that the rest of the platform can build against them.

## Why This Is A Separate Branch

Privacy and capability rules are not UI concerns. They shape sync, query,
module permissions, agent behavior, and any future federation surface.

## In Scope

- graph principal model
- Better Auth boundary and projection into graph principals
- predicate visibility and write policy model
- secret-use authorization rules
- capability and sharing grant contracts
- install-time module permission shape
- single-graph sharing rules and the first federation-safe contracts

## Out Of Scope

- full remote graph query planner
- live cross-graph subscriptions
- rich end-user sharing UX
- broad multi-tenant collaboration product features

## Durable Contracts Owned

- principal identity model
- session claim to principal projection model
- predicate policy metadata
- capability grant model
- module permission request model

## Likely Repo Boundaries

- graph policy contracts
- auth bridge code in `src/web/`
- future authority policy runtime
- module permission descriptors

## Dependencies

- Branch 1 for stable graph entities, writes, and authority enforcement points

## Downstream Consumers

- Branch 3 needs policy-filtered scope semantics
- Branch 4 needs install-time permission contracts
- Branch 6 needs principal-aware workflow and agent permissions
- Branch 7 needs capability-aware UX and session handling

## First Shippable Milestone

Add a first-class principal and predicate-policy model with Better Auth session
projection and policy-filtered graph reads in the current single-graph proof.

## Done Means

- one authenticated principal maps cleanly into graph identity
- policy rules can hide authority-only or owner-only predicates from client
  reads
- write paths can reject mutations that violate policy class
- module installs can declare requested permissions

## First Demo

Sign in, load the same entity as two different principals, and prove that the
visible predicate set changes according to policy.

## What This Unlocks

- scoped sync per principal in Branch 3
- safe module installation in Branch 4
- durable agent permissions in Branch 6
- future sharing and federation work

## Source Anchors

- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/08-vision-overview.md`
- `doc/09-vision-platform-architecture.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`
