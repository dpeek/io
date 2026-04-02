import { createGraphClient } from "@io/graph-client";
import {
  createGraphStore as createStore,
  isEntityType,
  type AnyTypeOutput,
  type GraphStoreSnapshot,
} from "@io/graph-kernel";
import { core, coreCatalogModuleReadScopeRegistration } from "@io/graph-module-core";
import {
  createRetainedWorkflowProjectionState,
  createWorkflowProjectionIndexFromRetainedState,
  createWorkflowReviewInvalidationEvent,
  projectionSchema,
  workflowReviewRetainedProjectionProviderRegistration,
  workflowReviewModuleReadScopeRegistration,
  type RetainedWorkflowProjectionState,
  type WorkflowProjectionIndex,
} from "@io/graph-module-workflow";
import {
  createRegisteredModuleReadScope,
  defineModuleReadScopeRegistry,
  defineRetainedProjectionProviderRegistry,
  listRetainedProjectionProvidersForScope,
  matchesModuleReadScopeRegistration,
  type InvalidationEvent,
  type ModuleReadScopeDefinition,
  type ModuleReadScopeRegistration,
  type RetainedProjectionProviderRegistration,
} from "@io/graph-projection";

import type { ModuleSyncScope, SyncScope, SyncScopeRequest } from "@io/graph-sync";

function createModuleEntityTypeIds(
  definitions: Readonly<Record<string, AnyTypeOutput>>,
): ReadonlySet<string> {
  return new Set(
    Object.values(definitions)
      .filter(isEntityType)
      .map((typeDef) => {
        const values = typeDef.values as { readonly id?: string; readonly key: string };
        return values.id ?? values.key;
      }),
  );
}

type WebAppRetainedProjectionInvalidationInput = {
  readonly graphId: string;
  readonly sourceCursor: string;
  readonly touchedTypeIds: Iterable<string>;
};

export type WebAppRetainedProjectionProvider<
  Registration extends RetainedProjectionProviderRegistration =
    RetainedProjectionProviderRegistration,
  State = unknown,
  Hydrated = unknown,
> = {
  readonly registration: Registration;
  readonly buildRetainedState: (snapshot: GraphStoreSnapshot, sourceCursor: string) => State;
  readonly hydrateRetainedState: (retained: State) => Hydrated;
  readonly createInvalidationEvent: (
    input: WebAppRetainedProjectionInvalidationInput,
  ) => InvalidationEvent | undefined;
};

export type AnyWebAppRetainedProjectionProvider = WebAppRetainedProjectionProvider<any, any, any>;

export type WorkflowReviewRetainedProjectionProvider = WebAppRetainedProjectionProvider<
  typeof workflowReviewRetainedProjectionProviderRegistration,
  RetainedWorkflowProjectionState,
  WorkflowProjectionIndex
>;

const workflowReviewRetainedProjectionProvider = Object.freeze({
  registration: workflowReviewRetainedProjectionProviderRegistration,
  buildRetainedState(snapshot: GraphStoreSnapshot, sourceCursor: string) {
    return createRetainedWorkflowProjectionState(
      createGraphClient(createStore(snapshot), projectionSchema),
      {
        sourceCursor,
      },
    );
  },
  hydrateRetainedState(retained: RetainedWorkflowProjectionState) {
    return createWorkflowProjectionIndexFromRetainedState(retained);
  },
  createInvalidationEvent(input: WebAppRetainedProjectionInvalidationInput) {
    return createWorkflowReviewInvalidationEvent({
      ...input,
      eventId: `workflow-review:${input.sourceCursor}`,
    });
  },
} satisfies WorkflowReviewRetainedProjectionProvider);

export type WebAppModuleReadScopeBinding = {
  readonly registration: ModuleReadScopeRegistration;
  readonly typeIds: ReadonlySet<string>;
  readonly retainedProjectionProviders: readonly AnyWebAppRetainedProjectionProvider[];
  readonly syncProof?: {
    readonly description: string;
    readonly key: string;
    readonly label: string;
  };
};

const installedWebAppModuleReadScopeBindings = [
  {
    registration: workflowReviewModuleReadScopeRegistration,
    typeIds: createModuleEntityTypeIds(projectionSchema),
    retainedProjectionProviders: [workflowReviewRetainedProjectionProvider] as const,
    syncProof: {
      key: "workflow-review",
      label: "Workflow review scope",
      description: "Bootstrap and refresh the shipped workflow review module scope.",
    },
  },
  {
    registration: coreCatalogModuleReadScopeRegistration,
    typeIds: createModuleEntityTypeIds(core),
    retainedProjectionProviders: [] as const,
    syncProof: {
      key: "core-catalog",
      label: "Core catalog scope",
      description: "Bootstrap and refresh the built-in core catalog module scope.",
    },
  },
] as const satisfies readonly WebAppModuleReadScopeBinding[];

