/**
 * Public entrypoint for the graph projection package.
 *
 * This surface owns shared Branch 3 projection/runtime metadata contracts,
 * retained projection compatibility helpers, module read-scope definitions,
 * dependency keys, and invalidation routing contracts. Kernel/store
 * primitives, authority persistence, client transports, and workflow-local
 * projection implementations stay outside this package.
 */
import {
  queryFilterOperatorValues,
  queryOrderDirectionValues,
  queryParameterTypeValues,
  type QueryFilterOperator,
  type QueryLiteral,
  type QueryOrderDirection,
  type QueryParameterType,
  type ReadQuery,
} from "@io/graph-client";
import {
  createModuleSyncScope,
  createModuleSyncScopeRequest,
  moduleSyncScopeFallbackReasons,
  type ModuleSyncScope,
  type ModuleSyncScopeFallbackReason,
  type ModuleSyncScopeRequest,
  type SyncScope,
  type SyncScopeRequest,
} from "@io/graph-sync";

export const projectionSourceScopeKinds = [
  "graph",
  "module",
  "entity-neighborhood",
  "collection",
  "work-queue",
  "context-bundle",
  "share-projection",
] as const;

export type ProjectionSourceScopeKind = (typeof projectionSourceScopeKinds)[number];

export const projectionKinds = [
  "collection-index",
  "time-range-index",
  "context-bundle",
  "outbound-share",
] as const;

export type ProjectionKind = (typeof projectionKinds)[number];

export const projectionRebuildStrategies = ["full", "checkpointed"] as const;

export type ProjectionRebuildStrategy = (typeof projectionRebuildStrategies)[number];

export const projectionVisibilityModes = ["policy-filtered", "share-surface"] as const;

export type ProjectionVisibilityMode = (typeof projectionVisibilityModes)[number];

export const dependencyKeyKinds = ["predicate", "projection", "scope", "shard"] as const;

export type DependencyKeyKind = (typeof dependencyKeyKinds)[number];

/**
 * Conservative invalidation unit shared by projection builders, authorities,
 * and live registration routers.
 *
 * Dependency keys are intentionally coarse. A key must identify a stable
 * dependency family using the `<kind>:<value>` format. False positives are
 * acceptable because callers can re-pull conservatively. False negatives are
 * not acceptable because they risk serving stale state without a refresh.
 */
export type DependencyKey = `${DependencyKeyKind}:${string}`;

export type ProjectionDependencyKey = DependencyKey;

export const invalidationDeliveryKinds = ["cursor-advanced", "scoped-delta"] as const;

export type InvalidationDeliveryKind = (typeof invalidationDeliveryKinds)[number];

export type CursorAdvancedInvalidationDelivery = {
  readonly kind: "cursor-advanced";
};

export type ScopedDeltaInvalidationDelivery = {
  readonly kind: "scoped-delta";
  readonly scopeId: string;
  readonly deltaToken: string;
};

export type InvalidationDelivery =
  | CursorAdvancedInvalidationDelivery
  | ScopedDeltaInvalidationDelivery;

/**
 * Conservative freshness signal for projections and scope subscribers.
 *
 * Delivery semantics are intentionally narrow:
 * - `cursor-advanced` means the caller should re-pull from the authoritative
 *   source or retained projection state at `sourceCursor` or later.
 * - `scoped-delta` is reserved for deterministic local merge contracts and
 *   must not require consumers to inspect unauthorized raw facts.
 *
 * Events may be duplicated or wider than the exact changed rows. They are not
 * an authoritative change log.
 */
export interface InvalidationEvent {
  readonly eventId: string;
  readonly graphId: string;
  readonly sourceCursor: string;
  readonly dependencyKeys: readonly DependencyKey[];
  readonly affectedProjectionIds?: readonly string[];
  readonly affectedScopeIds?: readonly string[];
  readonly delivery: InvalidationDelivery;
}

export type InvalidationTarget = {
  readonly dependencyKeys: readonly DependencyKey[];
  readonly scopeId?: string;
};

/**
 * Stable definition for one shipped module read scope.
 *
 * Scope identity is `{ moduleId, scopeId, definitionHash }`. Change
 * `definitionHash` whenever previously retained scoped state, scoped cursors,
 * or projection compatibility assumptions should no longer be treated as
 * interchangeable with the new definition. `policyFilterVersion` is excluded
 * here because authorities resolve it at delivery time.
 */
export interface ModuleReadScopeDefinition {
  readonly kind: "module";
  readonly moduleId: string;
  readonly scopeId: string;
  readonly definitionHash: string;
}

export interface ModuleReadScopeRegistration<
  Definition extends ModuleReadScopeDefinition = ModuleReadScopeDefinition,
> {
  readonly definition: Definition;
  readonly fallback: {
    readonly definitionChanged: ModuleSyncScopeFallbackReason;
    readonly policyChanged: ModuleSyncScopeFallbackReason;
  };
}

