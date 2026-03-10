# IO Config In TypeScript

Status: Proposed

## Purpose

This document defines a TypeScript-first replacement for the current `io.json`
runtime configuration model.

The goal is to move from:

- a JSON file that is validated at runtime

to:

- a repo-local `io.ts` module that exports one typed config object
- shared config types and helpers from `@io/lib`
- package-visible TypeScript access to the same config object across the stack

This should make configuration:

- easier to author
- stricter at compile time
- easier to share across packages
- easier to evolve toward graph-defined schemas and UI editing

## Current State

Today the agent runtime treats `io.json` as the structured entrypoint when it
contains runtime keys. `agent/src/workflow.ts`:

- detects runtime config keys in `io.json`
- parses JSON at runtime
- validates the result with Zod
- normalizes the config into the `Workflow` shape

This works, but it keeps the config surface in a format that:

- cannot express imports, reuse, or computed defaults cleanly
- does not give package consumers a typed module to import
- duplicates type intent between JSON input and runtime normalization
- makes plugin/provider-specific config extensions awkward

The repo already has two building blocks that make a TypeScript model plausible:

- `@io/lib` is a shared workspace package that already exports common runtime
  helpers and types
- the graph package already describes typed shapes through schema definitions,
  which can later be used to define config structure in a more modular way

## Desired End State

Each repo should define its configuration in a root-level `io.ts` file:

```ts
import { defineIOConfig } from "@io/lib/config";

export default defineIOConfig({
  agent: {
    maxConcurrentAgents: 1,
    maxRetryBackoffMs: 300_000,
    maxTurns: 1,
  },
  codex: {
    approvalPolicy: "never",
    command: "codex app-server",
    readTimeoutMs: 5_000,
    stallTimeoutMs: 300_000,
    threadSandbox: "workspace-write",
    turnTimeoutMs: 3_600_000,
  },
  tracker: {
    kind: "linear",
    apiKey: "$LINEAR_API_KEY",
    projectSlug: "$LINEAR_PROJECT_SLUG",
    activeStates: ["Todo"],
    terminalStates: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"],
  },
  workspace: {
    root: "$AGENT_WORKSPACE_ROOT",
  },
  providers: {
    linear: {
      defaultTeam: "OpenSurf",
    },
  },
});
```

The runtime should then load that module directly instead of parsing JSON.

## Core Contract

The model should be centered on a single exported object:

- file: `./io.ts`
- default export: one typed config object
- authoring helper: `defineIOConfig(...)`

`defineIOConfig(...)` should:

- preserve literal types from the repo config
- validate the top-level shape at compile time
- remain a no-op or near-no-op at runtime

The resulting type should be consumable from any package that can resolve the
repo entrypoint.

## Why `io.ts` Instead Of JSON

TypeScript unlocks four things JSON cannot provide cleanly:

1. a real importable module boundary
2. exact inference for literals, unions, and nested provider config
3. composition through constants and helper functions
4. extension points for plugins without inventing a JSON-only schema language

This is especially important if the same config should be used by:

- the agent runtime
- CLI commands
- graph-backed tooling
- future UI editing and config inspection flows

## Proposed Runtime Shape

`@io/lib` should own the shared config types and authoring helpers.

Suggested surface:

```ts
export interface IOConfig {
  agent?: AgentConfig;
  codex?: CodexConfig;
  hooks?: HookConfig;
  polling?: PollingConfig;
  tracker?: TrackerConfig;
  workspace?: WorkspaceConfig;
  providers?: ProviderConfigMap;
  plugins?: PluginConfigMap;
}

export declare function defineIOConfig<const T extends IOConfig>(config: T): T;
```

This keeps repo config authoring strongly typed while still allowing the runtime
to normalize defaults later.

The runtime loader in `agent/src/workflow.ts` should evolve from:

- read `io.json`
- `JSON.parse(...)`
- validate with `ioConfigSchema`

to:

- resolve `io.ts`
- import its default export
- validate the loaded value defensively at runtime
- normalize it into the existing `Workflow` shape

Compile-time typing should improve authoring. Runtime validation should still
exist to protect CLI usage, JS callers, and malformed module exports.

