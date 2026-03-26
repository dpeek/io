import {
  createModuleSyncScope,
  createModuleSyncScopeRequest,
  type ModuleSyncScope,
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

export interface ModuleReadScopeDefinition {
  readonly kind: "module";
  readonly moduleId: string;
  readonly scopeId: string;
  readonly definitionHash: string;
}

export interface ProjectionSpec {
  readonly projectionId: string;
  readonly kind: ProjectionKind;
  readonly definitionHash: string;
  readonly sourceScopeKinds: readonly ProjectionSourceScopeKind[];
  readonly dependencyKeys: readonly ProjectionDependencyKey[];
  readonly rebuildStrategy: ProjectionRebuildStrategy;
  readonly visibilityMode: ProjectionVisibilityMode;
}

export interface RetainedProjectionMetadata<
  ProjectionId extends string = string,
  DefinitionHash extends string = string,
> {
  readonly projectionId: ProjectionId;
  readonly definitionHash: DefinitionHash;
}

export interface RetainedProjectionCheckpointRecord<
  ProjectionId extends string = string,
  DefinitionHash extends string = string,
> extends RetainedProjectionMetadata<ProjectionId, DefinitionHash> {
  readonly sourceCursor: string;
  readonly projectionCursor: string;
  readonly projectedAt: string;
}

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

function assertNonEmptyString(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
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

function freezeInvalidationDelivery(delivery: InvalidationDelivery): InvalidationDelivery {
  if (delivery.kind === "cursor-advanced") {
    return Object.freeze({ kind: delivery.kind });
  }

  assertNonEmptyString(delivery.scopeId, "delivery.scopeId");
  assertNonEmptyString(delivery.deltaToken, "delivery.deltaToken");
  return Object.freeze({ ...delivery });
}

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
  assertNonEmptyString(definition.moduleId, "moduleId");
  assertNonEmptyString(definition.scopeId, "scopeId");
  assertNonEmptyString(definition.definitionHash, "definitionHash");

  return Object.freeze({ ...definition });
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

export function defineProjectionSpec<const T extends ProjectionSpec>(spec: T): Readonly<T> {
  assertNonEmptyString(spec.projectionId, "projectionId");
  assertNonEmptyString(spec.definitionHash, "definitionHash");
  if (spec.sourceScopeKinds.length === 0) {
    throw new TypeError("sourceScopeKinds must not be empty.");
  }
  if (spec.dependencyKeys.length === 0) {
    throw new TypeError("dependencyKeys must not be empty.");
  }

  assertUniqueValues(spec.sourceScopeKinds, "sourceScopeKinds");
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
        [...new Set(matchesByProjectionId.map((record) => record.definitionHash))].sort(),
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