/**
 * Declarative contract for a rebuildable projection surface.
 *
 * `definitionHash` is the compatibility boundary for retained checkpoints and
 * rows. Change it whenever the projection's rebuild inputs, row meaning, or
 * query-visible semantics become incompatible with previously retained state.
 */
export interface ProjectionSpec {
  readonly projectionId: string;
  readonly kind: ProjectionKind;
  readonly definitionHash: string;
  readonly sourceScopeKinds: readonly ProjectionSourceScopeKind[];
  readonly dependencyKeys: readonly ProjectionDependencyKey[];
  readonly rebuildStrategy: ProjectionRebuildStrategy;
  readonly visibilityMode: ProjectionVisibilityMode;
}

/**
 * Shared compatibility metadata for retained projection artifacts.
 *
 * Retained rows and checkpoints are considered reusable only when both
 * `projectionId` and `definitionHash` match the caller's expected metadata.
 */
export interface RetainedProjectionMetadata<
  ProjectionId extends string = string,
  DefinitionHash extends string = string,
> {
  readonly projectionId: ProjectionId;
  readonly definitionHash: DefinitionHash;
}

/**
 * Rebuildable retained checkpoint for one projection.
 *
 * This record is discardable derived state. It must be sufficient to resume or
 * restart a rebuild together with authoritative facts. If it is missing or
 * incompatible, callers rebuild instead of mutating the checkpoint in place.
 */
export interface RetainedProjectionCheckpointRecord<
  ProjectionId extends string = string,
  DefinitionHash extends string = string,
> extends RetainedProjectionMetadata<ProjectionId, DefinitionHash> {
  readonly sourceCursor: string;
  readonly projectionCursor: string;
  readonly projectedAt: string;
}

/**
 * Rebuildable retained row for one projection.
 *
 * Retained rows are cache materializations of authoritative state. They may be
 * dropped and recomputed from authoritative facts, retained blob metadata, and
 * the matching `ProjectionSpec`.
 */
export interface RetainedProjectionRowRecord<
  RowKind extends string = string,
  Value = unknown,
  ProjectionId extends string = string,
  DefinitionHash extends string = string,
> extends RetainedProjectionMetadata<ProjectionId, DefinitionHash> {
  readonly rowKind: RowKind;
  readonly rowKey: string;
  readonly sortKey: string;
  readonly value: Value;
}

export type RetainedProjectionRecordLookupResult<T extends RetainedProjectionMetadata> =
  | {
      readonly kind: "match";
      readonly record: T;
    }
  | {
      readonly kind: "definition-hash-mismatch";
      readonly projectionId: string;
      readonly expectedDefinitionHash: string;
      readonly actualDefinitionHashes: readonly string[];
    }
  | {
      readonly kind: "missing";
      readonly projectionId: string;
      readonly expectedDefinitionHash: string;
    };

export const retainedProjectionRecoveryModes = ["rebuild"] as const;

export type RetainedProjectionRecoveryMode = (typeof retainedProjectionRecoveryModes)[number];

export interface RetainedProjectionInvalidationTarget {
  readonly deliveryKind: InvalidationDeliveryKind;
  readonly dependencyKeys: readonly DependencyKey[];
  readonly affectedProjectionIds?: readonly string[];
  readonly affectedScopeIds?: readonly string[];
}

export interface RetainedProjectionProviderRegistration<
  ScopeDefinition extends ModuleReadScopeDefinition = ModuleReadScopeDefinition,
  Projection extends ProjectionSpec = ProjectionSpec,
> {
  readonly providerId: string;
  readonly scopeDefinitions: readonly ScopeDefinition[];
  readonly projections: readonly Projection[];
  readonly recovery: {
    readonly missing: RetainedProjectionRecoveryMode;
    readonly incompatible: RetainedProjectionRecoveryMode;
    readonly stale: RetainedProjectionRecoveryMode;
  };
  readonly invalidation?: RetainedProjectionInvalidationTarget;
}

export const moduleQuerySurfaceQueryKinds = ["collection", "scope"] as const;

export type ModuleQuerySurfaceQueryKind = (typeof moduleQuerySurfaceQueryKinds)[number];

export const querySurfaceFieldKindValues = [
  "enum",
  "entity-ref",
  "date",
  "boolean",
  "text",
  "number",
  "url",
  "email",
  "color",
  "percent",
  "duration",
  "money",
  "quantity",
  "range",
  "rate",
  "enum-list",
  "entity-ref-list",
  "date-list",
  "boolean-list",
  "text-list",
  "number-list",
  "url-list",
  "email-list",
  "color-list",
  "percent-list",
  "duration-list",
  "money-list",
  "quantity-list",
  "range-list",
  "rate-list",
] as const;

export type QuerySurfaceFieldKind = (typeof querySurfaceFieldKindValues)[number];

export type QuerySurfaceOption = {
  readonly label: string;
  readonly value: string;
};

