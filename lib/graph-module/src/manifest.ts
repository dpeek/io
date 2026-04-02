import {
  defineModuleQuerySurfaceCatalog,
  defineModuleReadScopeDefinition,
  defineProjectionSpec,
  type ModuleQuerySurfaceCatalog,
  type ModuleReadScopeDefinition,
  type ProjectionSpec,
} from "@io/graph-projection";

import type {
  CollectionSurfaceSpec,
  GraphCommandSpec,
  GraphCommandSurfaceSpec,
  ObjectViewSpec,
  RecordSurfaceSpec,
  WorkflowSpec,
} from "./contracts.js";

const graphCommandExecutionValues = ["localOnly", "optimisticVerify", "serverOnly"] as const;
const graphModuleCollectionSourceKinds = ["entity-type", "relation", "query"] as const;
const graphModuleCollectionPresentationKinds = ["list", "table", "board", "card-grid"] as const;

export const graphModuleSourceKinds = ["built-in", "local"] as const;

export type GraphModuleSourceKind = (typeof graphModuleSourceKinds)[number];

/**
 * Authored source metadata for one module manifest.
 *
 * `specifier` identifies the built-in package or local module entrypoint that
 * owns the manifest export.
 */
export type GraphModuleManifestSource = {
  readonly kind: GraphModuleSourceKind;
  readonly specifier: string;
  readonly exportName: string;
};

/**
 * Opaque compatibility channels declared by one authored module manifest.
 *
 * The contract deliberately leaves version semantics to higher layers. The
 * manifest only requires explicit, stable strings so activation planning can
 * fail closed when callers do not recognize the compatibility channel.
 */
export type GraphModuleManifestCompatibility = {
  readonly graph: string;
  readonly runtime: string;
};

export type GraphModuleSchemaDefinition = {
  readonly values: {
    readonly key: string;
  };
};

/**
 * One schema namespace or slice contributed by a module manifest.
 */
export type GraphModuleSchemaContribution<
  Namespace extends Record<string, GraphModuleSchemaDefinition> = Record<
    string,
    GraphModuleSchemaDefinition
  >,
> = {
  readonly key: string;
  readonly namespace: Namespace;
};

export const graphModuleActivationHookStages = ["install", "activate", "deactivate"] as const;

export type GraphModuleActivationHookStage = (typeof graphModuleActivationHookStages)[number];

/**
 * Declarative activation hook metadata attached to an authored module.
 *
 * This is intentionally metadata-only. Runtime planning and invocation stay in
 * later layers.
 */
export type GraphModuleActivationHookSpec = {
  readonly key: string;
  readonly stage: GraphModuleActivationHookStage;
  readonly description?: string;
};

export const graphModuleRuntimeContributionKinds = [
  "schema",
  "query-surface-catalog",
  "command",
  "command-surface",
  "object-view",
  "record-surface",
  "collection-surface",
  "workflow",
  "read-scope",
  "projection",
  "activation-hook",
] as const;

export type GraphModuleRuntimeContributionKind =
  (typeof graphModuleRuntimeContributionKinds)[number];

/**
 * First explicit authored manifest vocabulary shared by built-in and local
 * modules.
 */
export type GraphModuleManifestRuntime = {
  readonly schemas?: readonly GraphModuleSchemaContribution[];
  readonly querySurfaceCatalogs?: readonly ModuleQuerySurfaceCatalog[];
  readonly commands?: readonly GraphCommandSpec[];
  readonly commandSurfaces?: readonly GraphCommandSurfaceSpec[];
  readonly objectViews?: readonly ObjectViewSpec[];
  readonly recordSurfaces?: readonly RecordSurfaceSpec[];
  readonly collectionSurfaces?: readonly CollectionSurfaceSpec[];
  readonly workflows?: readonly WorkflowSpec[];
  readonly readScopes?: readonly ModuleReadScopeDefinition[];
  readonly projections?: readonly ProjectionSpec[];
  readonly activationHooks?: readonly GraphModuleActivationHookSpec[];
};

/**
 * Shared authored manifest contract for built-in and local modules.
 */
export type GraphModuleManifest = {
  readonly moduleId: string;
  readonly version: string;
  readonly source: GraphModuleManifestSource;
  readonly compatibility: GraphModuleManifestCompatibility;
  readonly runtime: GraphModuleManifestRuntime;
};

