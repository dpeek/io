# Graph And App Modularity Proposal

## Status

Proposal.

This document recommends a target modularity model for `graph`, `app`, and
React-based rendering with a focus on:

- namespace growth
- schema-driven taxonomies
- per-type authoring
- field and object rendering
- workflow UI
- authority-owned commands
- experiment co-location in `app`

## Purpose

The repo is already pointing at the right top-level split:

- `graph` owns the reusable engine and schema authoring surface
- `app` owns app composition, proof routes, shell, and authority wiring

The current problem is that the main authoring unit is still mixed. Promoted
reusable schema already lives in the canonical graph tree, while some app-owned
proof slices and experiment registration still live in app experiment files
such as:

- `../graph/src/schema/app/workspace/`
- `../graph/src/schema/app/env-vars/`
- `../app/src/experiments/company/graph.ts`

That will not scale once the schema grows into:

- collaboration models
- auth and identity
- organizations and memberships
- geography and localization
- asset and media models
- richer field/value families such as markdown, source, files, images, videos,
  and database surfaces

The main recommendation of this document is:

1. keep the `@io/graph` root pure
2. let the `graph` workspace ship React adapter subpaths
3. make one directory per type the primary authoring unit
4. keep the namespace model intentionally small for now:
   - shared built-ins stay in `core:`
   - current experiment/domain slices stay in `app:` until they are promoted by
     real code
5. distinguish physical colocation from package export surfaces
6. treat taxonomies as slice aggregators over many types rather than the main
   place where types are stored

## Key Current Signals

### What the docs already say

- `graph` owns the reusable engine: schema authoring, ids, bootstrap, store,
  typed refs, validation, sync, persisted authority helpers, and type-module
  contracts.
  - Reference: `../graph/io/architecture.md`
  - Reference: `../graph/io/runtime.md`
  - Reference: `../graph/io/type-modules.md`
- `graph` does not currently ship a full web or TUI renderer stack, and UI
  adapter concerns should stay outside the runtime core.
  - Reference: `../graph/io/architecture.md`
  - Reference: `../graph/io/refs-and-ui.md`
- `app` is supposed to stay app-owned and proof-oriented, with experiments under
  `app/src/experiments/*` and generic shared infrastructure separated from
  experiment-local code.
  - Reference: `../app/io/experiments.md`
  - Reference: `../app/io/package-surface.md`
- the authority boundary should stay explicit, and any authoritative mutation
  must cross a real server boundary
  - Reference: `../graph/io/authority.md`
  - Reference: `../app/io/env-vars.md`

### What the source currently does

- built-in scalar modules already use a strong co-located pattern:
  - `../graph/src/schema/core/date/index.ts`
  - `../graph/src/schema/core/date/meta.ts`
  - `../graph/src/schema/core/url/index.ts`
  - `../graph/src/schema/core/url/meta.ts`
- field metadata and filter semantics already live in `graph` through
  `TypeModuleMeta`, `TypeModuleFilter`, and `defineReferenceField(...)`
  - Reference: `../graph/src/graph/type-module.ts`
- the current field resolver stack is reusable, but it lives in `app`
  - `../app/src/web/predicate.ts`
  - `../app/src/web/resolver.tsx`
  - `../app/src/web/generic-fields.tsx`
  - `../app/src/web/filter.tsx`
  - `../app/src/web/generic-filter-editors.tsx`
- the strongest current workflow proof is the workspace surface, but it is still
  a route-owned screen
  - `../app/src/web/workspace.tsx`
  - `../graph/src/schema/app/workspace/`
  - `../app/src/experiments/workspace/web.ts`
- the strongest current authority pattern is env vars:
  - replicated graph-safe metadata in `../graph/src/schema/app/env-vars/`
  - server-owned mutation in `../app/src/authority.ts`
  - transport in `../app/src/server-app.ts`

## Decision Summary

1. Keep the `@io/graph` root pure engine.
2. Allow the `graph` workspace to ship React adapter subpaths:
   - `@io/graph/react`
   - `@io/graph/react-dom`
   - `@io/graph/react-opentui`
3. Add a namespace-first schema layout rooted in:
   - `graph/src/schema/core/`
   - `graph/src/schema/app/<slice>/`
