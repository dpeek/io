# Branch 7 Canonical: Web And Operator Surfaces

## Overview

### Mission

Turn the platform contracts into usable web and operator surfaces for browsing,
editing, syncing, debugging, and operating the graph product.

### Why This Is A Separate Branch

The platform needs a consumer branch that turns the lower-level contracts into
real product value. This branch should move fast without re-owning kernel,
policy, sync, or module contracts.

### In Scope

- app shell and authenticated browser bootstrap
- module host and route composition
- graph explorer and devtools
- capability-aware entity and collection views
- sync status and operator tooling
- install and workflow surfaces as downstream contracts stabilize

### Out Of Scope

- ownership of graph, sync, module, or policy contracts
- low-level query planner implementation
- queue consumers and blob extraction runtime

### Durable Contracts Owned

- module-host interface for web views and editors
- capability-aware browser client expectations
- operator-facing shell and tooling conventions

### Likely Repo Boundaries

- `src/web/`
- shared web component packages
- TUI or operator integration surfaces that consume workflow state

### Dependencies

- Branch 1 for stable graph bootstrapping and authority APIs
- Branch 2 for auth and capability-aware behavior
- Branch 3 for scoped sync and projection-backed queries
- Branch 4 for module-host registration
- Branch 6 for workflow and artifact surfaces

### Downstream Consumers

- this is the main product-facing consumer branch rather than a dependency
  provider for other branches

### First Shippable Milestone

Ship a capability-aware app shell that can load one installed module over one
scoped sync view while preserving the graph explorer as a power tool.

### Done Means

- a signed-in user can load the app shell and a module view
- the module view uses documented host contracts rather than bespoke wiring
- the browser works against scoped sync rather than assuming whole-graph state
- the explorer and operator tools still work for debugging

### First Demo

Sign in, load one installed module, edit an entity through the module surface,
and watch the scoped sync and explorer update coherently.

### What This Unlocks

- a product-facing proof beyond pure devtools
- operator confidence in module install, workflow, and ingest features
- a surface that can expose later sharing and federation capabilities

### Source Anchors

- `doc/02-current-state-architecture.md`
- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/08-vision-overview.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`

## 1. Purpose

This branch owns the product-facing surfaces that turn the lower-level graph,
policy, sync, module, and workflow contracts into a usable browser and
operator experience.

It exists separately because these surfaces need to move faster than the graph
kernel, but they still need their own stable contracts. The platform does not
become a product just because facts, sync, and modules exist. It becomes a
product when a user or operator can:

- load an authenticated shell
- open a module or operator route
- browse or edit authorized graph data
- understand sync and workflow state when something goes wrong

Platform outcomes this branch must deliver:

- one browser bootstrap contract that can move from the current whole-graph
  proof to authenticated, capability-aware, scoped product flows
- one module host contract for route, object, collection, workflow, and
  operator surfaces
- one operator shell that keeps graph explorer and sync tooling available as
  power tools while modules become the main product UX
- one clear split between host responsibilities and module responsibilities

Stability target for this branch:

- `stable`: the current SPA shell, built-in route composition, shared graph
  runtime bootstrap, and built-in operator surfaces for graph exploration and
  sync diagnostics
- `provisional`: authenticated bootstrap payloads, capability-aware guards,
  scope-bound browser runtime expectations, and module-host registration
- `future`: install UX, rich workflow consoles, offline-first browser state,
  and remote or federated surfaces

## 2. Scope

### In scope

- browser bootstrap and signed-in shell composition
- TanStack Router route ownership and navigation model
- shared browser graph runtime lifecycle on top of Branch 1 and Branch 3
- module-host registration for web routes, object screens, collection screens,
  workflow screens, and operator panels
- capability-aware visibility, disabled-state, and redaction behavior in the
  UI
- built-in operator surfaces such as the graph explorer and sync monitor
- operator-facing integration surfaces for workflow, run, and session views
- shell conventions for loading, stale, fallback, and error states

### Out of scope

- authoritative graph write ordering, persistence, or transaction retention
- auth provider implementation or principal resolution logic
- scoped sync planning, projection building, or invalidation routing
- module manifest shape, install records, or migration ownership
- workflow entity taxonomy, run/session persistence, or artifact storage
- blob ingestion workers, extraction queues, or media storage

### Upstream assumptions

- Branch 1 keeps whole-graph sync, transaction, validation, and secret-field
  mutation contracts stable enough for the current proof
- Branch 2 provides a principal/session projection and a capability model that
  browser surfaces can consume without inferring policy themselves
- Branch 3 provides explicit scope completeness, freshness, and fallback
  semantics before module surfaces rely on scoped caches
- Branch 4 provides installed-module records plus declared UI and command
  contributions
- Branch 6 provides workflow, run, session, and artifact records or an
  adapter-backed equivalent during migration

## 3. Core Model

Branch 7 owns the surface model that sits between upstream platform contracts
and concrete UI screens.

Inference: the bootstrap and module-host interfaces below are not implemented
as first-class repo contracts today. They normalize the seams implied by the
current `src/web` shell, the recommended `web/app-shell`, `web/module-host`,
and `web/auth-bridge` split, and the Branch 7 brief.

### Web principal session

```ts
type ShellAuthState = "booting" | "signed-out" | "ready" | "expired";

