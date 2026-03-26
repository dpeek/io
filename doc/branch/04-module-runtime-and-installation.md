# Branch 4 Canonical: Module Runtime And Installation

## Overview

### Mission

Turn schema, views, commands, workflows, and ingest hooks into installable
modules with explicit manifests, migrations, and permissions.

### Why This Is A Separate Branch

The platform only becomes extensible when modules are a real install unit.
Without this branch, every new product slice remains hard-wired into the repo.

### In Scope

- module manifest shape
- install, update, and uninstall flow
- compatibility checks
- schema and data migrations
- permission requests at install time
- registration of views, commands, workflows, indexes, and connectors
- support for built-in and local modules first

### Out Of Scope

- large public module marketplace
- signed remote bundles
- full trust and sandboxing hardening for third-party code

### Durable Contracts Owned

- module manifest format
- module compatibility contract
- install-time permission request format
- module registration interfaces for views, commands, workflows, and indexes
- migration and rollback hooks

### Likely Repo Boundaries

- `src/graph/modules/`
- future module runtime and installer packages
- web module host registration surfaces
- agent workflow and command registration surfaces

### Dependencies

- Branch 1 for schema and graph primitives
- Branch 2 for permission and capability model

### Downstream Consumers

- Branch 5 needs a way for blob and ingest families to register
- Branch 6 needs workflow and command descriptors to become real module
  contracts
- Branch 7 needs module-host surfaces and install UX

### First Shippable Milestone

Support installation of one local module that adds schema, one view, one
command, and one index with no manual wiring outside the installer.

### Done Means

- the module declares what it adds and what it requires
- install applies schema and required migrations
- the runtime registers the view, command, and index
- uninstall or upgrade paths are documented, even if minimal

### First Demo

Install a local module and immediately see its route, editor, and command show
up in the existing web shell.

### What This Unlocks

- blob-backed module families in Branch 5
- workflow-native modules in Branch 6
- a real module host in Branch 7

### Source Anchors

- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/08-vision-overview.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`

The remainder of this document defines the implementation contract for
installable modules in `io`.

Today the repo already has schema-local type modules, pure object-view,
workflow, and command descriptors, and a web authority that hardcodes one graph
assembly from `core`, `ops`, and `pkm`. Branch 4 owns the missing layer that
makes those slices into explicit install units with versioning, permissions,
migrations, and rebuildable runtime registration.

## 1. Purpose

Branch 4 owns the graph-scoped module lifecycle:

- discovery of installable modules from trusted built-in and local sources
- compatibility checks against graph, authority, web-host, and agent-host
  contract versions
- install, update, deactivate, and uninstall orchestration
- install-time permission requests and grant recording
- schema application and module-owned data migrations
- runtime registration of views, commands, workflows, indexes, and connectors

This branch exists separately because the current repo already proves module-
shaped authoring, but not module-shaped activation. Without Branch 4, new
schema or UI slices still require manual wiring in source files such as
`src/web/lib/authority.ts` and static route composition in `src/web/routes/`.

The platform outcome is simple: one graph should be able to install a module
and have that module become active through authoritative, inspectable, and
rebuildable state rather than by hidden repo edits.

## 2. Scope

### In scope

- canonical manifest shape for installable modules
- trusted source model for built-in and local modules
- graph-level installed-module ledger
- compatibility planning before activation
- install-time permission request format and grant recording
- module schema registration and migration execution
- activation and deactivation of view, command, workflow, index, and connector
  registrations
- authoritative install status, failure status, and runtime rebuild behavior

### Out of scope

- public marketplace discovery
- signed remote bundles
- untrusted third-party sandboxing or isolation hardening
- Branch 2 policy evaluation internals
- Branch 3 query planner and projection execution internals
- Branch 5 ingest pipeline internals
- Branch 6 workflow execution internals
- Branch 7 shell chrome and polished install UX

### Assumptions inherited from upstream branches

- Branch 1 provides stable schema namespace fragments, bootstrap/apply rules,
  stable ids, and authoritative transaction semantics.
- Branch 2 provides the capability model used to interpret permission
  requests and authorize install/update/uninstall actions.
- Branch 3 provides index and projection contracts before collection-heavy
  module surfaces are treated as stable.

## 3. Core Model

Branch 4 distinguishes between a module package that exists in code, a manifest
that declares its contract, and an installed-module record that captures graph-
local activation state.

```ts
type SchemaNamespaceFragment = unknown; // owned by Branch 1
type ProjectionRegistration = unknown; // owned by Branch 3
type ConnectorRegistration = unknown; // owned by Branch 5