export interface QuerySurfaceFilterFieldSpec {
  readonly description?: string;
  readonly fieldId: string;
  readonly kind: QuerySurfaceFieldKind;
  readonly label: string;
  readonly operators: readonly QueryFilterOperator[];
  readonly options?: readonly QuerySurfaceOption[];
}

export interface QuerySurfaceOrderFieldSpec {
  readonly description?: string;
  readonly directions?: readonly QueryOrderDirection[];
  readonly fieldId: string;
  readonly label: string;
}

export interface QuerySurfaceSelectableFieldSpec {
  readonly defaultSelected?: boolean;
  readonly description?: string;
  readonly fieldId: string;
  readonly label: string;
}

export interface QuerySurfaceParameterSpec {
  readonly defaultValue?: QueryLiteral;
  readonly description?: string;
  readonly label: string;
  readonly name: string;
  readonly required?: boolean;
  readonly type: QueryParameterType;
}

export const querySurfaceRendererResultKindValues = [
  "entity-detail",
  "entity-list",
  "collection",
  "scope",
] as const;

export type QuerySurfaceRendererResultKind = (typeof querySurfaceRendererResultKindValues)[number];

export const querySurfaceRendererSourceKindValues = ["saved-query", "inline"] as const;

export type QuerySurfaceRendererSourceKind = (typeof querySurfaceRendererSourceKindValues)[number];

export const querySurfaceEntityIdSupportValues = ["required", "optional", "forbidden"] as const;

export type QuerySurfaceEntityIdSupport = (typeof querySurfaceEntityIdSupportValues)[number];

export interface QuerySurfaceRendererSpec {
  readonly compatibleRendererIds: readonly string[];
  readonly itemEntityIds?: QuerySurfaceEntityIdSupport;
  readonly resultKind: QuerySurfaceRendererResultKind;
  readonly sourceKinds?: readonly QuerySurfaceRendererSourceKind[];
}

export type ModuleQuerySurfaceSourceSpec =
  | {
      readonly kind: "projection";
      readonly projectionId: string;
    }
  | {
      readonly kind: "scope";
      readonly scopeId: string;
    };

/**
 * One module-authored bounded query surface.
 *
 * `surfaceVersion` is the compatibility boundary for saved queries, planner
 * assumptions, and web editor/view bindings. Change it whenever filter,
 * ordering, parameter, selection, renderer, or source semantics become
 * incompatible with previously retained client state.
 */
export interface ModuleQuerySurfaceSpec {
  readonly defaultPageSize?: number;
  readonly description?: string;
  readonly filters?: readonly QuerySurfaceFilterFieldSpec[];
  readonly label: string;
  readonly ordering?: readonly QuerySurfaceOrderFieldSpec[];
  readonly parameters?: readonly QuerySurfaceParameterSpec[];
  readonly queryKind: Extract<ReadQuery["kind"], "collection" | "scope">;
  readonly renderers?: QuerySurfaceRendererSpec;
  readonly selections?: readonly QuerySurfaceSelectableFieldSpec[];
  readonly source: ModuleQuerySurfaceSourceSpec;
  readonly surfaceId: string;
  readonly surfaceVersion: string;
}

/**
 * One installable module query-surface catalog.
 *
 * `catalogVersion` should change whenever the installed bundle of surfaces is
 * no longer compatible as a group. Callers may use it to invalidate cached
 * registrations or stale editor/planner assumptions across the whole catalog.
 */
export interface ModuleQuerySurfaceCatalog {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly moduleId: string;
  readonly surfaces: readonly ModuleQuerySurfaceSpec[];
}

function assertNonEmptyString(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
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
    assertNonEmptyString(value, label);
    if (seen.has(value)) {
      throw new TypeError(`${label} must not contain duplicate values.`);
    }
    seen.add(value);
  }
}

function dependencyKeyPrefix(kind: DependencyKeyKind): `${DependencyKeyKind}:` {
  return `${kind}:`;
}

function normalizeDependencyKeyValue(kind: DependencyKeyKind, value: string): DependencyKey {
  assertNonEmptyString(value, `${kind} dependency key`);
  if (value.startsWith(dependencyKeyPrefix(kind))) {
    return value as DependencyKey;
  }
  return `${kind}:${value}` as DependencyKey;
}

function isDependencyKeyKind(value: string): value is DependencyKeyKind {
  return (dependencyKeyKinds as readonly string[]).includes(value);
}

function assertDependencyKey(value: string, label: string): asserts value is DependencyKey {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new TypeError(
      `${label} must use a supported dependency key prefix followed by a non-empty value.`,
    );
  }

  const kind = value.slice(0, separatorIndex);
  if (!isDependencyKeyKind(kind)) {
    throw new TypeError(
      `${label} must use a supported dependency key prefix followed by a non-empty value.`,
    );
  }
}

function freezeOptionalUniqueValues(
  values: readonly string[] | undefined,
  label: string,
): readonly string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length === 0) {
    throw new TypeError(`${label} must not be empty when provided.`);
  }

  assertUniqueValues(values, label);
  return Object.freeze([...values]);
}