interface WebPrincipalSession {
  sessionId: string;
  authState: ShellAuthState;
  principalId?: string;
  displayName?: string;
  capabilityVersion?: string;
}
```

Responsibilities:

- expose the browser-visible identity state for the current shell
- tell surfaces whether they may render data, require sign-in, or require
  reauthentication
- version session-linked capability state so stale browser caches can be
  invalidated explicitly

Lifecycle:

1. `booting`
2. `signed-out` or `ready`
3. optionally `expired`
4. replaced on sign-in, sign-out, or reauth

### Capability snapshot

```ts
interface CapabilitySnapshot {
  principalId: string;
  policyFilterVersion: string;
  capabilities: readonly string[];
  hiddenPredicates?: readonly string[];
  readOnlyPredicates?: readonly string[];
}
```

Responsibilities:

- carry the browser-visible result of Branch 2 policy decisions
- let host and module surfaces gate navigation, commands, and edit affordances
- give the client an explicit `policyFilterVersion` to couple surface state to
  Branch 3 scope validity

Branch 7 does not decide which capabilities exist. It owns how UI surfaces
consume them.

### Surface scope request

```ts
type SurfaceScopeRequest =
  | { kind: "graph" }
  | { kind: "module"; moduleId: string; scopeId: string }
  | { kind: "entity-neighborhood"; rootId: string; predicates?: readonly string[] }
  | { kind: "collection"; scopeId: string };

interface BrowserScopeLease {
  scopeId: string;
  definitionHash: string;
  completeness: "complete" | "incomplete";
  freshness: "current" | "stale";
  release(): void;
}
```

Responsibilities:

- let the shell or a module declare which Branch 3 scope it needs
- bind rendered UI to explicit completeness and freshness state
- keep the surface contract narrower than the full scope-planner contract

Lifecycle:

1. requested by shell or module
2. loading
3. ready with explicit completeness
4. stale or fallback-required
5. released when the surface unmounts

### App shell route contribution

```ts
type AppShellRouteKind = "home" | "module" | "operator";

interface AppShellRouteContribution {
  routeId: string;
  path: string;
  navLabel: string;
  kind: AppShellRouteKind;
  order: number;
  requiredCapabilities?: readonly string[];
  defaultScope?: SurfaceScopeRequest;
}
```

Responsibilities:

- describe one route that the shell can navigate to
- support built-in routes and installed-module routes through one registry
- allow navigation and visibility decisions before the surface code loads

Current built-in route contributions in the repo are effectively:

- `/`
- `/topics`
- `/graph`
- `/sync`

These remain built-ins, but they should use the same registration path as
future module routes.

### Module surface contribution

```ts
type ModuleSurfaceKind = "route" | "object" | "collection" | "workflow" | "operator";