export type ModuleSourceKind = "builtin" | "local" | "git" | "remote";

export type ModuleInstallState =
  | "discovered"
  | "installing"
  | "active"
  | "upgrade-pending"
  | "uninstalling"
  | "inactive"
  | "failed";

export interface ModuleCompatibility {
  readonly graph: string;
  readonly authority?: string;
  readonly webHost?: string;
  readonly agentHost?: string;
}

export type ModulePermissionKey = string;

type ModulePermissionRequestBase = {
  readonly key: ModulePermissionKey;
  readonly reason: string;
  readonly required: boolean;
};

export type ModulePermissionRequest =
  | (ModulePermissionRequestBase & {
      readonly kind: "predicate-read";
      readonly predicateIds: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "predicate-write";
      readonly predicateIds: readonly string[];
      readonly writeScope: "client-tx" | "server-command" | "authority-only";
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "command-execute";
      readonly commandKeys: readonly string[];
      readonly touchesPredicates?: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "secret-use";
      readonly capabilityKeys: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "share-admin";
      readonly surfaceIds?: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "external-service";
      readonly serviceKeys: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "background-job";
      readonly jobKeys: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "blob-class";
      readonly blobClassKeys: readonly string[];
    });

export type PrincipalRoleBinding = {
  readonly id: string;
  readonly principalId: string;
  readonly roleKey: string;
  readonly status: "active" | "revoked";
};

export type ModulePermissionGrantResource = {
  readonly kind: "module-permission";
  readonly permissionKey: ModulePermissionKey;
};

export type ModulePermissionLowering =
  | {
      readonly kind: "capability-grant";
      readonly grant: {
        readonly id: string;
        readonly resource: ModulePermissionGrantResource;
        readonly status: "active" | "expired" | "revoked";
      };
    }
  | {
      readonly kind: "role-binding";
      readonly binding: PrincipalRoleBinding;
    };

export type ModulePermissionApprovalRecord =
  | {
      readonly moduleId: string;
      readonly permissionKey: ModulePermissionKey;
      readonly request: ModulePermissionRequest;
      readonly status: "approved";
      readonly decidedAt: string;
      readonly decidedByPrincipalId: string;
      readonly note?: string;
      readonly lowerings: readonly [ModulePermissionLowering, ...ModulePermissionLowering[]];
    }
  | {
      readonly moduleId: string;
      readonly permissionKey: ModulePermissionKey;
      readonly request: ModulePermissionRequest;
      readonly status: "denied";
      readonly decidedAt: string;
      readonly decidedByPrincipalId: string;
      readonly note?: string;
      readonly lowerings: readonly [];
    }
  | {
      readonly moduleId: string;
      readonly permissionKey: ModulePermissionKey;
      readonly request: ModulePermissionRequest;
      readonly status: "revoked";
      readonly decidedAt: string;
      readonly decidedByPrincipalId: string;
      readonly note?: string;
      readonly revokedAt: string;
      readonly revokedByPrincipalId: string;
      readonly revocationNote?: string;
      readonly lowerings: readonly [ModulePermissionLowering, ...ModulePermissionLowering[]];
    };

export interface ModuleSetupField {
  readonly key: string;
  readonly label: string;
  readonly kind: "string" | "boolean" | "enum" | "secret";
  readonly required: boolean;
  readonly options?: readonly string[];
}

export interface ModuleMigrationDescriptor {
  readonly id: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly description: string;
}

export interface ModuleInstallRequest {
  readonly moduleId: string;
  readonly version?: string;
  readonly sourceLocator?: string;
  readonly setup?: Readonly<Record<string, unknown>>;
  readonly grantKeys?: readonly ModulePermissionKey[];
}

export interface ModuleContributionInventory {
  readonly namespaces: readonly string[];
  readonly objectViews: readonly string[];
  readonly workflows: readonly string[];
  readonly commands: readonly string[];
  readonly indexes: readonly string[];
  readonly connectors: readonly string[];
}

export interface ModuleInstallPlan {
  readonly moduleId: string;
  readonly version: string;
  readonly bundleDigest: string;
  readonly compatibilityOk: boolean;
  readonly requiredPermissions: readonly ModulePermissionKey[];
  readonly optionalPermissions: readonly ModulePermissionKey[];
  readonly migrations: readonly string[];
  readonly contributions: ModuleContributionInventory;
}