4. Make one directory per type the main authoring unit.
5. Keep physical colocation separate from package export ownership.
6. Make taxonomy modules thin aggregators over many type directories.
7. Keep current shared built-ins in `core:` until a real promotion is needed.
8. Keep `app` as composition:
   - namespace assembly
   - shell and routes
   - runtime bootstrap
   - HTTP transport
   - authority composition
   - proof/demo selection

## Core Principle

The important distinction is not:

- React vs no React

It is:

- engine core
- host-neutral React bindings
- DOM-specific widgets
- OpenTUI-specific widgets
- app/product composition

## Namespaces

## Keep The Namespace Model Small For Now

The repo only justifies two durable namespace buckets today:

- `core:` for engine metamodel plus the shared built-in type families already
  shipped from `graph/src/type/`
- `app:` for the current experiment/domain slices that are still being proven
  out

This proposal should not pre-create `geo:`, `locale:`, `finance:`, `collab:`,
or other future namespaces before the codebase actually has reusable modules
that need them.

## What Stays In `core:` Right Now

Keep in `core:`:

- metamodel types such as:
  - `core:node`
  - `core:type`
  - `core:predicate`
  - `core:enum`
- current shared built-in families and helpers such as:
  - `core:string`
  - `core:number`
  - `core:boolean`
  - `core:date`
  - `core:url`
  - `core:email`
  - `core:slug`
  - `core:address`
  - `core:country`
  - `core:currency`
  - `core:language`
  - `core:locale`

That keeps the proposal aligned with the code we already ship instead of
optimizing early for namespaces that do not exist yet.

## Promotion Rule

If a reusable slice eventually deserves its own namespace, promotion should
happen as a concrete refactor with imports, tests, and docs updated at the same
time.

Until then:

- shared built-ins remain in `core:`
- experiment and app-owned slices remain in `app:`

## Directory Layout

## Primary Schema Tree

The canonical schema tree should live in the `graph` workspace and mirror the
namespace structure.

Recommended layout:

```text
graph/src/schema/
  core/
    node/
    type/
    predicate/
    enum/
    string/
    number/
    boolean/
    date/
    url/
    address/
    country/
    currency/
    language/
    locale/
    email/
    slug/

  app/
    company/
      company/
      person/

    env-vars/
      env-var/
      secret-ref/

    outliner/
      block/

    workspace/
      workspace/
      workspace-project/
      workspace-issue/
      workspace-label/
      workflow-status/
      workflow-status-category/
```

This gives one browseable tree for the full model while still grouping by
semantic ownership.

`graph/src/schema/app/` here refers to the `app:` namespace inside the canonical
schema tree. It does not mean those modules belong in the `@io/app` package.

## One Directory Per Type

The primary authoring unit should be one directory per type.

Recommended contents:

```text
graph/src/schema/app/workspace/workspace-issue/
  type.ts
  views.ts
  commands.ts
  fixtures.ts
  react.tsx
  react-dom.tsx
  react-opentui.tsx
  index.ts
```

Rules:

- `type.ts`: canonical graph type definition
- `views.ts`: host-neutral view specs
- `commands.ts`: host-neutral command descriptors
- `fixtures.ts`: optional reusable fixture/sample builders that are safe to ship
  from `graph`
- `react.tsx`: host-neutral React composition
- `react-dom.tsx`: DOM-specific rendering/editing
- `react-opentui.tsx`: OpenTUI-specific rendering/editing
- `index.ts`: the root-safe export surface for that type

This is the direct generalization of the current scalar pattern from:

- `../graph/src/schema/core/date/`
- `../graph/src/schema/core/url/`

The main difference is that entity-like types get richer neighbors than only
`meta.ts` and `filter.ts`.

## Physical Colocation vs Package Exports

This proposal needs to keep two boundaries separate:

- physical colocation inside one type directory
- package export ownership across `@io/graph` and `@io/graph/react*`

The rule should be:

- colocate root-safe files and adapter files in the same type directory when
  that helps authoring
- keep `@io/graph` root exports limited to root-safe files
- re-export `react.tsx`, `react-dom.tsx`, and `react-opentui.tsx` only from
  adapter subpaths such as `@io/graph/react`