type ModuleSurfaceContribution =
  | {
      moduleId: string;
      surfaceId: string;
      kind: "route";
      route: AppShellRouteContribution;
      scopeRequests?: readonly SurfaceScopeRequest[];
    }
  | {
      moduleId: string;
      surfaceId: string;
      kind: "object";
      entityType: string;
      objectViewKey: string;
      commands?: readonly string[];
    }
  | {
      moduleId: string;
      surfaceId: string;
      kind: "collection";
      collectionKey: string;
      scopeRequests: readonly SurfaceScopeRequest[];
      commands?: readonly string[];
    }
  | {
      moduleId: string;
      surfaceId: string;
      kind: "workflow";
      workflowKey: string;
      scopeRequests?: readonly SurfaceScopeRequest[];
    }
  | {
      moduleId: string;
      surfaceId: string;
      kind: "operator";
      route: AppShellRouteContribution;
    };
```

Responsibilities:

- convert Branch 4 module declarations into concrete shell-mountable surfaces
- bind a surface to route identity, object views, workflows, and required
  scopes
- let the host reject incompatible or duplicate contributions before render

Relationships:

- `objectViewKey` references Branch 1 root-safe `ObjectViewSpec`
- `workflowKey` references Branch 6 or Branch 4 workflow declarations
- `commands` reference Branch 1 `GraphCommandSpec` keys

### Surface guard result

```ts
type SurfaceGuardResult =
  | { status: "allowed" }
  | { status: "read-only"; missingCapabilities: readonly string[] }
  | { status: "hidden"; missingCapabilities: readonly string[] }
  | { status: "reauth" };
```

Responsibilities:

- standardize how the shell and modules respond to capability shortfalls
- distinguish hidden surfaces from visible-but-disabled surfaces
- keep reauth and policy-change handling explicit

### Surface host context

```ts
interface SurfaceHostContext {
  session: WebPrincipalSession;
  capabilities?: CapabilitySnapshot;
  ensureScope(request: SurfaceScopeRequest): Promise<BrowserScopeLease>;
  runCommand<Input, Output>(key: string, input: Input): Promise<Output>;
  navigate(to: string): void;
  openOperatorSurface(surfaceId: string): void;
}
```

Responsibilities:

- give module surfaces one host-mediated way to reach sync, commands, and
  operator navigation
- keep auth, transport, and scope wiring out of module-owned React trees
- make shell-versus-module ownership testable

### Operator surface registration

```ts
type OperatorSurfaceKind =
  | "graph-explorer"
  | "sync-monitor"
  | "workflow-console"
  | "session-replay"
  | "custom";