function freezeQuerySurfaceOptions(
  options: readonly QuerySurfaceOption[] | undefined,
  label: string,
): readonly QuerySurfaceOption[] | undefined {
  if (options === undefined) {
    return undefined;
  }
  if (options.length === 0) {
    throw new TypeError(`${label} must not be empty when provided.`);
  }

  assertUniqueValues(
    options.map((option) => option.value),
    `${label}.value`,
  );

  return Object.freeze(
    options.map((option) => {
      assertNonEmptyString(option.label, `${label}.label`);
      assertNonEmptyString(option.value, `${label}.value`);
      return Object.freeze({ ...option });
    }),
  );
}

function freezeQuerySurfaceFilterFields(
  fields: readonly QuerySurfaceFilterFieldSpec[] | undefined,
): readonly QuerySurfaceFilterFieldSpec[] | undefined {
  if (fields === undefined) {
    return undefined;
  }
  if (fields.length === 0) {
    throw new TypeError("filters must not be empty when provided.");
  }

  assertUniqueValues(
    fields.map((field) => field.fieldId),
    "filters.fieldId",
  );

  return Object.freeze(
    fields.map((field, index) => {
      const path = `filters[${index}]`;
      assertNonEmptyString(field.fieldId, `${path}.fieldId`);
      assertKnownValue(querySurfaceFieldKindValues, field.kind, `${path}.kind`);
      assertNonEmptyString(field.label, `${path}.label`);
      if (field.operators.length === 0) {
        throw new TypeError(`${path}.operators must not be empty.`);
      }
      assertUniqueValues(field.operators, `${path}.operators`);
      for (const operator of field.operators) {
        assertKnownValue(queryFilterOperatorValues, operator, `${path}.operators`);
      }

      const options = freezeQuerySurfaceOptions(field.options, `${path}.options`);
      return Object.freeze({
        ...field,
        operators: Object.freeze([...field.operators]),
        ...(options ? { options } : {}),
      });
    }),
  );
}

function freezeQuerySurfaceOrderFields(
  fields: readonly QuerySurfaceOrderFieldSpec[] | undefined,
): readonly QuerySurfaceOrderFieldSpec[] | undefined {
  if (fields === undefined) {
    return undefined;
  }
  if (fields.length === 0) {
    throw new TypeError("ordering must not be empty when provided.");
  }

  assertUniqueValues(
    fields.map((field) => field.fieldId),
    "ordering.fieldId",
  );

  return Object.freeze(
    fields.map((field, index) => {
      const path = `ordering[${index}]`;
      assertNonEmptyString(field.fieldId, `${path}.fieldId`);
      assertNonEmptyString(field.label, `${path}.label`);
      if (field.directions && field.directions.length === 0) {
        throw new TypeError(`${path}.directions must not be empty when provided.`);
      }
      assertUniqueValues(field.directions ?? [], `${path}.directions`);
      for (const direction of field.directions ?? []) {
        assertKnownValue(queryOrderDirectionValues, direction, `${path}.directions`);
      }

      return Object.freeze({
        ...field,
        ...(field.directions ? { directions: Object.freeze([...field.directions]) } : {}),
      });
    }),
  );
}

function freezeQuerySurfaceSelections(
  selections: readonly QuerySurfaceSelectableFieldSpec[] | undefined,
): readonly QuerySurfaceSelectableFieldSpec[] | undefined {
  if (selections === undefined) {
    return undefined;
  }
  if (selections.length === 0) {
    throw new TypeError("selections must not be empty when provided.");
  }

  assertUniqueValues(
    selections.map((selection) => selection.fieldId),
    "selections.fieldId",
  );

  return Object.freeze(
    selections.map((selection, index) => {
      const path = `selections[${index}]`;
      assertNonEmptyString(selection.fieldId, `${path}.fieldId`);
      assertNonEmptyString(selection.label, `${path}.label`);
      return Object.freeze({ ...selection });
    }),
  );
}

function freezeQuerySurfaceParameters(
  parameters: readonly QuerySurfaceParameterSpec[] | undefined,
): readonly QuerySurfaceParameterSpec[] | undefined {
  if (parameters === undefined) {
    return undefined;
  }
  if (parameters.length === 0) {
    throw new TypeError("parameters must not be empty when provided.");
  }

  assertUniqueValues(
    parameters.map((parameter) => parameter.name),
    "parameters.name",
  );

  return Object.freeze(
    parameters.map((parameter, index) => {
      const path = `parameters[${index}]`;
      assertNonEmptyString(parameter.name, `${path}.name`);
      assertNonEmptyString(parameter.label, `${path}.label`);
      assertKnownValue(queryParameterTypeValues, parameter.type, `${path}.type`);
      return Object.freeze({ ...parameter });
    }),
  );
}