That means a type-local `index.ts` must stay root-safe. Adapter entrypoints
should import colocated React files directly rather than letting the root entry
pull them in accidentally.

## Type Shape Variants

Not every type directory will have all files.

### Value-family types

Examples:

- `core:date`
- `core:url`
- `core:email`
- `core:currency`

These may look closer to the existing scalar module pattern:

```text
date/
  type.ts
  meta.ts
  filter.ts
  index.ts
```

### Entity-like types

Examples:

- `app:company`
- `app:workspace`
- `app:workspaceIssue`
- `app:envVar`

These are more likely to need:

- `views.ts`
- `commands.ts`
- `fixtures.ts`
- host adapters

## Taxonomies

## Taxonomies As Aggregators

Taxonomies should exist, but they should not be the main place where types are
stored. They should aggregate many type directories.

Recommended layout:

```text
graph/src/taxonomy/
  core.ts
  company.ts
  env-vars.ts
  outliner.ts
  workspace.ts
```

Example:

```ts
// graph/src/taxonomy/workspace.ts
export { workspace } from "../schema/app/workspace/workspace";
export { workspaceProject } from "../schema/app/workspace/workspace-project";
export { workspaceIssue } from "../schema/app/workspace/workspace-issue";
export { workspaceLabel } from "../schema/app/workspace/workspace-label";
export { workflowStatus } from "../schema/app/workspace/workflow-status";
export { workflowStatusCategory } from "../schema/app/workspace/workflow-status-category";
```

This keeps the taxonomy concept without making it compete with the per-type
directory model.

Taxonomy modules should aggregate only the root-safe parts of a slice. React
adapter exports stay under `@io/graph/react*`.

## Package Model

### `@io/graph`

Pure engine and shared authoring surface.

Owns:

- schema primitives
- stable ids
- bootstrap and core schema
- store and sync
- typed refs and queries
- validation lifecycle
- type modules
- reference policies
- namespaces and key ownership
- per-type schema directories
- pure object view specs
- pure workflow specs
- command descriptors
- optional reusable fixtures

Must not depend on:

- React
- browser APIs
- DOM tags
- OpenTUI
- HTTP transport
- app shell or route registration

### `@io/graph/react`

Host-neutral React bindings.

Owns:

- React hooks over `EntityRef` and `PredicateRef`
- field metadata extraction
- capability resolution
- generic object/workflow render orchestration
- React composition that is not tied to browser tags or terminal widgets

May depend on:

- `react`
- `@io/graph`

Must not depend on:

- `react-dom`
- browser input behavior
- OpenTUI packages

### `@io/graph/react-dom`

DOM-specific rendering and editing.

Owns:

- default HTML field viewers and editors
- filter operand editors using DOM widgets
- DOM-specific object and workflow surfaces
- optional route-fragment helpers

### `@io/graph/react-opentui`

OpenTUI-specific rendering and editing.

Owns:

- OpenTUI field and object adapters
- OpenTUI workflow surfaces
- terminal-specific layout and input behavior

### `@io/app`

App and proof composition.

Owns:

- namespace composition from registered modules
- shared runtime bootstrap
- shell, navigation, route selection, and route chrome
- server transport
- authority composition and process-level storage decisions
- experiment registries
- proof-only seed policy and demo data wiring
- product-specific route exposure and presentation

References:

- `../app/src/graph/app.ts`
- `../app/src/web/runtime.tsx`
- `../app/src/web/app-shell.tsx`
- `../app/src/experiments/contracts.ts`
- `../app/src/experiments/graph.ts`
- `../app/src/experiments/web.ts`
- `../app/src/authority.ts`
- `../app/src/server-app.ts`

## Why React In The Graph Workspace Is Viable

Putting React into the `graph` workspace is viable if "React in graph" means
"adapter entrypoints inside the same workspace" rather than "React in the
runtime core."

That model matches the current source better than either extreme:

- it keeps the engine contract from `graph/io/architecture.md` intact
- it lets type directories co-locate React code near the schema
- it allows OpenTUI to reuse React bindings where the components are host
  neutral
- it keeps DOM-specific code out of the host-neutral layer
- it does not require the `@io/graph` root export to re-export any React code