interface OperatorSurfaceRegistration {
  surfaceId: string;
  kind: OperatorSurfaceKind;
  route: AppShellRouteContribution;
}
```

Responsibilities:

- register built-in diagnostics and future workflow/operator tools
- preserve the graph explorer as a power tool even after module UX becomes the
  default
- let Branch 6 contribute workflow consoles without taking over shell
  ownership

## 4. Public Contract Surface

### Surface summary

| Name                          | Purpose                                                                         | Caller                                      | Callee                              | Inputs                                                       | Outputs                                                    | Failure shape                                                              | Stability                                         |
| ----------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| `GraphRuntimeBootstrap`       | Initialize the shared browser graph runtime for a route subtree                 | built-in routes, future module routes       | browser sync client over Branch 1/3 | current sync endpoint(s), tx endpoint(s), retry intent       | ready runtime or loading/error state                       | network failure, invalid sync payload, rejected mutation                   | `stable`                                          |
| `AppShellBootstrapPayload`    | Bootstrap session, capabilities, and visible route/module contributions         | browser shell                               | auth bridge plus module host        | request/session context                                      | `WebPrincipalSession`, capability snapshot, route registry | unauthenticated, expired session, bootstrap mismatch                       | `provisional`                                     |
| `AppShellRouteContribution`   | Register navigable shell routes                                                 | built-in shell, module host                 | app shell router                    | route id, path, nav label, capability requirements           | visible route, hidden route, or guarded route              | duplicate route id, path collision, unmet required capability              | `stable` for built-ins, `provisional` for modules |
| `ModuleSurfaceContribution`   | Register module-owned route, object, collection, workflow, or operator surfaces | Branch 4 install runtime, built-in modules  | module host registry                | module id, surface id, referenced view/workflow/command keys | registered surface handle                                  | host-version mismatch, duplicate ids, missing referenced contracts         | `provisional`                                     |
| `SurfaceHostContext`          | Give mounted surfaces access to scopes, commands, and navigation                | module and operator surface implementations | shell host runtime                  | scope requests, command keys, navigation targets             | scope lease, command result, navigation side effects       | capability denied, stale session, missing scope, command transport failure | `provisional`                                     |
| `SurfaceGuardResult`          | Standardize capability-aware UI behavior                                        | shell guards, module guards                 | branch-owned guard logic            | capability snapshot plus surface requirements                | allowed, read-only, hidden, or reauth result               | stale capability version or missing session                                | `provisional`                                     |
| `OperatorSurfaceRegistration` | Register built-in and imported operator tools                                   | built-in web surfaces, Branch 6 adapters    | app shell operator registry         | route contribution and operator kind                         | operator nav entry and route mount                         | hidden surface, incompatible contribution                                  | `provisional`                                     |
| `OperatorSessionFeed`         | Render run/session progress in web or TUI operator surfaces                     | Branch 6 runtime or current retained reader | operator UI renderer                | ordered session or status events                             | session timeline and retained transcript view              | replay gap, missing retained history, stream disconnect                    | `provisional`                                     |

### `GraphRuntimeBootstrap`

Current implementation anchors:

- `src/web/components/graph-runtime-bootstrap.tsx`
- `src/web/lib/server-routes.ts`
- `src/web/worker/index.ts`

Contract rules:

- the bootstrap contract must expose explicit loading and error states
- retry must clear any cached failed runtime instance before re-pulling
- the current proof uses whole-graph sync plus transaction push; this remains
  supported until scoped bootstrap is stable
- a route may not assume a ready graph runtime outside the bootstrap boundary

### `AppShellBootstrapPayload`

Inference: the repo does not yet expose a first-class bootstrap payload beyond
static routes plus `/api/sync`. Once Branch 2 and Branch 4 land, the shell
needs one bootstrap surface that carries identity and installed-module data.

Canonical shape:

```ts
interface AppShellBootstrapPayload {
  session: WebPrincipalSession;
  capabilities?: CapabilitySnapshot;
  routes: readonly AppShellRouteContribution[];
  modules: readonly {
    moduleId: string;
    version: string;
    surfaceIds: readonly string[];
  }[];
}
```

Contract rules:

- transport may be server-inlined HTML bootstrap data or a dedicated fetch, but
  the payload shape must be equivalent
- route visibility must already reflect session and coarse capability state
- missing or stale capability data must fail closed; the shell should not guess

### `ModuleSurfaceContribution`

Contract rules:

- `moduleId + surfaceId` is the durable registration identity
- route contributions may not shadow built-in route ids or paths without an
  explicit host override policy
- host-visible contributions must reference already-installed module versions;
  dangling references are registration errors, not lazy warnings
- object and workflow surfaces may reference root-safe `ObjectViewSpec`,
  `WorkflowSpec`, and `GraphCommandSpec` contracts, but they do not own those
  schemas

### `SurfaceHostContext`

Contract rules:

- modules do not fetch auth, sync, or command transports directly from the
  environment when a host context exists
- `ensureScope(...)` must return explicit completeness and freshness metadata
- command execution must preserve the execution-mode contract from
  `GraphCommandSpec`
- navigation remains shell-owned even when a module initiates it

### `OperatorSessionFeed`

Inference: the current live and retained TUI is CLI-owned in `src/agent`, but
the branch brief requires operator surfaces as downstream product contracts.

Canonical shape:

```ts
interface OperatorSessionFeed<Event = unknown> {
  sessionId: string;
  mode: "live" | "attach" | "replay";
  events: readonly Event[];
  cursor?: string;
}
```

Contract rules:

- the UI consumes an ordered feed; it does not invent ordering rules
- live and retained feeds may use different transports, but they should project
  to one ordered session model
- missing retained history must degrade to an explicit operator error state

## 5. Runtime Architecture

Branch 7 spans four runtime zones.

### Browser app shell

Current repo anchors:

- `src/web/router.tsx`
- `src/web/routes/__root.tsx`
- `src/web/components/app-shell.tsx`

Responsibilities:

- own top-level navigation and route assembly
- mount built-in and module routes
- provide loading, error, and empty-state conventions

Authoritative state:

- none

Derived state:

- route selection
- shell navigation visibility
- transient guarded-state decisions

### Browser graph surface runtime

Current repo anchors:

- `src/web/components/graph-runtime-bootstrap.tsx`
- `src/web/components/graph-explorer-page.tsx`
- `src/web/components/sync-page.tsx`
- `src/web/components/topic-browser-page.tsx`

Responsibilities:

- bootstrap and retain the shared browser graph runtime
- expose sync status and pending write state to routes
- evolve from whole-graph bootstrap to scope-bound surface runtime

Authoritative state:

- none; all graph data is remote-authoritative

Derived state:

- local synced cache
- pending local transactions
- scope freshness and fallback state

### Worker edge shell

Current repo anchors:

- `src/web/worker/index.ts`
- `src/web/lib/server-routes.ts`

Responsibilities:

- serve SPA assets and browser entry HTML
- route graph sync and mutation APIs to the authority layer
- later provide authenticated bootstrap payload delivery

Authoritative state:

- none; this is a routing and bootstrap layer

### Authority and operator backends

Current repo anchors:

- `src/web/lib/graph-authority-do.ts`
- `src/web/lib/authority.ts`
- `src/agent/tui-runtime.ts`
- `src/agent/server.ts`

Responsibilities:

- Branch 1 authority: graph sync, transactions, secret-field mutations
- Branch 6 runtime or current adapter: workflow and operator session feeds

Branch 7 consumes these backends. It does not own their durable records.

### Boundary rules

- browser routes and modules never talk directly to Durable Objects without a
  host-owned client boundary
- the app shell owns route composition and navigation chrome
- modules own functional UI inside host-provided slots and contexts
- graph explorer and sync tooling remain built-in operator surfaces even after
  module routes exist
- the current CLI/TUI remains a valid operator surface during migration, but
  its retained runtime model is still Branch 6-owned

## 6. Storage Model

Branch 7 does not own authoritative persistent storage.

Authoritative storage stays upstream:

- graph facts, transactions, and secret side storage: Branch 1
- sessions, principals, capability grants: Branch 2
- scope and projection state: Branch 3
- module install records: Branch 4
- workflow runs, sessions, and artifacts: Branch 6

Branch 7 may hold only derived or disposable state:

- in-memory browser sync cache
- route search params and shell UI state
- temporary create drafts and unsaved form state
- optional browser-local preferences such as last-opened panel or layout mode

Rules:

- any branch-owned local persistence must be safe to delete without corrupting
  product state
- route registration is rebuilt from built-ins plus installed-module records;
  it is not canonical data
- retained TUI/runtime files used during migration remain Branch 6-owned even
  when a Branch 7 surface reads them

## 7. Integration Points

### Branch 1: Graph Kernel And Authority

- dependency direction: Branch 7 imports Branch 1
- imported contracts:
  - sync payloads and transaction push
  - typed graph runtime and root-safe `ObjectViewSpec` or `GraphCommandSpec`
  - secret-field mutation paths for authority-only values
- exported contracts:
  - explicit browser bootstrap and retry expectations
  - host-side command and mutation UX semantics
- mockable or provisional:
  - current whole-graph sync proof is enough for early shell work
- must be stable before safe product implementation:
  - transaction validation behavior
  - cursor and replay semantics
  - secret-field mutation boundary

### Branch 2: Identity, Policy, And Sharing

- dependency direction: Branch 7 imports Branch 2
- imported contracts:
  - session-to-principal projection
  - capability keys
  - browser-visible policy and redaction semantics
- exported contracts:
  - capability-aware route guards
  - redacted, read-only, hidden, and reauth UI states
- mockable or provisional:
  - early module-host work can use a static operator principal
- must be stable before safe product implementation:
  - how hidden predicates appear in client reads
  - capability versioning rules
  - sign-in versus expired-session behavior

### Branch 3: Sync, Query, And Projections

- dependency direction: Branch 7 imports Branch 3
- imported contracts:
  - scope definitions
  - completeness and freshness semantics
  - fallback reasons
  - live-scope registration behavior
- exported contracts:
  - `SurfaceScopeRequest`
  - browser expectations for stale, partial, and refreshed data
- mockable or provisional:
  - current whole-graph sync remains the proof path
- must be stable before safe module implementation:
  - explicit completeness on every scope
  - policy-version coupling
  - fallback handling that does not silently widen data visibility

### Branch 4: Module Runtime And Installation

- dependency direction: Branch 7 imports Branch 4
- imported contracts:
  - installed-module records
  - surface declarations
  - referenced object-view, workflow, and command keys
- exported contracts:
  - `ModuleSurfaceContribution`
  - route and shell host registration semantics
- mockable or provisional:
  - the first milestone can hard-code one built-in module contribution
- must be stable before safe implementation:
  - module contribution identity
  - compatibility and host-version checks
  - install or uninstall lifecycle hooks that refresh visible routes

### Branch 5: Blob Ingestion And Media

- dependency direction: Branch 7 imports Branch 5
- imported contracts:
  - blob metadata visibility rules
  - preview or download surfaces
  - ingest review task linkage
- exported contracts:
  - browser media and ingest review slots inside the app shell
- mockable or provisional:
  - file preview can stay placeholder-backed before full media modules land
- must be stable before safe implementation:
  - browser-safe blob access rules
  - provenance and ingest-status visibility

### Branch 6: Workflow And Agent Runtime

- dependency direction: Branch 7 imports Branch 6
- imported contracts:
  - workflow, run, session, and artifact records
  - operator session event feeds
  - retained replay or attach semantics during migration
- exported contracts:
  - operator shell and workflow-view host slots
  - session timeline and artifact viewer conventions
- mockable or provisional:
  - current retained TUI feeds may stand in for graph-native workflow views
- must be stable before safe implementation:
  - session ordering
  - lifecycle states for runs and sessions
  - artifact identity and access rules

## 8. Main Flows

### 1. Load the app shell

1. Initiator: browser navigation to the Worker-delivered app.
2. Components involved: Worker shell, app shell router, bootstrap payload
   loader, graph runtime bootstrap.
3. Contract boundaries crossed:
   - asset or HTML delivery
   - bootstrap payload delivery
   - sync bootstrap
4. Authoritative write point: none.
5. Failure behavior:
   - unauthenticated users go to sign-in or signed-out shell state
   - sync bootstrap failures land in explicit retry UI
   - stale session lands in `reauth`, not a partially mounted shell

### 2. Resolve and mount a module route

1. Initiator: user clicks a nav item or deep-links into a module path.
2. Components involved: app shell route registry, guard logic, module host,
   optional scope bootstrap.
3. Contract boundaries crossed:
   - route contribution lookup
   - capability guard evaluation
   - module surface registration
4. Authoritative write point: none.
5. Failure behavior:
   - unknown route goes through shell not-found handling
   - missing capability yields hidden or read-only behavior according to the
     contribution contract
   - incompatible module registration yields an operator-visible load error

### 3. Edit an entity through a module or built-in surface

1. Initiator: user changes a field in a module screen, the topic browser, or
   the explorer.
2. Components involved: mounted surface, surface host context, Branch 1 command
   or transaction path, browser sync runtime.
3. Contract boundaries crossed:
   - view/editor surface
   - command or transaction dispatch
   - authoritative sync acknowledgement
4. Authoritative write point: Branch 1 authority transaction application or
   explicit secret-field mutation path.
5. Failure behavior:
   - validation errors remain attached to the local field or draft
   - capability denial keeps the surface mounted but blocked
   - stale scope triggers re-pull before the surface can claim success

### 4. Inspect sync state and recent authority activity

1. Initiator: operator opens the sync surface or a built-in sync inspector.
2. Components involved: app shell, graph runtime bootstrap, sync inspector.
3. Contract boundaries crossed:
   - browser runtime state read
   - optional manual refresh action
4. Authoritative write point: none.
5. Failure behavior:
   - disconnected or stale state is shown explicitly
   - the page continues to render even if a module route is broken

### 5. Inspect workflow or session progress

1. Initiator: operator opens a workflow or session surface in the SPA or TUI.
2. Components involved: operator registry, Branch 6 feed or retained adapter,
   session timeline renderer.
3. Contract boundaries crossed:
   - operator surface registration
   - live or retained session feed
4. Authoritative write point: none for read-only inspection; future task
   actions go through Branch 6 commands.
5. Failure behavior:
   - replay gaps show an operator-visible degraded state
   - missing retained history does not crash the shell

### 6. Install or refresh a module and expose its surface

1. Initiator: operator installs, upgrades, or removes a module.
2. Components involved: Branch 4 install runtime, app shell bootstrap refresh,
   module host registry.
3. Contract boundaries crossed:
   - installed-module record change
   - route and surface registration refresh
4. Authoritative write point: Branch 4 install record commit.
5. Failure behavior:
   - incompatible modules never mount partially
   - removed modules disappear from the route registry after refresh

## 9. Invariants And Failure Handling

### Invariants

- a mounted surface always knows whether it is rendering under `signed-out`,
  `ready`, or `expired` session state
- the browser never assumes whole-graph completeness unless the bound scope is
  explicitly `{ kind: "graph" }` and complete
- route visibility and edit affordances must fail closed when capabilities are
  missing or stale
- built-in operator tools remain accessible through documented shell routes and
  are not displaced by module surfaces
- module registration identity is `moduleId + surfaceId`; duplicate identities
  or path collisions are registration errors
- host context is the browser surface boundary for scope access, command
  execution, and navigation
- no branch-owned state is the only durable copy of product data
- redacted or hidden predicates must not leak through labels, counts, previews,
  or debug chrome

### Failure modes

`Bootstrap failure`

- what fails: session/bootstrap load or first sync pull
- what must not corrupt: local route registry and prior durable authority state
- retry or fallback: clear failed runtime cache and retry; fall back to
  signed-out or reauth shell when applicable
- observability needed: bootstrap route errors, sync endpoint failures,
  capability-version mismatch

`Scope stale or policy changed`

- what fails: one mounted surface's local cache no longer matches allowed scope
- what must not corrupt: local draft state and existing authoritative data
- retry or fallback: mark the surface stale, refresh the scope, or return to
  explicit fallback UI
- observability needed: scope id, definition hash, policy filter version,
  fallback reason

`Module host mismatch`

- what fails: a declared module surface cannot be mounted safely
- what must not corrupt: built-in shell routes or other module registrations
- retry or fallback: reject the contribution and surface an operator diagnostic
- observability needed: module id, surface id, host version, missing contract
  keys

`Command or mutation rejection`

- what fails: a field edit or command action does not commit
- what must not corrupt: authoritative graph state and unrelated local pending
  writes
- retry or fallback: keep the draft, show the validation or capability error,
  and allow retry
- observability needed: command key or tx id, predicate or field path, reject
  reason

`Operator feed gap`

- what fails: live or retained session rendering loses ordered continuity
- what must not corrupt: already-rendered retained history
- retry or fallback: request replay or show a degraded timeline state
- observability needed: session id, last event cursor or sequence, feed mode

## 10. Security And Policy Considerations

- Branch 7 does not own policy, but it does own the last-mile contract that
  turns policy decisions into safe UI behavior.
- Authority-only data must never be required for shell composition or route
  guards. The browser only receives replicated fields and safe capability
  metadata.
- Secret-backed fields continue to mutate through explicit authority paths such
  as `/api/secret-fields`; generic module editors must not bypass that boundary.
- Capability checks must gate both navigation and actions. Hiding a route but
  leaving a command callable from the browser is not acceptable.
- Debug tools, graph explorer, and sync pages follow the same visibility rules
  as module surfaces. "Operator" is not a blanket authorization bypass.
- Browser-local persistence must avoid storing authority-only or session-secret
  material. If added, it should be cleared on sign-out or session expiry.
- Module surfaces run inside a host-controlled shell. They may render product
  UI, but they do not control auth bootstrap, route policy, or direct authority
  transport.
- The current TUI and retained runtime views may expose filesystem paths and
  execution metadata. Those surfaces must not expose secret plaintext or
  capability-grant internals unless Branch 6 and Branch 2 explicitly allow it.

## 11. Implementation Slices

### Slice 1: Formalize the current built-in shell

- goal: turn the existing static route list and graph bootstrap into a
  documented built-in shell registry
- prerequisite contracts: current whole-graph sync and transaction routes
- what it proves: built-in routes can share one host registration path and one
  bootstrap model
- what it postpones: auth bridge, scoped sync, installed-module discovery

### Slice 2: Introduce one module-host registration path

- goal: mount one installed or built-in module route through a host registry
  instead of bespoke route wiring
- prerequisite contracts: Branch 4 surface declaration shape and stable
  `ObjectViewSpec` or `GraphCommandSpec` keys
- what it proves: one module can add a route and object surface without manual
  shell edits
- what it postpones: multi-module install UX and remote bundles

### Slice 3: Add capability-aware browser guards

- goal: replace static operator assumptions with explicit session and
  capability-aware surface guards
- prerequisite contracts: Branch 2 principal and capability projection
- what it proves: route visibility, read-only states, and reauth behavior are
  first-class shell contracts
- what it postpones: sharing UX and fine-grained collaboration flows

### Slice 4: Move from whole-graph bootstrap to one scoped module surface

- goal: let one route bind to one Branch 3 scope and render explicit
  completeness and freshness states
- prerequisite contracts: Branch 3 scoped sync payloads and fallback reasons
- what it proves: module UX can stop assuming whole-graph local state
- what it postpones: offline-first caching and push fan-out polish

### Slice 5: Converge operator workflow surfaces

- goal: let the shell or TUI render workflow and session feeds through one
  host-visible operator registration contract
- prerequisite contracts: Branch 6 session and artifact feed shape
- what it proves: workflow-native operator tooling can sit beside explorer and
  sync tools without bespoke app branches
- what it postpones: full planning UX, intervention controls, and long-tail
  dashboards

### Slice 6: Add install and refresh UX

- goal: refresh visible routes and shell contributions when a module is
  installed, upgraded, or removed
- prerequisite contracts: Branch 4 install lifecycle and compatibility checks
- what it proves: the shell can become product-extensible without code edits
- what it postpones: marketplace discovery and signature verification

## 12. Open Questions

- Should the module-host contract be React-component-first, data-descriptor-
  first, or a hybrid that keeps routing declarative but lets modules own rich
  page composition?
- What is the preferred transport for `AppShellBootstrapPayload`: inline HTML
  bootstrap data, a dedicated authenticated API, or both?
- How should partially visible collections present counts, summaries, and empty
  states when Branch 2 hides some rows or predicates?
- Should workflow and session operator tooling converge into the SPA first, or
  should the TUI remain the primary live-operations surface after Branch 6
  becomes graph-native?
- How much browser-local draft or offline state is worth supporting before
  scoped sync invalidation rules stabilize?
- What compatibility contract is sufficient for deep links when a module route
  moves across versions?

## 13. Recommended First Code Targets

- `src/web/components/graph-runtime-bootstrap.tsx`: extract a formal browser
  bootstrap contract from the current whole-graph proof
- `src/web/router.tsx`, `src/web/routes/__root.tsx`, and
  `src/web/components/app-shell.tsx`: replace static built-in navigation with a
  route-contribution registry
- new `src/web/module-host/` package or equivalent: host registry, guard
  logic, and surface host context
- `src/web/components/graph-explorer-page.tsx`,
  `src/web/components/sync-page.tsx`, and
  `src/web/components/topic-browser-page.tsx`: register existing built-in
  surfaces through the same host contract
- `src/web/lib/server-routes.ts` and `src/web/worker/index.ts`: split future
  bootstrap/session delivery from raw graph sync and mutation routes
- `src/agent/tui/` plus future workflow operator routes: adapt retained or
  graph-native session feeds into the branch-owned operator-surface contract