function assertNonEmptyString(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}

function assertKnownValue<const T extends readonly string[]>(
  values: T,
  value: string,
  label: string,
): asserts value is T[number] {
  if (!(values as readonly string[]).includes(value)) {
    throw new TypeError(`${label} must be one of ${values.join(", ")}.`);
  }
}

function assertUniqueValues(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new TypeError(`${label} must be unique. Duplicate value: ${value}`);
    }
    seen.add(value);
  }
}

function freezeOptionalUniqueArray<T>(
  values: readonly T[] | undefined,
  label: string,
  freezeValue: (value: T) => Readonly<T>,
  readIdentity: (value: Readonly<T>) => string,
): readonly Readonly<T>[] | undefined {
  if (!values) {
    return undefined;
  }
  if (values.length === 0) {
    throw new TypeError(`${label} must not be empty when provided.`);
  }

  const frozen = values.map((value) => freezeValue(value));
  assertUniqueValues(
    frozen.map((value) => readIdentity(value)),
    label,
  );
  return Object.freeze(frozen);
}

function freezeGraphModuleSource(
  source: GraphModuleManifestSource,
): Readonly<GraphModuleManifestSource> {
  assertKnownValue(graphModuleSourceKinds, source.kind, "source.kind");
  assertNonEmptyString(source.specifier, "source.specifier");
  assertNonEmptyString(source.exportName, "source.exportName");
  return Object.freeze({ ...source });
}

function freezeGraphModuleCompatibility(
  compatibility: GraphModuleManifestCompatibility,
): Readonly<GraphModuleManifestCompatibility> {
  assertNonEmptyString(compatibility.graph, "compatibility.graph");
  assertNonEmptyString(compatibility.runtime, "compatibility.runtime");
  return Object.freeze({ ...compatibility });
}

function freezeGraphModuleSchemaContribution(
  contribution: GraphModuleSchemaContribution,
): Readonly<GraphModuleSchemaContribution> {
  assertNonEmptyString(contribution.key, "runtime.schemas.key");

  const schemaEntries = Object.values(contribution.namespace);
  if (schemaEntries.length === 0) {
    throw new TypeError(`runtime.schemas "${contribution.key}" must not be empty.`);
  }

  for (const entry of schemaEntries) {
    assertNonEmptyString(entry.values.key, `runtime.schemas "${contribution.key}".values.key`);
  }

  return Object.freeze({ ...contribution });
}

function freezeGraphCommandSpec(command: GraphCommandSpec): Readonly<GraphCommandSpec> {
  assertNonEmptyString(command.key, "runtime.commands.key");
  assertNonEmptyString(command.label, "runtime.commands.label");
  assertKnownValue(graphCommandExecutionValues, command.execution, "runtime.commands.execution");
  if (command.subject !== undefined) {
    assertNonEmptyString(command.subject, "runtime.commands.subject");
  }
  return Object.freeze({ ...command });
}

function freezeGraphCommandSurfaceSpec(
  surface: GraphCommandSurfaceSpec,
): Readonly<GraphCommandSurfaceSpec> {
  assertNonEmptyString(surface.key, "runtime.commandSurfaces.key");
  assertNonEmptyString(surface.command, "runtime.commandSurfaces.command");
  return Object.freeze({
    ...surface,
    subject: Object.freeze({ ...surface.subject }),
    inputPresentation: Object.freeze({ ...surface.inputPresentation }),
    submitBehavior: Object.freeze({ ...surface.submitBehavior }),
    postSuccess: Object.freeze(
      surface.postSuccess.map((behavior) => Object.freeze({ ...behavior })),
    ),
  });
}

function freezeObjectViewSpec(view: ObjectViewSpec): Readonly<ObjectViewSpec> {
  assertNonEmptyString(view.key, "runtime.objectViews.key");
  assertNonEmptyString(view.entity, "runtime.objectViews.entity");
  if (view.sections.length === 0) {
    throw new TypeError(`runtime.objectViews "${view.key}" must include at least one section.`);
  }
  return Object.freeze({
    ...view,
    sections: Object.freeze(
      view.sections.map((section) =>
        Object.freeze({
          ...section,
          fields: Object.freeze(section.fields.map((field) => Object.freeze({ ...field }))),
        }),
      ),
    ),
    ...(view.related
      ? {
          related: Object.freeze(view.related.map((related) => Object.freeze({ ...related }))),
        }
      : {}),
    ...(view.commands ? { commands: Object.freeze([...view.commands]) } : {}),
  });
}