The current source already shows the host split:

- `../app/src/web/predicate.ts` and `../app/src/web/resolver.tsx` are mostly
  host-neutral React logic
- `../app/src/web/generic-fields.tsx` and
  `../app/src/web/generic-filter-editors.tsx` are DOM-specific

So the right split is not:

- React vs no React

It is:

- engine core vs React bindings vs host widgets

## Export Strategy

The `graph` workspace should export multiple subpaths.

Example target:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./react": "./src/react/index.ts",
    "./react-dom": "./src/react-dom/index.ts",
    "./react-opentui": "./src/react-opentui/index.ts"
  }
}
```

The root entry stays clean. The workspace still offers a unified module tree.

The important detail is that adapter subpaths re-export colocated React files
from the schema tree. The root entry does not.

## Responsibility Criteria

### Put it in `@io/graph` when it is:

- required to author or validate schema
- host-independent
- durable across app, web, and TUI
- meaningful without React
- part of the canonical graph or command model

Examples:

- `defineType(...)`
- `TypeModuleMeta`
- collection semantics
- reference policies
- namespace ownership rules
- object view specs
- workflow specs
- command descriptors

### Put it in `@io/graph/react` when it is:

- specifically React-based
- reusable across DOM and OpenTUI
- based on graph refs and specs rather than host widgets

Examples:

- `usePredicateValue(...)`
- `usePredicateField(...)`
- field capability resolution
- generic object view orchestration

### Put it in `@io/graph/react-dom` when it is:

- HTML form behavior
- browser event handling
- DOM-oriented links, inputs, and layout assumptions

### Put it in `@io/graph/react-opentui` when it is:

- terminal-specific rendering
- OpenTUI widget composition
- terminal input conventions

### Keep it in `@io/app` when it is:

- route ownership
- shell chrome
- HTTP endpoint wiring
- snapshot path, process config, and environment resolution
- app-specific authority composition
- proof/demo selection

## Field Rendering Architecture

### Keep metadata-driven field semantics in `@io/graph`

The current system already does this well:

- `TypeModuleMeta` defines display/editor kinds and formatting
- `TypeModuleFilter` defines typed filtering behavior
- collection semantics are already encoded in field metadata
- reference policies are encoded through `defineReferenceField(...)` and
  `../graph/src/graph/web-policy.ts`

References:

- `../graph/src/graph/type-module.ts`
- `../graph/src/graph/web-policy.ts`
- `../app/src/web/predicate.ts`

The field model should remain:

- schema owns semantic kinds
- adapter chooses a capability for that kind

### Move current reusable field logic into graph adapter subpaths

Move these files into the `graph` workspace, split by host:

- move `../app/src/web/predicate.ts` to `graph/src/react/predicate.ts`
- move `../app/src/web/resolver.tsx` to `graph/src/react/resolver.tsx`
- move `../app/src/web/bindings.ts` to `graph/src/react/bindings.ts`
- move `../app/src/web/mutation-validation.ts` to `graph/src/react/`
- move host-neutral parts of `../app/src/web/filter.tsx` to
  `graph/src/react/filter.tsx`
- move `../app/src/web/generic-fields.tsx` to `graph/src/react-dom/fields.tsx`
- move `../app/src/web/generic-filter-editors.tsx` to
  `graph/src/react-dom/filter-editors.tsx`

### Per-type renderer placement

Do not make `views.tsx` the only UI file in a type directory. That will become
quietly DOM-specific.

Use:

- `views.ts` for host-neutral specs
- `react.tsx` for host-neutral React
- `react-dom.tsx` for browser widgets
- `react-opentui.tsx` for terminal widgets

## Object View Architecture

### Root object view specs in `@io/graph`

Object-level rendering should not start as one giant JSX surface. It should
start as a pure view spec that captures reusable semantics.

Suggested shape:

```ts
export type ObjectViewSpec = {
  key: string;
  entity: string;
  titleField?: string;
  subtitleField?: string;
  sections: readonly {
    key: string;
    title: string;
    description?: string;
    fields: readonly {
      path: string;
      label?: string;
      description?: string;
      span?: 1 | 2;
    }[];
  }[];
  related?: readonly {
    key: string;
    title: string;
    relationPath: string;
    presentation: "list" | "table" | "board";
  }[];
  commands?: readonly string[];
};
```

This spec belongs beside the type because it is:

- schema-adjacent
- reusable across hosts
- understandable without React

### React object views in adapter files

Then add:

- `react.tsx` for host-neutral orchestration
- `react-dom.tsx` for browser surfaces
- `react-opentui.tsx` for terminal surfaces

This allows a type to choose between:

- spec-only rendering
- partially overridden rendering
- fully custom surfaces where needed

## Workflow Architecture

### Two workflow classes

There are two different workflow classes and they should be modeled
differently.

#### Type-local workflows

Examples:

- issue editing
- project creation
- label management
- organization settings

These should live beside the relevant type or immediately beside the small set
of tightly related types.

#### Cross-taxonomy workflows

Examples:

- sign-up
- login
- create organization and initial workspace
- invite member
- grant access

These should live in dedicated workflow modules that compose many types and
commands rather than being buried in one type directory.

Suggested layout:

```text
graph/src/workflow/
  auth/
  onboarding/
  membership/
