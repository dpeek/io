# Branch 4: Module Runtime And Installation

## Mission

Turn schema, views, commands, workflows, and ingest hooks into installable
modules with explicit manifests, migrations, and permissions.

## Why This Is A Separate Branch

The platform only becomes extensible when modules are a real install unit.
Without this branch, every new product slice remains hard-wired into the repo.

## In Scope

- module manifest shape
- install, update, and uninstall flow
- compatibility checks
- schema and data migrations
- permission requests at install time
- registration of views, commands, workflows, indexes, and connectors
- support for built-in and local modules first

## Out Of Scope

- large public module marketplace
- signed remote bundles
- full trust and sandboxing hardening for third-party code

## Durable Contracts Owned

- module manifest format
- module compatibility contract
- install-time permission request format
- module registration interfaces for views, commands, workflows, and indexes
- migration and rollback hooks

## Likely Repo Boundaries

- `src/graph/modules/`
- future module runtime and installer packages
- web module host registration surfaces
- agent workflow and command registration surfaces

## Dependencies

- Branch 1 for schema and graph primitives
- Branch 2 for permission and capability model

## Downstream Consumers

- Branch 5 needs a way for blob and ingest families to register
- Branch 6 needs workflow and command descriptors to become real module
  contracts
- Branch 7 needs module-host surfaces and install UX

## First Shippable Milestone

Support installation of one local module that adds schema, one view, one
command, and one index with no manual wiring outside the installer.

## Done Means

- the module declares what it adds and what it requires
- install applies schema and required migrations
- the runtime registers the view, command, and index
- uninstall or upgrade paths are documented, even if minimal

## First Demo

Install a local module and immediately see its route, editor, and command show
up in the existing web shell.

## What This Unlocks

- blob-backed module families in Branch 5
- workflow-native modules in Branch 6
- a real module host in Branch 7

## Source Anchors

- `doc/03-target-platform-architecture.md`
- `doc/05-recommended-architecture.md`
- `doc/06-migration-plan.md`
- `doc/08-vision-overview.md`
- `doc/10-vision-product-model.md`
- `doc/11-vision-execution-model.md`