export type InstalledWebAppModuleReadScopeBinding =
  (typeof installedWebAppModuleReadScopeBindings)[number];

export const webAppModuleReadScopeBindings: readonly WebAppModuleReadScopeBinding[] = Object.freeze(
  installedWebAppModuleReadScopeBindings,
);

const webAppModuleReadScopeRegistry = defineModuleReadScopeRegistry(
  webAppModuleReadScopeBindings.map((binding) => binding.registration),
);

const webAppRetainedProjectionProviders = Object.freeze([
  ...new Map(
    webAppModuleReadScopeBindings
      .flatMap((binding) => binding.retainedProjectionProviders)
      .map((provider) => [provider.registration.providerId, provider] as const),
  ).values(),
]) as readonly AnyWebAppRetainedProjectionProvider[];

if (webAppRetainedProjectionProviders.length === 0) {
  throw new TypeError("Web app retained projection registry must not be empty.");
}

const webAppRetainedProjectionProviderRegistry = defineRetainedProjectionProviderRegistry(
  webAppRetainedProjectionProviders.map((provider) => provider.registration),
);

export type PlannedWebAppModuleReadScope = {
  readonly binding: InstalledWebAppModuleReadScopeBinding;
  readonly registration: ModuleReadScopeRegistration;
  readonly scope: ModuleSyncScope;
  readonly typeIds: ReadonlySet<string>;
};

export function findWebAppModuleReadScopeBinding(
  scope: SyncScope | SyncScopeRequest,
): InstalledWebAppModuleReadScopeBinding | undefined {
  const registration = webAppModuleReadScopeRegistry.find((candidate) =>
    matchesModuleReadScopeRegistration(scope, candidate),
  );
  if (!registration) {
    return undefined;
  }

  return installedWebAppModuleReadScopeBindings.find((binding) => {
    const definition = binding.registration.definition;
    return (
      definition.moduleId === registration.definition.moduleId &&
      definition.scopeId === registration.definition.scopeId &&
      definition.definitionHash === registration.definition.definitionHash
    );
  });
}

export function planWebAppModuleReadScope(
  scope: SyncScope | SyncScopeRequest,
  policyFilterVersion: string,
): PlannedWebAppModuleReadScope | undefined {
  const binding = findWebAppModuleReadScopeBinding(scope);
  if (!binding) {
    return undefined;
  }

  return {
    binding,
    registration: binding.registration,
    scope: createRegisteredModuleReadScope(binding.registration, policyFilterVersion),
    typeIds: binding.typeIds,
  };
}

export function listWebAppRetainedProjectionProvidersForScope(
  scope: SyncScope | SyncScopeRequest | ModuleReadScopeDefinition,
): readonly AnyWebAppRetainedProjectionProvider[] {
  const providerIds = new Set(
    listRetainedProjectionProvidersForScope(webAppRetainedProjectionProviderRegistry, scope).map(
      (registration) => registration.providerId,
    ),
  );
  if (providerIds.size === 0) {
    return [];
  }

  return webAppRetainedProjectionProviders.filter((provider) =>
    providerIds.has(provider.registration.providerId),
  );
}

export function listInstalledWebAppRetainedProjectionProviders(): readonly AnyWebAppRetainedProjectionProvider[] {
  return webAppRetainedProjectionProviders;
}

function formatScopeLabel(scope: SyncScope | SyncScopeRequest | ModuleReadScopeDefinition): string {
  if (scope.kind !== "module") {
    return scope.kind;
  }

  return `${scope.moduleId}/${scope.scopeId}`;
}

export function getOnlyWebAppRetainedProjectionProviderForScope(
  scope: SyncScope | SyncScopeRequest | ModuleReadScopeDefinition,
): AnyWebAppRetainedProjectionProvider {
  const providers = listWebAppRetainedProjectionProvidersForScope(scope);
  if (providers.length === 1) {
    return providers[0]!;
  }

  if (providers.length === 0) {
    throw new Error(
      `No retained projection provider is installed for scope "${formatScopeLabel(scope)}".`,
    );
  }

  throw new Error(
    `Scope "${formatScopeLabel(scope)}" resolved ${providers.length} retained projection providers; dispatch must select one explicitly.`,
  );
}

export function getWorkflowReviewRetainedProjectionProvider(): WorkflowReviewRetainedProjectionProvider {
  const provider = getOnlyWebAppRetainedProjectionProviderForScope(
    workflowReviewModuleReadScopeRegistration.definition,
  );
  if (provider.registration !== workflowReviewRetainedProjectionProviderRegistration) {
    throw new Error("Workflow review retained projection provider registration is not installed.");
  }

  return provider as WorkflowReviewRetainedProjectionProvider;
}

export { workflowReviewModuleReadScope } from "@io/graph-module-workflow";