function freezeQuerySurfaceRendererSpec(
  renderer: QuerySurfaceRendererSpec | undefined,
): QuerySurfaceRendererSpec | undefined {
  if (renderer === undefined) {
    return undefined;
  }
  if (renderer.compatibleRendererIds.length === 0) {
    throw new TypeError("renderers.compatibleRendererIds must not be empty.");
  }

  assertUniqueValues(renderer.compatibleRendererIds, "renderers.compatibleRendererIds");
  assertKnownValue(
    querySurfaceRendererResultKindValues,
    renderer.resultKind,
    "renderers.resultKind",
  );

  const sourceKinds = freezeOptionalUniqueValues(renderer.sourceKinds, "renderers.sourceKinds") as
    | readonly QuerySurfaceRendererSourceKind[]
    | undefined;
  for (const sourceKind of sourceKinds ?? []) {
    assertKnownValue(querySurfaceRendererSourceKindValues, sourceKind, "renderers.sourceKinds");
  }

  if (renderer.itemEntityIds !== undefined) {
    assertKnownValue(
      querySurfaceEntityIdSupportValues,
      renderer.itemEntityIds,
      "renderers.itemEntityIds",
    );
  }

  return Object.freeze({
    ...renderer,
    compatibleRendererIds: Object.freeze([...renderer.compatibleRendererIds]),
    ...(sourceKinds ? { sourceKinds } : {}),
  });
}

function freezeInvalidationDelivery(delivery: InvalidationDelivery): InvalidationDelivery {
  assertKnownValue(invalidationDeliveryKinds, delivery.kind, "delivery.kind");

  if (delivery.kind === "cursor-advanced") {
    return Object.freeze({ kind: delivery.kind });
  }

  assertNonEmptyString(delivery.scopeId, "delivery.scopeId");
  assertNonEmptyString(delivery.deltaToken, "delivery.deltaToken");
  return Object.freeze({ ...delivery });
}

function freezeModuleReadScopeRegistrationFallback(
  fallback: ModuleReadScopeRegistration["fallback"],
): ModuleReadScopeRegistration["fallback"] {
  assertKnownValue(
    moduleSyncScopeFallbackReasons,
    fallback.definitionChanged,
    "fallback.definitionChanged",
  );
  assertKnownValue(
    moduleSyncScopeFallbackReasons,
    fallback.policyChanged,
    "fallback.policyChanged",
  );

  return Object.freeze({ ...fallback });
}

function freezeRetainedProjectionInvalidationTarget(
  invalidation: RetainedProjectionInvalidationTarget,
): RetainedProjectionInvalidationTarget {
  assertKnownValue(
    invalidationDeliveryKinds,
    invalidation.deliveryKind,
    "invalidation.deliveryKind",
  );
  if (invalidation.dependencyKeys.length === 0) {
    throw new TypeError("invalidation.dependencyKeys must not be empty.");
  }

  assertUniqueValues(invalidation.dependencyKeys, "invalidation.dependencyKeys");
  for (const dependencyKey of invalidation.dependencyKeys) {
    assertDependencyKey(dependencyKey, "invalidation.dependencyKeys");
  }

  const affectedProjectionIds = freezeOptionalUniqueValues(
    invalidation.affectedProjectionIds,
    "invalidation.affectedProjectionIds",
  );
  const affectedScopeIds = freezeOptionalUniqueValues(
    invalidation.affectedScopeIds,
    "invalidation.affectedScopeIds",
  );

  return Object.freeze({
    ...invalidation,
    dependencyKeys: Object.freeze([...invalidation.dependencyKeys]),
    ...(affectedProjectionIds ? { affectedProjectionIds } : {}),
    ...(affectedScopeIds ? { affectedScopeIds } : {}),
  });
}

/**
 * Normalize a dependency key to the canonical `<kind>:<value>` form.
 *
 * Callers may pass a raw id/value or an already-prefixed dependency key. The
 * returned key always preserves the requested `kind` prefix.
 */
export function createDependencyKey<K extends DependencyKeyKind>(
  kind: K,
  value: string,
): `${K}:${string}` {
  return normalizeDependencyKeyValue(kind, value) as `${K}:${string}`;
}

export function createPredicateDependencyKey(predicateId: string): `predicate:${string}` {
  return createDependencyKey("predicate", predicateId);
}

export function createProjectionDependencyKey(projectionId: string): `projection:${string}` {
  return createDependencyKey("projection", projectionId);
}

export function createScopeDependencyKey(scopeId: string): `scope:${string}` {
  return createDependencyKey("scope", scopeId);
}

export function createShardDependencyKey(shardId: string): `shard:${string}` {
  return createDependencyKey("shard", shardId);
}

export function isDependencyKey(value: unknown): value is DependencyKey {
  if (typeof value !== "string") {
    return false;
  }

  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return false;
  }

  return isDependencyKeyKind(value.slice(0, separatorIndex));
}

export function defineModuleReadScopeDefinition<const T extends ModuleReadScopeDefinition>(
  definition: T,
): Readonly<T> {
  assertKnownValue(["module"] as const, definition.kind, "kind");
  assertNonEmptyString(definition.moduleId, "moduleId");
  assertNonEmptyString(definition.scopeId, "scopeId");
  assertNonEmptyString(definition.definitionHash, "definitionHash");

  return Object.freeze({ ...definition });
}

