---
name: Graph authority installed modules
description: "Installed-module ledger validation and lifecycle planning in @io/graph-authority."
last_updated: 2026-04-03
---

# Graph authority installed modules

## Read this when

- you are changing `InstalledModuleRecord`, lifecycle planner output, or compatibility checks
- you need to understand how authored manifest identity lowers into the authoritative installed-module ledger
- you are wiring runtime rebuild or activation behavior above the shared planner seam

## Main source anchors

- `../src/contracts.ts`: installed-module contract types, validators, compatibility checks, and lifecycle planner
- `../src/contracts.test.ts`: planner and compatibility examples
- `../../graph-module/doc/module-stack.md`: cross-package manifest and
  built-in module ownership

## What this layer owns

- the authoritative installed-module ledger row
- the manifest-derived planner target
- runtime expectation checks for graph and runtime compatibility channels
- fail-closed compatibility classification
- fail-closed lifecycle plans for `install`, `activate`, `deactivate`, and `update`

It does not own bundle discovery, installer UX, manifest authoring, or runtime hook execution.

## Core shapes

- `InstalledModuleTarget`: planner-facing bundle identity derived from the manifest plus one concrete `bundleDigest`
- `InstalledModuleRuntimeExpectation`: current graph/runtime channels plus optional supported source kinds
- `InstalledModuleRecord`: authoritative installed row with source linkage, compatibility, install state, activation state, granted permissions, and timestamps

## Compatibility results

`validateInstalledModuleCompatibility()` returns one of:

- `new-install`: no existing record is present
- `matches-record`: target matches the current installed row
- `replaces-record`: version, digest, source, or compatibility differs from the current row

It fails closed for:

- invalid target, record, or runtime inputs
- module id mismatch between target and record
- unsupported source kind
- graph or runtime compatibility mismatch

## Ledger state model

- install states: `installing`, `installed`, `uninstalling`, `failed`
- desired activation states: `active`, `inactive`
- activation statuses: `activating`, `active`, `deactivating`, `inactive`, `failed`
- activation failure metadata is required when `activation.status === "failed"`
- `installState === "failed"` also requires activation failure state

In-flight rows fail closed. The planner does not guess how to resume partial transitions.

## Lifecycle planner

`planInstalledModuleLifecycle()` produces either:

- `disposition: "apply"` with pending, success, and failure state targets
- `disposition: "noop"` with an explicit reason
- a fail-closed planning error

No-op reasons are:

- `already-active`
- `already-inactive`
- `no-change`

Important planner rules:

- `install` requires a target and runtime expectation, and rejects any existing row
- `activate` requires the current installed bundle, not a replacement target
- `deactivate` applies only to the current installed bundle and stable rows
- `update` handles replacements and may preserve the current active runtime until the replacement succeeds

## Version transition semantics

- The planner always reports `fromVersion`, `toVersion`, and `requiresMigration`.
- `update` marks `requiresMigration` when the target version differs from the current record version.
- `install`, `activate`, and `deactivate` keep migration handling explicit through the returned transition and recovery text rather than hiding it in planner-local branches.

## Practical rules

- Validate and freeze target, runtime, and record inputs before branching on them.
- Keep partial or in-flight rows fail-closed until the runtime has real resume semantics.
- Treat compatibility mismatch as planner input failure, not as an invitation to guess a replacement path.
- Keep authored manifest parsing in `@io/graph-module`; this package starts at the authoritative ledger seam.