## Package Resolution Model

The repo needs a stable way for workspace packages to resolve the root config
module.

### Requirements

- package code should be able to import the config without copying paths
- TypeScript should understand the repo-local `io.ts` file
- runtime resolution should match TypeScript resolution closely

### Recommended approach

Use a reserved module id for the repo config, backed by TypeScript path mapping.

Example:

```json
{
  "compilerOptions": {
    "paths": {
      "@io/config": ["../io.ts"]
    }
  }
}
```

Each package tsconfig that extends the shared base should resolve `@io/config`
to the repo root `io.ts`.

That gives consumers a stable import:

```ts
import config from "@io/config";
```

This is preferable to many relative imports because it:

- avoids package-specific path math
- makes the config entrypoint explicit
- keeps room for future tooling that can special-case the module id

## Provider And Plugin Configuration

Provider and plugin config should not be modeled as one untyped catch-all
object.

Instead, each provider or plugin should contribute its own config shape through
shared TypeScript interfaces.

Suggested direction:

```ts
interface ProviderConfigMap {
  linear?: LinearProviderConfig;
}

interface PluginConfigMap {
  graph?: GraphPluginConfig;
}
```

This gives three useful properties:

- unused integrations stay absent rather than loosely optional everywhere
- configured integrations become strictly typed at author time
- new integrations can extend the config surface without rewriting the core file

The `defineIOConfig(...)` helper should preserve those nested literal types so
the rest of the app sees the user-authored config shape, not just a widened base
interface.

## Relationship To The Graph

The graph runtime already models typed shapes through `defineType(...)`,
`defineScalar(...)`, and resolved field metadata. That should become the
long-term source of truth for editable config schemas.

Near-term:

- TypeScript interfaces define the config authoring contract
- runtime code imports the resulting `io.ts` object directly

Later:

- providers and plugins can publish graph-described config schemas
- the config UI can render forms from those schemas
- the same schema metadata can drive validation, docs, and structured editing

That path keeps the first implementation small while preserving the more
ambitious graph-native configuration model described in the issue.

## Compatibility And Migration

This should be an additive migration, not a flag day.

### Phase 1

- add `@io/lib` config types and `defineIOConfig(...)`
- support `io.ts` as a new preferred config entrypoint
- preserve `io.json` loading as a compatibility path

### Phase 2

- add `@io/config` path resolution for workspace packages
- let runtime and package code import the same repo config module

### Phase 3

- move provider and plugin config into modular typed interfaces
- stop treating unknown nested objects as opaque blobs

### Phase 4

- describe provider/plugin config schemas in graph terms
- use that schema metadata for UI editing and inspection

During migration, precedence should be explicit:

1. `io.ts`
2. `io.json`
3. legacy `WORKFLOW.md` fallback behavior where still supported

The runtime should fail clearly when both `io.ts` and `io.json` exist but do not
agree on which one is authoritative.

## Implementation Plan

The smallest complete implementation should be:

1. add shared `IOConfig` types and `defineIOConfig(...)` to `@io/lib`
2. teach `agent/src/workflow.ts` to load `io.ts` as the preferred config
   entrypoint while keeping `io.json` as a compatibility fallback
3. add tsconfig path wiring for a stable `@io/config` import in each package
4. migrate repo-local config consumption to import the typed module instead of
   reparsing JSON
5. follow up with provider/plugin-specific typing, then graph-backed schema
   publication once the TypeScript entrypoint is stable

## Non-Goals For The First Change

The first implementation should not try to solve everything at once.

Out of scope for the initial rollout:

- replacing every runtime normalization step with compile-time typing
- building the config editing UI
- making the graph schema the only authoring source immediately
- removing `io.json` compatibility before `io.ts` is proven in real repos

## Recommended Outcome

Treat `io.ts` as the canonical authoring surface, `@io/lib` as the source of the
shared typed contract, and the graph as the next layer that will eventually make
those config shapes inspectable and editable.

That sequence keeps the migration grounded:

- first make config importable and typed
- then make it modular across providers and plugins
- then make it graph-described for tooling and UI