export function defineModuleReadScopeRegistration<const T extends ModuleReadScopeRegistration>(
  registration: T,
): Readonly<T> {
  const definition = defineModuleReadScopeDefinition(registration.definition);
  const fallback = freezeModuleReadScopeRegistrationFallback(registration.fallback);

  return Object.freeze({
    ...registration,
    definition,
    fallback,
  });
}

export function defineModuleReadScopeRegistry<
  const T extends readonly ModuleReadScopeRegistration[],
>(registrations: T): Readonly<T> {
  if (registrations.length === 0) {
    throw new TypeError("Module read-scope registry must not be empty.");
  }

  const normalized = registrations.map((registration) =>
    defineModuleReadScopeRegistration(registration),
  ) as unknown as T;
  assertUniqueValues(
    normalized.map(
      (registration) =>
        `${registration.definition.moduleId}:${registration.definition.scopeId}:${registration.definition.definitionHash}`,
    ),
    "definition",
  );

  return Object.freeze(normalized) as Readonly<T>;
}

export function createModuleReadScopeRequest(
  definition: ModuleReadScopeDefinition,
): ModuleSyncScopeRequest {
  return createModuleSyncScopeRequest({
    moduleId: definition.moduleId,
    scopeId: definition.scopeId,
  });
}

export function createModuleReadScope(
  definition: ModuleReadScopeDefinition,
  policyFilterVersion: string,
): ModuleSyncScope {
  assertNonEmptyString(policyFilterVersion, "policyFilterVersion");
  return createModuleSyncScope({
    moduleId: definition.moduleId,
    scopeId: definition.scopeId,
    definitionHash: definition.definitionHash,
    policyFilterVersion,
  });
}

export function matchesModuleReadScopeRequest(
  scope: SyncScope | SyncScopeRequest,
  definition: Pick<ModuleReadScopeDefinition, "moduleId" | "scopeId">,
): boolean {
  return (
    scope.kind === "module" &&
    scope.moduleId === definition.moduleId &&
    scope.scopeId === definition.scopeId
  );
}

export function matchesModuleReadScope(
  scope: SyncScope,
  definition: ModuleReadScopeDefinition,
): boolean {
  return (
    scope.kind === "module" &&
    scope.moduleId === definition.moduleId &&
    scope.scopeId === definition.scopeId &&
    scope.definitionHash === definition.definitionHash
  );
}

export function createRegisteredModuleReadScopeRequest(
  registration: ModuleReadScopeRegistration,
): ModuleSyncScopeRequest {
  return createModuleReadScopeRequest(registration.definition);
}

export function createRegisteredModuleReadScope(
  registration: ModuleReadScopeRegistration,
  policyFilterVersion: string,
): ModuleSyncScope {
  return createModuleReadScope(registration.definition, policyFilterVersion);
}

export function matchesModuleReadScopeRegistration(
  scope: SyncScope | SyncScopeRequest,
  registration: ModuleReadScopeRegistration,
): boolean {
  return matchesModuleReadScopeRequest(scope, registration.definition);
}

export function findModuleReadScopeRegistration<T extends ModuleReadScopeRegistration>(
  registrations: readonly T[],
  scope: SyncScope | SyncScopeRequest,
): T | undefined {
  return registrations.find((registration) =>
    matchesModuleReadScopeRegistration(scope, registration),
  );
}

export function defineProjectionSpec<const T extends ProjectionSpec>(spec: T): Readonly<T> {
  assertNonEmptyString(spec.projectionId, "projectionId");
  assertKnownValue(projectionKinds, spec.kind, "kind");
  assertNonEmptyString(spec.definitionHash, "definitionHash");
  assertKnownValue(projectionRebuildStrategies, spec.rebuildStrategy, "rebuildStrategy");
  assertKnownValue(projectionVisibilityModes, spec.visibilityMode, "visibilityMode");
  if (spec.sourceScopeKinds.length === 0) {
    throw new TypeError("sourceScopeKinds must not be empty.");
  }
  if (spec.dependencyKeys.length === 0) {
    throw new TypeError("dependencyKeys must not be empty.");
  }

  assertUniqueValues(spec.sourceScopeKinds, "sourceScopeKinds");
  for (const sourceScopeKind of spec.sourceScopeKinds) {
    assertKnownValue(projectionSourceScopeKinds, sourceScopeKind, "sourceScopeKinds");
  }

  assertUniqueValues(spec.dependencyKeys, "dependencyKeys");
  for (const dependencyKey of spec.dependencyKeys) {
    assertDependencyKey(dependencyKey, "dependencyKeys");
  }

  return Object.freeze({
    ...spec,
    sourceScopeKinds: Object.freeze([...spec.sourceScopeKinds]),
    dependencyKeys: Object.freeze([...spec.dependencyKeys]),
  });
}

