# Graph Authority

## Purpose

Describe how one logical graph can power the whole application while still
keeping authority, permissions, and sensitive values explicit.

This is not an implementation plan. It is the current approach for thinking
about the problem space and choosing boundaries that keep the model coherent.

## Problem

We want the graph to be the application model, not just a storage detail.

That means the same graph should be able to support:

- client-side reads and UI rendering
- optimistic local edits
- business logic authored close to the types it belongs to
- server-side authority for invariants, permissions, and secrets
- sensitive values that still live in the graph model without leaking to the
  client

Those goals pull in different directions.

- If the client gets the full graph, sensitive predicates leak.
- If all business logic is server-only, the UI loses the local-first feel we
  want.
- If we let the client run arbitrary business logic without an authority
  boundary, permissions and invariants drift into ad hoc application code.
- If encrypted values are treated like ordinary scalars, developers will build
  accidental plaintext assumptions into the client surface.

The problem is not whether we have one graph or separate client/server models.
The problem is how we keep one logical graph model while making authority
boundaries explicit.

## Core Approach

The working approach is:

1. keep one logical graph model across client and server
2. treat replication as policy, not as a given
3. treat authority as a first-class runtime boundary
4. let business logic feel local and typed at the API layer, while still
   lowering to an authoritative command boundary on the server

That gives us one conceptual model without pretending every runtime has the
same rights or the same data.

## Predicate-Level Visibility

Permissions should start at the predicate level.

Each predicate should be able to declare things like:

- whether it may replicate to the client
- whether it is readable only on the server
- whether writes require a capability or role
- whether the value is secret-backed rather than directly readable

This keeps the boundary close to the data model itself.

Entity-level and query-level policy still matter, but predicate visibility is
the base rule because it decides what data is even allowed to materialize in an
untrusted runtime.

That means the client should only ever query over the graph slice it is allowed
to hold. Hidden predicates are not "false" on the client. They are simply not
part of the client's authoritative view.

## Type-Local Business Methods

We still want excellent type DX for business logic.

The preferred direction is to let each type author its own business methods
close to the type definition, so the data model and the business operations stay
localized.

The API should feel like methods on typed business objects:

- `company.ref(id).approveInvoice(...)`
- `person.ref(id).changeEmail(...)`
- `workspace.ref(id).inviteMember(...)`

But that surface should not be a direct in-process method call. It should lower
to a serialized method invocation or command envelope that the server can
inspect, authorize, replay, audit, and execute authoritatively.

This is the main compromise:

- object-style method DX for authors and callers
- explicit command transport and authority on the wire

## Why Not A Giant Registry

The registry can stay very compact if it is mostly a composition step rather
than the place where methods are authored.

The important authoring unit is the type module.

Each type should define, in one place:

- the method name
- input and output types
- execution mode
- policy requirements
- the authoritative implementation
- optional optimistic behavior

Then the runtime can aggregate those per-type definitions into a dispatch table.

That keeps the registry mechanical while the real logic stays local to the
subject type.

## Execution Modes

Not every method should run the same way.

The current model should distinguish three modes:

### `localOnly`

Pure client-side derivation from already replicated data.

This is for local calculated values, UI helpers, and interaction logic that does
not need authoritative persistence or hidden data.

### `optimisticVerify`

The client may run the method optimistically for instant UX, but the server must
rerun it authoritatively before the result is accepted.

This should be the common mode for business methods that:

- depend only on replicated inputs for the optimistic path
- can be expressed deterministically
- do not require secret plaintext
- do not depend on hidden graph slices to produce a tentative result

### `serverOnly`

The client may express intent, but only the server may execute the logic.

This is required when a method depends on:

- hidden predicates
- secret values
- external side effects
- authoritative clocks or identity
- global uniqueness checks
- graph regions the client may not hold

## Local Optimism vs Server Authority

The client should be allowed to feel fast without pretending it is trusted.

That means:

- local mutation precheck still protects local graph integrity
- optimistic methods may produce tentative local state
- the server remains the only place that can accept the canonical write
- sync and reconciliation remain the boundary where tentative local state meets
  authoritative graph state

The client can help with responsiveness. It cannot grant itself permission.

## Calculated Fields

Calculated values should also follow the authority model.

There are two different kinds of calculated fields:

- local derived values computed from replicated predicates already in the client
- authoritative derived values that depend on hidden predicates, secrets, or
  graph state the client does not fully hold

The first kind can be ordinary client logic.

The second kind should be treated as an authoritative result, either returned
from a method invocation or materialized by the server into a replicated field
that is safe for the client to read.

That avoids a dangerous middle ground where the client guesses at results that
actually depend on data it is not allowed to see.

## Secrets In The Graph

Sensitive values should still be representable in the graph, but not as normal
client-readable scalars.

The right mental model is a sealed secret handle.

The graph stores a stable reference to encrypted secret material, while the
plaintext remains available only through a server-side unseal path with policy
checks and auditing.

That gives us:

- one logical graph model
- secret-bearing predicates that still participate in schema and relationships
- no ordinary browser decode path for secret plaintext

A client may know that a secret exists and may hold opaque metadata about it,
but it should not receive plaintext unless a very explicit, audited policy says
it may.

## What This Buys Us

This approach keeps the system coherent in a few important ways.

- The graph stays the main application model.
- Type authors can define data and business methods together.
- The browser gets a pleasant typed surface without becoming the source of
  authority.
- Permissions stay attached to graph structure instead of drifting into random
  UI code.
- Secrets live inside the same model without being treated like ordinary values.

## Guiding Rule

The simplest rule is:

The API may feel object-oriented and local, but every operation that can affect
authoritative state must cross an explicit authority boundary.

That is the line that lets us keep one graph model without collapsing client and
server trust into the same runtime.