export interface ModuleManifest {
  readonly id: string;
  readonly version: string;
  readonly installMode: "system" | "optional";
  readonly source: {
    readonly kind: ModuleSourceKind;
    readonly locator: string;
  };
  readonly compatibility: ModuleCompatibility;
  readonly dependsOn?: readonly string[];
  readonly namespaces: readonly string[];
  readonly objectViews?: readonly string[];
  readonly workflows?: readonly string[];
  readonly commands?: readonly string[];
  readonly indexes?: readonly string[];
  readonly connectors?: readonly string[];
  readonly permissions?: readonly ModulePermissionRequest[];
  readonly setup?: readonly ModuleSetupField[];
  readonly migrations?: readonly ModuleMigrationDescriptor[];
  readonly uninstall?: {
    readonly mode: "deactivate-only" | "cleanup-optional";
  };
}

export interface GraphModuleBundle {
  readonly manifest: ModuleManifest;
  readonly schema?: Readonly<Record<string, SchemaNamespaceFragment>>;
  readonly objectViews?: Readonly<Record<string, ObjectViewSpec>>;
  readonly workflows?: Readonly<Record<string, WorkflowSpec>>;
  readonly commands?: Readonly<Record<string, GraphCommandSpec>>;
  readonly indexes?: Readonly<Record<string, ProjectionRegistration>>;
  readonly connectors?: Readonly<Record<string, ConnectorRegistration>>;
  readonly migrations?: readonly ModuleMigration[];
}

export interface ModuleMigration {
  readonly id: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  run(context: ModuleMigrationContext): Promise<void>;
}

export interface ModuleMigrationContext {
  readonly moduleId: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly setup: Readonly<Record<string, unknown>>;
  readonly authority: unknown;
}