function freezeRecordSurfaceSpec(surface: RecordSurfaceSpec): Readonly<RecordSurfaceSpec> {
  assertNonEmptyString(surface.key, "runtime.recordSurfaces.key");
  assertNonEmptyString(surface.subject, "runtime.recordSurfaces.subject");
  if (surface.sections.length === 0) {
    throw new TypeError(
      `runtime.recordSurfaces "${surface.key}" must include at least one section.`,
    );
  }
  return Object.freeze({
    ...surface,
    sections: Object.freeze(
      surface.sections.map((section) =>
        Object.freeze({
          ...section,
          fields: Object.freeze(section.fields.map((field) => Object.freeze({ ...field }))),
        }),
      ),
    ),
    ...(surface.related
      ? {
          related: Object.freeze(surface.related.map((related) => Object.freeze({ ...related }))),
        }
      : {}),
    ...(surface.commandSurfaces
      ? { commandSurfaces: Object.freeze([...surface.commandSurfaces]) }
      : {}),
  });
}

function freezeCollectionSurfaceSpec(
  surface: CollectionSurfaceSpec,
): Readonly<CollectionSurfaceSpec> {
  assertNonEmptyString(surface.key, "runtime.collectionSurfaces.key");
  assertNonEmptyString(surface.title, "runtime.collectionSurfaces.title");
  assertKnownValue(
    graphModuleCollectionSourceKinds,
    surface.source.kind,
    "runtime.collectionSurfaces.source.kind",
  );
  assertKnownValue(
    graphModuleCollectionPresentationKinds,
    surface.presentation.kind,
    "runtime.collectionSurfaces.presentation.kind",
  );
  return Object.freeze({
    ...surface,
    source: Object.freeze({ ...surface.source }),
    presentation: Object.freeze({
      ...surface.presentation,
      ...(surface.presentation.fields
        ? { fields: Object.freeze([...surface.presentation.fields]) }
        : {}),
    }),
    ...(surface.commandSurfaces
      ? { commandSurfaces: Object.freeze([...surface.commandSurfaces]) }
      : {}),
  });
}

function freezeWorkflowSpec(workflow: WorkflowSpec): Readonly<WorkflowSpec> {
  assertNonEmptyString(workflow.key, "runtime.workflows.key");
  assertNonEmptyString(workflow.label, "runtime.workflows.label");
  assertNonEmptyString(workflow.description, "runtime.workflows.description");
  if (workflow.subjects.length === 0) {
    throw new TypeError(`runtime.workflows "${workflow.key}" must declare at least one subject.`);
  }
  if (workflow.steps.length === 0) {
    throw new TypeError(`runtime.workflows "${workflow.key}" must declare at least one step.`);
  }
  assertUniqueValues(workflow.subjects, `runtime.workflows "${workflow.key}".subjects`);
  return Object.freeze({
    ...workflow,
    subjects: Object.freeze([...workflow.subjects]),
    steps: Object.freeze(workflow.steps.map((step) => Object.freeze({ ...step }))),
    ...(workflow.commands ? { commands: Object.freeze([...workflow.commands]) } : {}),
  });
}

function freezeActivationHookSpec(
  hook: GraphModuleActivationHookSpec,
): Readonly<GraphModuleActivationHookSpec> {
  assertNonEmptyString(hook.key, "runtime.activationHooks.key");
  assertKnownValue(graphModuleActivationHookStages, hook.stage, "runtime.activationHooks.stage");
  if (hook.description !== undefined) {
    assertNonEmptyString(hook.description, "runtime.activationHooks.description");
  }
  return Object.freeze({ ...hook });
}