```

### Workflow spec shape

Suggested root contract:

```ts
export type WorkflowSpec = {
  key: string;
  label: string;
  description: string;
  subjects: readonly string[];
  steps: readonly {
    key: string;
    title: string;
    description?: string;
    objectView?: string;
    command?: string;
  }[];
  commands?: readonly string[];
};
```

Keep workflow specs declarative. They should describe structure and reusable
semantics, not attempt to replace all explicit UI with a metadata language.

## Command And Authority Architecture

### Root command descriptors in `@io/graph`

The direction in `../graph/io/authority.md` is correct: command authoring should
stay close to the subject type, but authoritative execution must still cross an
explicit boundary.

Suggested command shape:

```ts
export type GraphCommandSpec = {
  key: string;
  label: string;
  subject?: string;
  execution: "localOnly" | "optimisticVerify" | "serverOnly";
  input: unknown;
  output: unknown;
  policy?: {
    capabilities?: readonly string[];
    touchesPredicates?: readonly string[];
  };
};
```

In the short term:

- command descriptors live in `@io/graph`
- authoritative implementations stay in `app`

Later, if a reusable server runtime becomes real, the `graph` workspace can add
another subpath such as `@io/graph/server`.

## Current env-var implication

The env-var proof already demonstrates the right runtime line:

- graph-safe metadata in `../graph/src/schema/app/env-vars/`
- server-only secret mutation in `../app/src/authority.ts`
- explicit transport in `../app/src/server-app.ts`

That should remain true after modularity cleanup.

The change is authoring shape, not trust shape:

- the env-var type directories can define schema and command descriptors in
  `graph`
- the `saveEnvVar` implementation can remain in `app` until a shared server
  runtime exists

## App Schema Layout

## Canonical Schema Lives In `graph`

The canonical, reusable schema tree should live in the `graph` workspace.

The app should not use experiment files as the long-term home of type
definitions.

## `app` keeps a small app schema tree

Use `app/src/schema/` as the app-facing place to see:

- which reusable namespaces and types are included
- which app-local types still exist

Recommended layout:

```text
app/src/schema/
  index.ts
  modules.ts
  local/
    status/
      type.ts
      meta.ts
      filter.ts
      index.ts
```

Then:

- `app/src/schema/modules.ts` lists which `graph` modules the app composes
- `app/src/graph/app.ts` stays tiny and just calls `defineNamespace(...)`

This gives one app-owned overview tree without making `app` the canonical home
for all reusable schema.

## Experiment Structure In `app`

The experiment contract from `../app/io/experiments.md` is sound and should
stay, but the source should actually follow it.

Target layout:

```text
app/src/experiments/workspace/
  graph.ts
  seed.ts
  web.ts
  screen.tsx
  authority.ts