export interface InstalledModuleRecord {
  readonly moduleId: string;
  readonly version: string;
  readonly sourceKind: ModuleSourceKind;
  readonly sourceLocator: string;
  readonly bundleDigest: string;
  readonly state: ModuleInstallState;
  // Stable subset of declared permission keys backed by active approved
  // ModulePermissionApprovalRecord rows.
  readonly grantedPermissions: readonly ModulePermissionKey[];
  readonly installedAt?: string;
  readonly updatedAt: string;
  readonly lastSuccessfulMigration?: string;
  readonly lastError?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface ModuleInstallResult {
  readonly record: InstalledModuleRecord;
  readonly activatedContributions: ModuleContributionInventory;
  readonly warnings?: readonly string[];
}

export interface ModuleUninstallRequest {
  readonly moduleId: string;
  readonly mode?: "deactivate" | "cleanup";
}

export interface ModuleUninstallResult {
  readonly moduleId: string;
  readonly state: "inactive" | "removed";
  readonly removedContributions: ModuleContributionInventory;
  readonly warnings?: readonly string[];
}
```

### Main entities

- `ModuleManifest`: the durable declarative contract. It is pure data and must
  be readable without executing host code, including its
  `permissions: ModulePermissionRequest[]` payload.
- `GraphModuleBundle`: the loadable package surface. It contains the manifest
  plus the concrete contributions the runtime can activate.
- `InstalledModuleRecord`: the authoritative graph-local state. It captures
  which module version is active, from which source, with which permission
  grants, and with which failure status.
- `ModuleMigration`: the executable forward-migration hook between versions.

### Identifiers

- `manifest.id` is the stable module identifier across versions.
- `ModulePermissionRequest.key` is the stable manifest-scoped permission
  identifier reused by install plans, approval review, durable grants, and
  revocation.
- contribution keys inside `objectViews`, `workflows`, `commands`, `indexes`,
  and `connectors` are stable public ids within the graph.
- `bundleDigest` is a content-derived lock value for one concrete bundle build
  or local source snapshot.

### Lifecycle states

- `discovered`: the runtime can load the bundle, but the graph has not
  installed it.
- `installing`: compatibility checks passed and authoritative activation is in
  progress.
- `active`: the installed version is authoritative and its registrations are
  live.
- `upgrade-pending`: a newer compatible bundle exists, but migration has not
  completed.
- `uninstalling`: deactivation or cleanup is in progress.
- `inactive`: the graph intentionally has the module disabled.
- `failed`: the graph remembers the install intent, but activation or rebuild
  failed.

### Relationships

- one `InstalledModuleRecord` points to exactly one active `(moduleId,
version, bundleDigest)` tuple
- one `ModuleManifest` may declare zero or more contributions, but every
  declared key must resolve to a bundle export when activated
- `installMode: "system"` marks modules that bootstrap the graph itself and may
  not be uninstalled; `core:` belongs in this class
- `installMode: "optional"` marks feature modules such as `ops/env-var` or
  `pkm/topic`

## 4. Public Contract Surface

### `ModuleManifest`

- Purpose: pure declarative contract for install, update, permission review,
  compatibility checks, and runtime introspection.
- Caller: module catalog, install UI, agent tooling, authority installer.
- Callee: authoritative install coordinator.
- Inputs: JSON-serializable module metadata.
- Outputs: compatibility plan, permission review, and contribution inventory.
- Failure shape: manifest schema error, duplicate ids, unsupported compatibility
  target, or contribution mismatch.
- Stability: `stable`.

### `GraphModuleBundle`

- Purpose: loadable module package that binds one manifest to actual schema,
  views, workflows, commands, indexes, connectors, and migration hooks.
- Caller: module catalog and runtime bootstrap.
- Callee: module package entrypoint.
- Inputs: bundle import or local module load.
- Outputs: manifest plus contribution records.
- Failure shape: import error, missing declared export, duplicate contribution
  key, or digest mismatch.
- Stability: `stable` for `builtin` and `local`, `future` for `git` and
  `remote`.

### `ModulePermissionRequest`

- Purpose: canonical manifest-facing install-time permission declaration shared
  by Branch 4 planning and Branch 2 approval.
- Caller: module authors, module catalog, install planner, permission review UI.
- Callee: authoritative install coordinator and Branch 2 policy runtime.
- Inputs: stable `key`, `required`, `reason`, and kind-specific target fields.
- Outputs: approval or denial keyed by `ModulePermissionKey`.
- Failure shape: malformed request, duplicate `key`, unsupported kind, or
  Branch 2 policy denial.
- Stability: `stable` for `predicate-read`, `predicate-write`,
  `command-execute`, `secret-use`, the shared `key` space, and lowering to
  `module-permission` grants; `provisional` for `share-admin`,
  `external-service`, `background-job`, and `blob-class` details.

Permission contract rules:

- `ModuleManifest.permissions` uses the same `ModulePermissionRequest` union
  Branch 2 evaluates; Branch 4 does not define a second manifest permission
  shape.
- installers review, plan, and persist decisions by `ModulePermissionRequest.key`
  even when the human-facing UI groups or labels requests differently.
- approval lowers every granted request into the shared grant key space as
  `CapabilityResource = { kind: "module-permission", permissionKey: request.key }`.
- approved results must persist at least one explicit lowering to a
  `module-permission` capability grant or reusable role binding.
- denied results persist the reviewed request with `lowerings = []`; denial is
  durable state, not the absence of a row.
- revocation updates the durable approval record and revokes or deactivates the
  referenced grants or role bindings instead of silently dropping prior review
  state.
- `command-execute.touchesPredicates`, when present, is review metadata only;
  the referenced `GraphCommandSpec.policy` remains the authoritative command
  policy contract.

### `ModulePermissionApprovalRecord`

- Purpose: durable current-state review record for one declared
  `ModulePermissionKey`.
- Caller: install coordinator, permission review UI, restart rebuild, audit
  tooling.
- Callee: authority persistence plus Branch 2 lowering.
- Inputs: `moduleId`, reviewed `request`, explicit lowerings, decision actor,
  and approval/denial/revocation status.
- Outputs: authoritative approval result consumed by install activation and
  later revocation flows.
- Failure shape: `permission-denied`, `grant.invalid`, or invalid lowering
  shape.
- Stability: `stable` for approval, denial, revocation, and explicit lowering
  references.

### `ModuleInstaller`

```ts
export interface ModuleInstaller {
  discover(): Promise<readonly ModuleManifest[]>;
  listInstalled(): Promise<readonly InstalledModuleRecord[]>;
  planInstall(input: ModuleInstallRequest): Promise<ModuleInstallPlan>;
  applyInstall(plan: ModuleInstallPlan): Promise<ModuleInstallResult>;
  uninstall(input: ModuleUninstallRequest): Promise<ModuleUninstallResult>;
}
```

- Purpose: authoritative orchestration surface for install, upgrade, and
  uninstall.
- Caller: Branch 7 operator surfaces, CLI, automation, tests.
- Callee: graph directory or current single-authority install coordinator.
- Inputs: module id, requested version or source, setup values, and permission
  grants.
- Outputs: plan, status, applied record, and failure metadata.
- Failure shape: `compatibility-failed`, `permission-denied`,
  `migration-failed`, `bundle-unavailable`, `activation-failed`.
- Stability: `stable`.

### `ModuleRuntimeRegistry`

```ts
export interface ModuleRuntimeRegistry {
  registerSchema(namespace: string, fragment: SchemaNamespaceFragment): void;
  registerObjectView(key: string, spec: ObjectViewSpec): void;
  registerWorkflow(key: string, spec: WorkflowSpec): void;
  registerCommand(key: string, spec: GraphCommandSpec): void;
  registerIndex?(key: string, spec: ProjectionRegistration): void;
  registerConnector?(key: string, spec: ConnectorRegistration): void;
}
```

- Purpose: activation boundary between installed-module state and live runtime
  surfaces.
- Caller: install coordinator and runtime bootstrap.
- Callee: graph runtime, web host, agent host, projection runtime, and ingest
  runtime.
- Inputs: validated contributions from one active bundle.
- Outputs: rebuilt in-memory registries and host-visible capabilities.
- Failure shape: duplicate registration, missing host capability, invalid schema
  fragment, or downstream registry error.
- Stability: `stable` for schema, object view, workflow, and command
  registration; `provisional` for indexes and connectors until Branches 3 and 5
  finish their concrete contracts.

### `ModuleMigration`

- Purpose: versioned forward migration hook for schema or data changes owned by
  one module.
- Caller: authoritative install coordinator.
- Callee: module bundle migration implementation.
- Inputs: current installed version, target version, graph authority context,
  and setup state.
- Outputs: completed migration run and checkpoint metadata.
- Failure shape: validation error, idempotency violation, dependency mismatch,
  or unexpected authority write failure.
- Stability: `stable` for forward migrations, `provisional` for rollback beyond
  deactivation.

### `InstalledModuleRecord`

- Purpose: authoritative read model of graph-local module state.
- Caller: runtime bootstrap, operator UI, observability, agents.
- Callee: directory control plane or current authority storage.
- Inputs: authoritative updates from install or uninstall flows.
- Outputs: deterministic rebuild seed for runtime registries.
- Failure shape: missing bundle for active record, digest mismatch, or
  impossible state transition.
- Stability: `stable`.

## 5. Runtime Architecture

The runtime splits authoritative install state from rebuildable host
registrations.

```text
[Module Catalog: builtin/local]
               |
               v
     [Install Coordinator]
        |   |        |
        |   |        +--> permission review / setup validation
        |   |
        |   +--> schema apply + migrations on graph authority
        |
        +--> persist InstalledModuleRecord / migration runs
               |
               v
      [Derived Runtime Registries]
        |          |           |
        v          v           v
     web host   agent host   index/connector runtimes
```

### Process boundaries

- The authoritative install coordinator runs in the same trust boundary as the
  graph authority. In the roadmap end state that is the graph directory object
  or a dedicated install coordinator Durable Object.
- The module catalog runs in the deployment process and loads trusted built-in
  or local module bundles from source or packaged output.
- Web and agent hosts consume derived registries only. They do not decide
  installation state.
- Browsers and external clients never execute install logic directly. They call
  install APIs and consume sanitized installed-module state.

### Authoritative versus derived state

- Authoritative: `InstalledModuleRecord`, permission grants, migration-run
  ledger, and any setup values that are safe to store in control-plane records.
- Derived: active schema namespaces, object-view registry, workflow registry,
  command registry, index registrations, connector registrations, and any route
  tables built from them.

### Local versus remote responsibilities

- Local to deployment: bundle discovery, digesting, and code loading.
- Remote to graph authority: install decision, state transition, schema apply,
  migration execution, and active-version record.

### Current repo mapping

- `src/graph/runtime/contracts.ts` already provides root-safe
  `ModulePermissionRequest`, `ObjectViewSpec`, `WorkflowSpec`, and
  `GraphCommandSpec`.
- `src/graph/modules/` already provides built-in schema slices.
- `src/web/lib/authority.ts` currently hardcodes `{ ...core, ...pkm, ...ops }`
  into one runtime graph. Branch 4 replaces that hardcoded assembly with a
  registry built from installed module records.
- `src/web/routes/` currently uses static file routes. Branch 4 does not own
  route UX, but it must expose the registration data that lets Branch 7 host
  module-provided surfaces.

## 6. Storage Model

Branch 4 owns control-plane persistence for module lifecycle state. It does not
own fact storage itself.

### Canonical records

- `io_module_install`
  - one row per `(graph, module_id)`
  - fields: `module_id`, `version`, `install_mode`, `source_kind`,
    `source_locator`, `bundle_digest`, `state`, `config_json`,
    `installed_at`, `updated_at`, `disabled_at`, `last_error_code`,
    `last_error_message`
- `io_module_permission_grant`
  - one authoritative current-state row per declared permission key
  - fields: `module_id`, `permission_key`, `kind`, `status`, `request_json`,
    `lowerings_json`, `decided_at`, `decided_by`, `note`,
    `revoked_at`, `revoked_by`, `revocation_note`
- `io_module_migration_run`
  - append-oriented migration ledger
  - fields: `module_id`, `migration_id`, `from_version`, `to_version`,
    `status`, `checkpoint_json`, `started_at`, `finished_at`, `error_json`

### Retained history versus current state

- `io_module_install` is the authoritative current state.
- `io_module_migration_run` is retained history and must survive restart for
  debugging and idempotent recovery.
- permission grants are current policy decisions with audit value and should be
  retained rather than overwritten silently.

### Derived versus authoritative storage

- authoritative storage says which version is active
- derived runtime registries are rebuilt from authoritative rows plus the
  currently loadable bundle
- setup secrets are not stored in module control-plane tables; they go through
  Branch 2 secret or capability-managed authority paths and are referenced by
  handle only

### Rebuild rules

- on process start, load all `io_module_install` rows
- resolve each active row against the module catalog
- verify `bundle_digest` and manifest id/version match
- rebuild runtime registries from scratch
- if the bundle is missing or invalid, leave the install row authoritative but
  transition the runtime to `failed` rather than silently dropping the module

### Migration expectations

- migrations are forward-only in the stable contract
- every migration must be safe to retry after crash using checkpoint data
- uninstall does not imply data deletion
- if the current single-authority proof lacks dedicated tables, the same
  logical records may live in the persisted authority sidecar until the
  directory DO exists

## 7. Integration Points

### Branch 1: Graph Kernel And Authority

- Dependency direction: Branch 4 depends on Branch 1.
- Imported contracts: schema namespace fragments, bootstrap/apply semantics,
  stable ids, authoritative transaction apply, persisted authority storage.
- Exported contracts: module install orchestrates Branch 1 schema and data
  writes through a stable install API rather than manual bootstrapping.
- Provisional path: the current single-authority bootstrap is enough for the
  first built-in module proof.
- Must be stable before broad rollout: namespace collision rules, additive
  schema apply semantics, authoritative migration writes.

### Branch 2: Identity, Policy, And Sharing

- Dependency direction: Branch 4 depends on Branch 2 for permission evaluation.
- Imported contracts: capability vocabulary, install authorization, secret-use
  boundaries, principal-aware policy checks.
- Exported contracts: install-time permission requests and granted-permission
  records.
- Provisional path: a coarse operator-only install capability is sufficient for
  the first milestone.
- Must be stable before remote or secret-heavy modules: permission review
  result shape, manifest `permissionKey` lowering, and secret access
  boundaries.

### Branch 3: Sync, Query, And Projections

- Dependency direction: Branch 4 depends on Branch 3 for projection-backed
  collection surfaces.
- Imported contracts: index registration shape, rebuild semantics, live-scope
  dependency keys, projection observability.
- Exported contracts: module-declared indexes and install status for index
  readiness.
- Provisional path: one collection index and one rebuildable projection are
  enough for the first module demo.
- Must be stable before module-heavy collection UIs: projection registration,
  readiness, and rebuild contract.

### Branch 5: Blob, Ingestion, And Media

- Dependency direction: Branch 5 depends on Branch 4.
- Imported contracts: connector registration, provisional `blob-class`
  permission request details, module setup metadata, install lifecycle hooks.
- Exported contracts: install-time activation of blob-backed module families.
- Provisional path: connector registration can be a no-op for non-ingest
  modules.
- Must be stable before file and media families: connector registration and
  provisional background-job permission request details.

### Branch 6: Workflow And Agent Runtime

- Dependency direction: Branch 6 depends on Branch 4.
- Imported contracts: workflow and command registration, installed-module
  inventory, setup metadata, granted permissions.
- Exported contracts: graph-local activation of command and workflow
  descriptors.
- Provisional path: existing `WorkflowSpec` and `GraphCommandSpec` are enough
  to define the root-safe half of this contract now.
- Must be stable before graph-native workflow replaces Linear: command/workflow
  registration keys and activation timing.

### Branch 7: Web And Operator Surfaces

- Dependency direction: Branch 7 depends on Branch 4.
- Imported contracts: discoverable installable modules, installed-module
  records, setup fields, permission review data, and host registration state.
- Exported contracts: install UI, module-management pages, route hosting, and
  operator affordances around status and failure.
- Provisional path: a simple operator page that installs one local module is
  enough for the first milestone.
- Must be stable before polished UX: install planning API, installed-module
  read model, and route or view registration feed.

## 8. Main Flows

1. Install one built-in or local optional module.
   Initiator: operator via Branch 7 UI, CLI, or test harness.
   Components involved: module catalog, install coordinator, permission
   evaluator, graph authority, runtime registries.
   Contract boundaries crossed: install request, manifest validation,
   authoritative schema or migration apply, registry rebuild.
   Authoritative write point: `io_module_install`,
   `io_module_permission_grant`, and any module-owned graph writes from schema
   apply or migrations.
   Failure or fallback behavior: if any phase fails, the module never becomes
   publicly active; state is recorded as `failed` with error metadata.

2. Upgrade an installed module to a newer compatible version.
   Initiator: operator or automated rollout.
   Components involved: module catalog, install coordinator, migration runner,
   graph authority, runtime registries.
   Contract boundaries crossed: compatibility planning, migration chain,
   activation switchover.
   Authoritative write point: migration ledger plus replacement of the active
   `(version, bundleDigest)` in `io_module_install`.
   Failure or fallback behavior: the previously active version remains active
   until the new version completes migration and registry rebuild.

3. Deactivate or uninstall an optional module.
   Initiator: operator.
   Components involved: install coordinator, runtime registries, projection or
   connector runtimes, graph authority.
   Contract boundaries crossed: uninstall request, confirmation, deactivation,
   optional cleanup.
   Authoritative write point: `io_module_install.state = inactive` or removal
   of the row after explicit cleanup confirmation.
   Failure or fallback behavior: default stable behavior is deactivation only;
   module-owned data remains intact unless an explicit cleanup path is chosen.

4. Rebuild runtime state after process restart or deploy.
   Initiator: runtime bootstrap.
   Components involved: module catalog, install-record loader, runtime
   registries, graph bootstrap.
   Contract boundaries crossed: authoritative read of installed rows and local
   bundle resolution.
   Authoritative write point: none unless rebuild detects missing or invalid
   bundles and writes a `failed` state.
   Failure or fallback behavior: graph facts remain authoritative; only the
   affected module surface is withheld from activation.

5. Recover from an interrupted install or migration.
   Initiator: runtime bootstrap or operator retry.
   Components involved: migration ledger, install coordinator, graph authority.
   Contract boundaries crossed: checkpoint recovery and idempotent rerun.
   Authoritative write point: update the existing install or migration record,
   not a parallel duplicate.
   Failure or fallback behavior: repeated retries must not duplicate schema,
   contributions, or migration side effects.

## 9. Invariants And Failure Handling

### Invariants

- `moduleId` is stable across all versions of one logical module.
- `bundleDigest` must match the activated source; code drift without an
  explicit update is not silently accepted.
- declared contribution keys are globally unique per graph within their
  namespace and kind.
- a module is not visible as `active` until schema apply, permission recording,
  migrations, and registry rebuild have all succeeded.
- granted permissions are always an explicit subset of requested permissions.
- `system` modules cannot be uninstalled through the optional-module flow.
- uninstall defaults to non-destructive deactivation.
- runtime registries are fully rebuildable from authoritative install rows and
  locally available bundles.
- migrations are idempotent at the `(moduleId, migrationId)` level.

### Failure modes

- Manifest invalid or collisions detected.
  What fails: install planning.
  What must not corrupt: existing install rows and live registries.
  Retry or fallback: fix manifest and re-run plan.
  Observability needed: rejected install event with collision details.

- Permission denied.
  What fails: activation before authoritative writes.
  What must not corrupt: schema and install state.
  Retry or fallback: operator may re-run with different grants.
  Observability needed: denied-permission audit event.

- Migration crash or validation error.
  What fails: target version activation.
  What must not corrupt: previous active version and graph consistency.
  Retry or fallback: rerun from migration checkpoint or keep previous version
  active.
  Observability needed: migration run status, checkpoint, and error payload.

- Bundle missing on restart.
  What fails: runtime rebuild.
  What must not corrupt: authoritative graph facts and install intent.
  Retry or fallback: keep record authoritative but mark module `failed` until
  the bundle is restored.
  Observability needed: bundle-resolution failure with source locator and
  digest.

- Index or connector backend unavailable.
  What fails: module sub-surface activation for collection views or ingest.
  What must not corrupt: schema, entity reads, and installed-module record.
  Retry or fallback: hold those registrations in pending state while leaving
  safe local entity surfaces active where possible.
  Observability needed: per-registration readiness and backlog metrics.

## 10. Security And Policy Considerations

- Phase 1 trust boundary is intentionally narrow: only built-in and
  deployment-local modules are trusted to load code.
- Install, update, and uninstall actions require a Branch 2-managed graph
  capability for module administration.
- A manifest describes required permissions; it never grants them by itself.
- Secrets supplied during setup never live in browser-visible install rows.
  They must be written through authority-only secret surfaces and referred to by
  handle.
- `GraphCommandSpec.execution` remains authoritative. `serverOnly` commands and
  secret-backed mutations stay behind server routes or authority commands.
- Browser-visible installed-module data is sanitized to ids, versions, safe
  status, granted-permission summaries, and non-secret setup state.
- Provisional `external-service`, `background-job`, and `blob-class`
  permission kinds must still be explicit because they widen the trust boundary
  beyond pure graph mutation even before their downstream approval runtimes are
  fully standardized.

## 11. Implementation Slices

### Slice 1: Define the installable bundle contract

- Goal: add `ModuleManifest`, `GraphModuleBundle`, and bundle digesting for
  built-in and local modules.
- Prerequisite contracts: current `ObjectViewSpec`, `WorkflowSpec`,
  `GraphCommandSpec`, and Branch 1 namespace fragments.
- What it proves: existing built-ins can be represented as install units
  without changing graph semantics.
- What it deliberately postpones: migrations, permissions UI, and dynamic host
  activation.

### Slice 2: Add authoritative install records and planning

- Goal: persist `InstalledModuleRecord`, permission grants, and install-plan
  results behind one install coordinator.
- Prerequisite contracts: Slice 1 plus a coarse Branch 2 admin capability.
- What it proves: install state is graph-local and rebuildable rather than
  implied by source wiring.
- What it deliberately postpones: collection indexes and ingest connectors.

### Slice 3: Activate one demo module end to end

- Goal: install one optional local module that adds schema, one object view,
  one command, and one index declaration.
- Prerequisite contracts: Slices 1 and 2 plus provisional Branch 3 index
  registration.
- What it proves: the first shippable milestone from the branch brief.
- What it deliberately postpones: upgrade rollback and remote discovery.

### Slice 4: Add upgrade and restart rebuild behavior

- Goal: support versioned migration, startup rebuild from install rows, and
  faulted-module handling.
- Prerequisite contracts: migration ledger and idempotent migration hooks.
- What it proves: module state survives deploys and authority restarts.
- What it deliberately postpones: destructive uninstall cleanup.

### Slice 5: Hook the operator and agent hosts into the registry

- Goal: feed installed-module state to Branch 7 web hosting and Branch 6 agent
  registration surfaces.
- Prerequisite contracts: stable registry keys and installed-module read model.
- What it proves: installed modules become visible in real product surfaces
  without manual route or command wiring.
- What it deliberately postpones: marketplace UX and untrusted modules.

## 12. Open Questions

- Should compatibility use semver-style ranges, repo commit compatibility ids,
  or explicit contract-version constants per subsystem?
- Where should non-secret setup data live long term: control-plane install rows,
  graph entities, or both?
- Should route-level web registrations be eager at startup or lazy when the
  first matching module surface is requested?
- What is the right digest source for local modules during development so the
  runtime can detect drift without making reloads painful?
- When an index-backed module surface is installed but the index is still
  building, should the module be partially active or globally pending?
- Should uninstall ever support module-authored cleanup of graph data, or is
  disable-only the correct permanent default?
- How should dependency cycles between modules be rejected or broken without
  turning simple local modules into a package-manager problem?

## 13. Recommended First Code Targets

- `lib/graph-authority/src/contracts.ts` and `src/graph/definition-contracts.ts`
  Publish authority-owned permission contracts from `graph-authority`, and keep
  any remaining root-safe manifest or definition contracts in the small
  root-owned definition surface instead of reviving a mixed runtime bucket.
- `src/graph/def.ts` and `src/graph/index.ts`
  Export only the deliberate root-owned definition contracts from `def`, and
  keep the root graph surface curated instead of reintroducing a catch-all
  runtime barrel.
- `src/graph/modules/ops/env-var/module.ts`
  Wrap the existing env-var schema and secret-aware descriptors as the first
  optional built-in module bundle.
- `src/graph/modules/pkm/topic/module.ts`
  Wrap the existing topic slice as a second optional built-in bundle with one
  real object-view and workflow registration.
- `src/web/lib/module-catalog.ts` and `src/web/lib/module-installer.ts`
  Add trusted builtin or local discovery plus authoritative planning and
  activation logic here.
- `src/web/lib/authority.ts`, `src/web/lib/graph-authority-do.ts`, and
  `src/web/lib/server-routes.ts`
  Extend the existing web authority with installed-module storage and module
  install or uninstall endpoints.