export function defineModuleQuerySurfaceSpec<const T extends ModuleQuerySurfaceSpec>(
  spec: T,
): Readonly<T> {
  assertNonEmptyString(spec.surfaceId, "surfaceId");
  assertNonEmptyString(spec.surfaceVersion, "surfaceVersion");
  assertNonEmptyString(spec.label, "label");
  assertKnownValue(moduleQuerySurfaceQueryKinds, spec.queryKind, "queryKind");

  if (spec.defaultPageSize !== undefined) {
    assertPositiveInteger(spec.defaultPageSize, "defaultPageSize");
  }

  assertKnownValue(["projection", "scope"] as const, spec.source.kind, "source.kind");
  if (spec.source.kind === "projection") {
    assertNonEmptyString(spec.source.projectionId, "source.projectionId");
    if (spec.queryKind !== "collection") {
      throw new TypeError('scope query surfaces must use source.kind "scope".');
    }
  }
  if (spec.source.kind === "scope") {
    assertNonEmptyString(spec.source.scopeId, "source.scopeId");
    if (spec.queryKind !== "scope") {
      throw new TypeError('collection query surfaces must use source.kind "projection".');
    }
  }

  const filters = freezeQuerySurfaceFilterFields(spec.filters);
  const ordering = freezeQuerySurfaceOrderFields(spec.ordering);
  if (spec.queryKind !== "collection" && (filters || ordering)) {
    throw new TypeError("scope query surfaces must not declare filters or ordering.");
  }

  const selections = freezeQuerySurfaceSelections(spec.selections);
  const parameters = freezeQuerySurfaceParameters(spec.parameters);
  const renderers = freezeQuerySurfaceRendererSpec(spec.renderers);

  return Object.freeze({
    ...spec,
    source: Object.freeze({ ...spec.source }),
    ...(filters ? { filters } : {}),
    ...(ordering ? { ordering } : {}),
    ...(selections ? { selections } : {}),
    ...(parameters ? { parameters } : {}),
    ...(renderers ? { renderers } : {}),
  });
}

export function defineModuleQuerySurfaceCatalog<const T extends ModuleQuerySurfaceCatalog>(
  catalog: T,
): Readonly<T> {
  assertNonEmptyString(catalog.catalogId, "catalogId");
  assertNonEmptyString(catalog.catalogVersion, "catalogVersion");
  assertNonEmptyString(catalog.moduleId, "moduleId");
  if (catalog.surfaces.length === 0) {
    throw new TypeError("surfaces must not be empty.");
  }

  const surfaces = catalog.surfaces.map((surface) => defineModuleQuerySurfaceSpec(surface));
  assertUniqueValues(
    surfaces.map((surface) => surface.surfaceId),
    "surfaceId",
  );

  return Object.freeze({
    ...catalog,
    surfaces: Object.freeze(surfaces),
  }) as Readonly<T>;
}

export function defineInvalidationEvent<const T extends InvalidationEvent>(event: T): Readonly<T> {
  assertNonEmptyString(event.eventId, "eventId");
  assertNonEmptyString(event.graphId, "graphId");
  assertNonEmptyString(event.sourceCursor, "sourceCursor");
  if (event.dependencyKeys.length === 0) {
    throw new TypeError("dependencyKeys must not be empty.");
  }

  assertUniqueValues(event.dependencyKeys, "dependencyKeys");
  for (const dependencyKey of event.dependencyKeys) {
    assertDependencyKey(dependencyKey, "dependencyKeys");
  }

  const affectedProjectionIds = freezeOptionalUniqueValues(
    event.affectedProjectionIds,
    "affectedProjectionIds",
  );
  const affectedScopeIds = freezeOptionalUniqueValues(event.affectedScopeIds, "affectedScopeIds");
  const delivery = freezeInvalidationDelivery(event.delivery);

  if (delivery.kind === "scoped-delta" && !affectedScopeIds?.includes(delivery.scopeId)) {
    throw new TypeError(
      'affectedScopeIds must include delivery.scopeId when delivery.kind is "scoped-delta".',
    );
  }

  return Object.freeze({
    ...event,
    dependencyKeys: Object.freeze([...event.dependencyKeys]),
    ...(affectedProjectionIds ? { affectedProjectionIds } : {}),
    ...(affectedScopeIds ? { affectedScopeIds } : {}),
    delivery,
  });
}

export function isInvalidationEventCompatibleWithTarget(
  event: Pick<InvalidationEvent, "dependencyKeys" | "affectedScopeIds">,
  target: InvalidationTarget,
): boolean {
  if (target.scopeId && event.affectedScopeIds?.includes(target.scopeId)) {
    return true;
  }

  const dependencyKeys = new Set(event.dependencyKeys);
  return target.dependencyKeys.some((dependencyKey) => dependencyKeys.has(dependencyKey));
}

export function isRetainedProjectionMetadataCompatible(
  record: RetainedProjectionMetadata,
  metadata: RetainedProjectionMetadata,
): boolean {
  return (
    record.projectionId === metadata.projectionId &&
    record.definitionHash === metadata.definitionHash
  );
}