```

Rules:

- `graph.ts` imports reusable types or taxonomies and registers them for the
  experiment
- `seed.ts` stays proof/demo oriented
- `web.ts` only registers routes
- `screen.tsx` contains app-owned route composition if still needed
- `authority.ts` contains app-owned server bindings if that slice has
  authority-only behavior

If a reusable graph-owned module needs shared sample data, call that file
`fixtures.ts` in `graph` so it does not get confused with app-owned experiment
`seed.ts`.

As this matures, `app/src/web/*` should shrink to:

- `runtime.tsx`
- `app-shell.tsx`
- route resolution helpers
- app-wide layout primitives

The current flat reusable UI files should leave `app`.

## Concrete Workspace Proposal

The workspace slice is the best pilot because it is already the strongest
current candidate for a reusable domain module.

Recommended schema layout:

```text
graph/src/schema/app/workspace/
  workspace/
  workspace-project/
  workspace-issue/
  workspace-label/
  workflow-status/
  workflow-status-category/
```

Recommended aggregate taxonomy:

```text
graph/src/taxonomy/workspace.ts
```

Recommended first moves:

- keep canonical schema in `../graph/src/schema/app/workspace/` and keep
  `../app/src/experiments/workspace/graph.ts` as a thin registration wrapper
- extract any reusable sample builders from
  `../app/src/experiments/workspace/seed.ts` into `fixtures.ts`
- split `../app/src/web/workspace.tsx` into:
  - per-type `views.ts`
  - per-type `react.tsx`
  - per-type `react-dom.tsx`
  - any cross-type workspace workflow module if needed

Keep in `app`:

- route path and group selection
- shell title and route theming
- proof/demo exposure

## Concrete Env-Var Proposal

The env-var slice is partly reusable, but it is also product and operator
specific.

Recommended schema layout:

```text
graph/src/schema/app/env-vars/
  env-var/
  secret-ref/
```

Recommended split:

- root graph exports:
  - `envVar`
  - `secretRef`
  - `saveEnvVarCommand`
  - any reusable view spec
- keep in `app`:
  - `createAppAuthority(...)`
  - snapshot path resolution
  - secret storage backend
  - HTTP route registration

This respects the current authority split documented in `../app/io/env-vars.md`.

## Route Registration Hooks

Route registration should not be part of the type root or taxonomy root.

Route registration depends on:

- app path choices
- shell grouping
- title and description tone
- route theming
- whether a taxonomy is even exposed in a given product

If route helpers are useful, they should live only in host adapter entries and
stay optional.

## OpenTUI Implication

OpenTUI can absolutely use the React bindings, but only at the correct layer.

Good reuse:

- `@io/graph/react` hooks
- object and workflow composition that does not directly emit DOM tags
- type-specific React orchestration

Not directly reusable:

- DOM editors and viewers from the current `generic-fields.tsx`
- browser-specific input assumptions

This is why the adapter model needs both:

- `@io/graph/react`
- `@io/graph/react-opentui`

The two hosts can share graph logic and React orchestration without pretending
they share widgets.

## Naming Cleanup

The current file `../graph/src/graph/web-policy.ts` encodes reference selection
policy, not actually web rendering. Once the adapter split lands, the name will
be misleading.

Recommended rename:

- from `web-policy.ts`
- to `reference-policy.ts`

or another name that describes data-level policy rather than web behavior.

## Clear Implementation Plan

## Phase 1: Introduce Namespaces And Per-Type Directories

Goal:

- create a schema layout that can grow without inventing speculative
  namespaces too early

Steps:

1. Decide and document initial namespace ownership.
2. Create `graph/src/schema/core/` and `graph/src/schema/app/<slice>/` layout.
3. Move a few representative reusable types into that structure.
4. Keep thin `index.ts` re-exports so callers are not forced to update every
   import at once.
5. Document the rule that reusable graph-owned types should not live long-term
   in `app/src/experiments/*`.

Expected result:

- the schema becomes browseable as one tree
- type ownership becomes explicit
- the proposal stays aligned with the codebase we actually have

## Phase 2: Create Graph React Adapter Subpaths

Goal:

- move reusable React binding and DOM widget code out of `app`
- preserve behavior
- avoid changing the core engine contract

Steps:

1. Add `./react`, `./react-dom`, and `./react-opentui` exports to
   `graph/package.json`.
2. Create:
   - `graph/src/react/`
   - `graph/src/react-dom/`
   - `graph/src/react-opentui/`
3. Move host-neutral files from `app/src/web/` into `graph/src/react/`.
4. Move DOM-specific files into `graph/src/react-dom/`.
5. Update `app` imports to consume the new graph adapter subpaths.
6. Move or duplicate the relevant tests so the adapter code is tested in the
   `graph` workspace.

Expected result:

- `app` stops owning reusable field/filter infrastructure
- `graph` root remains unchanged in responsibility

## Phase 3: Make Experiments Actually Co-Located

Goal:

- align source layout with `../app/io/experiments.md`

Steps:

1. Move experiment screens out of `app/src/web/` and into their experiment
   folders.
2. Keep `app/src/web/` only for shared shell/runtime concerns.
3. Update `app/src/experiments/*/web.ts` to point at local experiment screens.

Expected result:

- each experiment becomes easy to find and reason about
- `app` still owns app composition while experiments own their route surfaces

## Phase 4: Add Object View, Workflow, And Command Contracts

Goal:

- create reusable authoring units above raw type definitions

Steps:

1. Add root-level `ObjectViewSpec`, `WorkflowSpec`, and `GraphCommandSpec`.
2. Keep them declarative and host-independent.
3. Rename `web-policy.ts` to a more accurate data/policy name.
4. Document these contracts in graph docs next to
   `../graph/io/type-modules.md` and `../graph/io/refs-and-ui.md`.

Expected result:

- reusable schema modules can bring their own rendering and workflow semantics
- those semantics remain portable across DOM and TUI

## Phase 5: Pilot The Model On Workspace Types

Goal:

- turn the workspace proof into the first real reusable slice under the current
  `app:` namespace

Steps:

1. Move workspace-related types into `graph/src/schema/app/workspace/`.
2. Add `graph/src/taxonomy/workspace.ts`.
3. Split the current workspace screen into:
   - per-type object view specs
   - per-type or small cross-type workflows
   - host-neutral React composition
   - DOM-specific surfaces
4. Update the app experiment to import the reusable workspace module.

Expected result:

- the workspace slice becomes the reference shape for future promotions

## Guardrails And Failure Modes

### Failure mode: React leaks into the runtime core

Avoid:

- React imports from the `@io/graph` root
- DOM assumptions in root specs and type definitions

### Failure mode: host-neutral React becomes secretly DOM-specific

Avoid:

- `<input>`, `<textarea>`, `<select>`, `<a>`, browser events, and CSS assumptions
  in `@io/graph/react`

### Failure mode: speculative namespaces appear before the code needs them

Avoid:

- creating `geo:`, `locale:`, `finance:`, `collab:`, or similar namespaces as
  placeholders before they have real reusable modules behind them

Rule:

- keep today's shared built-ins in `core:`
- promote a slice out of `app:` only when the code, imports, and docs justify it

### Failure mode: taxonomies compete with type directories

Avoid:

- storing canonical type definitions under `taxonomy/*`

Rule:

- canonical type definitions live under `schema/<namespace>/.../<type>/`
- taxonomies aggregate them

### Failure mode: metadata becomes a second UI language

Avoid:

- trying to encode every custom UI decision into object or workflow specs

Rule:

- keep specs declarative and narrow
- allow explicit component overrides early

### Failure mode: commands drift back into route code

Avoid:

- implementing business rules only in app screens
- tying domain invariants to browser-only flows

### Failure mode: cross-taxonomy workflows get buried in one type directory

Avoid:

- putting `sign-up`, `login`, or onboarding into one type folder

## Recommended End State

The recommended end state is:

- `@io/graph` root stays pure and durable
- the `graph` workspace ships React and host adapters through subpaths
- physical colocation stays separate from package export ownership
- namespaces stay intentionally small until real reusable slices justify
  promotion
- one directory per type becomes the primary authoring model
- taxonomies become aggregate modules, not the canonical storage layout
- current shared built-ins remain in `core:`
- `app` becomes composition, shell, transport, and authority glue
- experiment code in `app` becomes genuinely co-located
- DOM and OpenTUI share graph logic and host-neutral React without forcing the
  same widget layer

This model preserves the current documented engine boundary while making room
for the much larger schema surface the system is aiming toward.