function freezeGraphModuleRuntime(
  runtime: GraphModuleManifestRuntime,
  moduleId: string,
): Readonly<GraphModuleManifestRuntime> {
  const schemas = freezeOptionalUniqueArray(
    runtime.schemas,
    "runtime.schemas",
    freezeGraphModuleSchemaContribution,
    (schema) => schema.key,
  );
  const querySurfaceCatalogs = freezeOptionalUniqueArray(
    runtime.querySurfaceCatalogs,
    "runtime.querySurfaceCatalogs",
    (catalog) => {
      const frozenCatalog = defineModuleQuerySurfaceCatalog(catalog);
      if (frozenCatalog.moduleId !== moduleId) {
        throw new TypeError(
          `runtime.querySurfaceCatalogs "${frozenCatalog.catalogId}" must use moduleId "${moduleId}".`,
        );
      }
      return frozenCatalog;
    },
    (catalog) => catalog.catalogId,
  );
  const commands = freezeOptionalUniqueArray(
    runtime.commands,
    "runtime.commands",
    freezeGraphCommandSpec,
    (command) => command.key,
  );
  const commandSurfaces = freezeOptionalUniqueArray(
    runtime.commandSurfaces,
    "runtime.commandSurfaces",
    freezeGraphCommandSurfaceSpec,
    (surface) => surface.key,
  );
  const objectViews = freezeOptionalUniqueArray(
    runtime.objectViews,
    "runtime.objectViews",
    freezeObjectViewSpec,
    (view) => view.key,
  );
  const recordSurfaces = freezeOptionalUniqueArray(
    runtime.recordSurfaces,
    "runtime.recordSurfaces",
    freezeRecordSurfaceSpec,
    (surface) => surface.key,
  );
  const collectionSurfaces = freezeOptionalUniqueArray(
    runtime.collectionSurfaces,
    "runtime.collectionSurfaces",
    freezeCollectionSurfaceSpec,
    (surface) => surface.key,
  );
  const workflows = freezeOptionalUniqueArray(
    runtime.workflows,
    "runtime.workflows",
    freezeWorkflowSpec,
    (workflow) => workflow.key,
  );
  const readScopes = freezeOptionalUniqueArray(
    runtime.readScopes,
    "runtime.readScopes",
    (scope) => {
      const frozenScope = defineModuleReadScopeDefinition(scope);
      if (frozenScope.moduleId !== moduleId) {
        throw new TypeError(
          `runtime.readScopes "${frozenScope.scopeId}" must use moduleId "${moduleId}".`,
        );
      }
      return frozenScope;
    },
    (scope) => scope.scopeId,
  );
  const projections = freezeOptionalUniqueArray(
    runtime.projections,
    "runtime.projections",
    defineProjectionSpec,
    (projection) => projection.projectionId,
  );
  const activationHooks = freezeOptionalUniqueArray(
    runtime.activationHooks,
    "runtime.activationHooks",
    freezeActivationHookSpec,
    (hook) => hook.key,
  );

  if (
    !schemas &&
    !querySurfaceCatalogs &&
    !commands &&
    !commandSurfaces &&
    !objectViews &&
    !recordSurfaces &&
    !collectionSurfaces &&
    !workflows &&
    !readScopes &&
    !projections &&
    !activationHooks
  ) {
    throw new TypeError("runtime must declare at least one contribution.");
  }

  return Object.freeze({
    ...(schemas ? { schemas } : {}),
    ...(querySurfaceCatalogs ? { querySurfaceCatalogs } : {}),
    ...(commands ? { commands } : {}),
    ...(commandSurfaces ? { commandSurfaces } : {}),
    ...(objectViews ? { objectViews } : {}),
    ...(recordSurfaces ? { recordSurfaces } : {}),
    ...(collectionSurfaces ? { collectionSurfaces } : {}),
    ...(workflows ? { workflows } : {}),
    ...(readScopes ? { readScopes } : {}),
    ...(projections ? { projections } : {}),
    ...(activationHooks ? { activationHooks } : {}),
  });
}

export function defineGraphModuleManifest<const T extends GraphModuleManifest>(
  manifest: T,
): Readonly<T> {
  assertNonEmptyString(manifest.moduleId, "moduleId");
  assertNonEmptyString(manifest.version, "version");

  const source = freezeGraphModuleSource(manifest.source);
  const compatibility = freezeGraphModuleCompatibility(manifest.compatibility);
  const runtime = freezeGraphModuleRuntime(manifest.runtime, manifest.moduleId);

  return Object.freeze({
    ...manifest,
    source,
    compatibility,
    runtime,
  }) as Readonly<T>;
}