export function findRetainedProjectionRecord<T extends RetainedProjectionMetadata>(
  records: readonly T[],
  metadata: RetainedProjectionMetadata,
): RetainedProjectionRecordLookupResult<T> {
  const matchesByProjectionId = records.filter(
    (record) => record.projectionId === metadata.projectionId,
  );
  const exactMatch = matchesByProjectionId.find((record) =>
    isRetainedProjectionMetadataCompatible(record, metadata),
  );

  if (exactMatch) {
    return {
      kind: "match",
      record: exactMatch,
    };
  }

  if (matchesByProjectionId.length > 0) {
    return {
      kind: "definition-hash-mismatch",
      projectionId: metadata.projectionId,
      expectedDefinitionHash: metadata.definitionHash,
      actualDefinitionHashes: Object.freeze(
        [...new Set(matchesByProjectionId.map((record) => record.definitionHash))].sort(
          (left, right) => left.localeCompare(right),
        ),
      ),
    };
  }

  return {
    kind: "missing",
    projectionId: metadata.projectionId,
    expectedDefinitionHash: metadata.definitionHash,
  };
}

export function defineProjectionCatalog<const T extends readonly ProjectionSpec[]>(
  projections: T,
): Readonly<T> {
  if (projections.length === 0) {
    throw new TypeError("Projection catalog must not be empty.");
  }

  const projectionIds = projections.map((projection) => projection.projectionId);
  assertUniqueValues(projectionIds, "projectionId");

  return Object.freeze([...projections]) as Readonly<T>;
}

export function defineRetainedProjectionProviderRegistration<
  const T extends RetainedProjectionProviderRegistration,
>(registration: T): Readonly<T> {
  assertNonEmptyString(registration.providerId, "providerId");
  if (registration.scopeDefinitions.length === 0) {
    throw new TypeError("scopeDefinitions must not be empty.");
  }
  if (registration.projections.length === 0) {
    throw new TypeError("projections must not be empty.");
  }

  const scopeDefinitions = registration.scopeDefinitions.map((definition) =>
    defineModuleReadScopeDefinition(definition),
  ) as T["scopeDefinitions"];
  assertUniqueValues(
    scopeDefinitions.map(
      (definition) => `${definition.moduleId}:${definition.scopeId}:${definition.definitionHash}`,
    ),
    "scopeDefinitions",
  );

  const projections = defineProjectionCatalog(registration.projections) as T["projections"];
  const recovery = registration.recovery;
  assertKnownValue(retainedProjectionRecoveryModes, recovery.missing, "recovery.missing");
  assertKnownValue(retainedProjectionRecoveryModes, recovery.incompatible, "recovery.incompatible");
  assertKnownValue(retainedProjectionRecoveryModes, recovery.stale, "recovery.stale");
  const invalidation = registration.invalidation
    ? freezeRetainedProjectionInvalidationTarget(registration.invalidation)
    : undefined;

  return Object.freeze({
    ...registration,
    scopeDefinitions: Object.freeze([...scopeDefinitions]) as T["scopeDefinitions"],
    projections,
    recovery: Object.freeze({ ...recovery }),
    ...(invalidation ? { invalidation } : {}),
  });
}

export function defineRetainedProjectionProviderRegistry<
  const T extends readonly RetainedProjectionProviderRegistration[],
>(registrations: T): Readonly<T> {
  if (registrations.length === 0) {
    throw new TypeError("Retained projection provider registry must not be empty.");
  }

  const normalized = registrations.map((registration) =>
    defineRetainedProjectionProviderRegistration(registration),
  ) as unknown as T;
  assertUniqueValues(
    normalized.map((registration) => registration.providerId),
    "providerId",
  );
  assertUniqueValues(
    normalized.flatMap((registration) =>
      registration.projections.map((projection) => projection.projectionId),
    ),
    "projectionId",
  );

  return Object.freeze(normalized) as Readonly<T>;
}

export function matchesRetainedProjectionProviderScope(
  registration: RetainedProjectionProviderRegistration,
  scope: SyncScope | SyncScopeRequest | ModuleReadScopeDefinition,
): boolean {
  return registration.scopeDefinitions.some((definition) =>
    matchesModuleReadScopeRequest(scope, definition),
  );
}

export function listRetainedProjectionProvidersForScope<
  T extends RetainedProjectionProviderRegistration,
>(
  registrations: readonly T[],
  scope: SyncScope | SyncScopeRequest | ModuleReadScopeDefinition,
): readonly T[] {
  return registrations.filter((registration) =>
    matchesRetainedProjectionProviderScope(registration, scope),
  );
}

export function findRetainedProjectionProviderByProjectionId<
  T extends RetainedProjectionProviderRegistration,
>(registrations: readonly T[], projectionId: string): T | undefined {
  return registrations.find((registration) =>
    registration.projections.some((projection) => projection.projectionId === projectionId),
  );
}
