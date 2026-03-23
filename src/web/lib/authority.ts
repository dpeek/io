import {
  type AuthSubjectRef,
  type AuthorizationContext,
  type AnyTypeOutput,
  type AuthoritativeWriteScope,
  authorizeCommand,
  authorizeRead,
  authorizeWrite,
  bootstrap,
  collectScalarCodecs,
  collectTypeIndex,
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  createModuleSyncScope,
  createPersistedAuthoritativeGraph,
  createStore,
  createTypeClient,
  edgeId,
  fieldPolicyDescriptor,
  GraphValidationError,
  type GraphCommandPolicy,
  type GraphFieldAuthority,
  isEntityType,
  isSecretBackedField,
  type ModuleSyncScope,
  type PrincipalKind,
  type Cardinality,
  type GraphWriteTransaction,
  type NamespaceClient,
  type PersistedAuthoritativeGraph,
  type PersistedAuthoritativeGraphStorageCommitInput,
  type PersistedAuthoritativeGraphStoragePersistInput,
  type PersistedAuthoritativeGraphStorage,
  type PersistedAuthoritativeGraphStorageLoadResult,
  type PolicyError,
  type PredicatePolicyDescriptor,
  readPredicateValue as decodePredicateValue,
  type ReplicationReadAuthorizer,
  type Store,
  type StoreSnapshot,
  type AuthoritativeGraphWriteResult,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import {
  workflowSchema,
  type WorkflowMutationAction,
  type WorkflowMutationResult,
} from "@io/core/graph/modules/ops/workflow";
import { pkm } from "@io/core/graph/modules/pkm";

import type { SessionPrincipalLookupInput, SessionPrincipalProjection } from "./auth-bridge.js";
import { seedExampleGraph } from "./example-data.js";
import { planRecordedMutation } from "./mutation-planning.js";
import {
  buildSecretHandleName,
  secretFieldEntityIdRequiredMessage,
  secretFieldPlaintextRequiredMessage,
  secretFieldPredicateIdRequiredMessage,
  type WriteSecretFieldInput,
  type WriteSecretFieldResult,
} from "./secret-fields.js";
import {
  workflowModuleId,
  workflowReviewScopeDefinitionHash,
  workflowReviewScopeId,
} from "./sync-scopes.js";
import { runWorkflowMutationCommand } from "./workflow-authority.js";

const webAppGraph = { ...core, ...pkm, ...ops } as const;

type WebAppGraph = typeof webAppGraph;
type PersistedWebAppAuthority = PersistedAuthoritativeGraph<WebAppGraph>;
type WebAppAuthorityGraph = WebAppGraph & Record<string, AnyTypeOutput>;
type CompiledFieldDefinition = {
  readonly field: {
    readonly authority?: GraphFieldAuthority;
    readonly cardinality: Cardinality;
    readonly key: string;
    readonly meta?: {
      readonly label?: string;
    };
    readonly range: string;
  };
  readonly fieldLabel: string;
  readonly ownerTypeIds: ReadonlySet<string>;
  readonly pathLabel: string;
  readonly policy: PredicatePolicyDescriptor;
};
type CompiledGraphArtifacts = {
  readonly bootstrappedSnapshot: StoreSnapshot;
  readonly compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>;
  readonly scalarByKey: ReturnType<typeof collectScalarCodecs>;
  readonly typeByKey: ReturnType<typeof collectTypeIndex>;
};

export type WebAppAuthoritySecretRecord = {
  readonly value: string;
  readonly version: number;
  readonly storedAt?: string;
  readonly provider?: string;
  readonly fingerprint?: string;
  readonly externalKeyId?: string;
};

export type WebAppAuthoritySecretWrite = WebAppAuthoritySecretRecord & {
  readonly secretId: string;
};

export type WebAppAuthorityGraphSyncScopeRequest = {
  readonly kind?: "graph";
};

export type WebAppAuthorityModuleSyncScopeRequest = {
  readonly kind: "module";
  readonly moduleId: string;
  readonly scopeId: string;
};

export type WebAppAuthoritySyncScopeRequest =
  | WebAppAuthorityGraphSyncScopeRequest
  | WebAppAuthorityModuleSyncScopeRequest;

export type WriteSecretFieldWebAuthorityCommand = {
  readonly kind: "write-secret-field";
  readonly input: WriteSecretFieldInput;
};

export type WorkflowMutationWebAppAuthorityCommand = {
  readonly kind: "workflow-mutation";
  readonly input: WorkflowMutationAction;
};

export type WebAppAuthorityCommand =
  | WriteSecretFieldWebAuthorityCommand
  | WorkflowMutationWebAppAuthorityCommand;

type WebAppAuthorityCommandResultMap = {
  "write-secret-field": WriteSecretFieldResult;
  "workflow-mutation": WorkflowMutationResult;
};

export type WebAppAuthorityCommandResult<
  Kind extends WebAppAuthorityCommand["kind"] = WebAppAuthorityCommand["kind"],
> = WebAppAuthorityCommandResultMap[Kind];

export type WebAppAuthoritySessionPrincipalLookupOptions = {
  readonly allowRepair?: boolean;
};

const compiledGraphArtifactsCache = new WeakMap<WebAppAuthorityGraph, CompiledGraphArtifacts>();

/**
 * Consumer-owned `/api/commands` proof envelope.
 *
 * Branch 1 keeps the shared surface below this union at graph write
 * transactions, authoritative write scopes, sync payloads, and persisted
 * authority APIs.
 */
export type WebAuthorityCommand = WebAppAuthorityCommand;
export type WebAuthorityCommandResult<
  Kind extends WebAuthorityCommand["kind"] = WebAuthorityCommand["kind"],
> = WebAppAuthorityCommandResult<Kind>;

type WebAuthorityMutationRollback = () => void;
type WebAuthorityMutationStageContext = {
  addRollback(rollback: WebAuthorityMutationRollback): void;
};

/**
 * Web authority storage adds secret side-storage to the shared graph/runtime
 * persisted-authority boundary. Only the adapted graph state contract should be
 * treated as stable across branches.
 */
export interface WebAppAuthorityStorage {
  load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null>;
  /**
   * Branch 1 retains authority-only plaintext rows even after the replicated
   * secret-backed reference or its owning entity is retracted. Cleanup policy
   * stays deferred to later lifecycle work.
   */
  loadSecrets(): Promise<Record<string, WebAppAuthoritySecretRecord>>;
  commit(
    input: PersistedAuthoritativeGraphStorageCommitInput,
    options?: {
      readonly secretWrite?: WebAppAuthoritySecretWrite;
    },
  ): Promise<void>;
  persist(input: PersistedAuthoritativeGraphStoragePersistInput): Promise<void>;
}

type WebAppAuthoritySyncFreshness = NonNullable<
  Parameters<PersistedWebAppAuthority["createSyncPayload"]>[0]
>["freshness"];
type WebAppAuthorityWriteScope = NonNullable<
  Parameters<PersistedWebAppAuthority["applyTransaction"]>[1]
>["writeScope"];

export type WebAppAuthoritySyncOptions = {
  readonly authorization: AuthorizationContext;
  readonly freshness?: WebAppAuthoritySyncFreshness;
  readonly scope?: WebAppAuthoritySyncScopeRequest;
};

export type WebAppAuthorityReadOptions = {
  readonly authorization: AuthorizationContext;
};

export type WebAppAuthorityPredicateReadOptions = WebAppAuthorityReadOptions & {
  readonly strictRequired?: boolean;
};

export type WebAppAuthorityTransactionOptions = {
  readonly authorization: AuthorizationContext;
  readonly writeScope?: WebAppAuthorityWriteScope;
};

export type WebAppAuthoritySecretFieldOptions = {
  readonly authorization: AuthorizationContext;
};

export type WebAppAuthorityCommandOptions = {
  readonly authorization: AuthorizationContext;
};

export type WebAppAuthority = Omit<
  PersistedWebAppAuthority,
  "applyTransaction" | "createSyncPayload" | "getIncrementalSyncResult" | "graph" | "store"
> & {
  lookupSessionPrincipal(
    input: SessionPrincipalLookupInput,
    options?: WebAppAuthoritySessionPrincipalLookupOptions,
  ): Promise<SessionPrincipalProjection>;
  readSnapshot(options: WebAppAuthorityReadOptions): StoreSnapshot;
  readPredicateValue(
    subjectId: string,
    predicateId: string,
    options: WebAppAuthorityPredicateReadOptions,
  ): unknown;
  createSyncPayload(
    options: WebAppAuthoritySyncOptions,
  ): ReturnType<PersistedWebAppAuthority["createSyncPayload"]>;
  applyTransaction(
    transaction: GraphWriteTransaction,
    options: WebAppAuthorityTransactionOptions,
  ): ReturnType<PersistedWebAppAuthority["applyTransaction"]>;
  getIncrementalSyncResult(
    after: string | undefined,
    options: WebAppAuthoritySyncOptions,
  ): ReturnType<PersistedWebAppAuthority["getIncrementalSyncResult"]>;
  executeCommand<Command extends WebAppAuthorityCommand>(
    command: Command,
    options: WebAppAuthorityCommandOptions,
  ): Promise<WebAppAuthorityCommandResult<Command["kind"]>>;
  writeSecretField(
    input: WriteSecretFieldInput,
    options: WebAppAuthoritySecretFieldOptions,
  ): Promise<WriteSecretFieldResult>;
};

export type WebAppAuthorityOptions = {
  readonly graph?: WebAppAuthorityGraph;
  readonly maxRetainedTransactions?: number;
  readonly seedExampleGraph?: boolean;
};

const typePredicateId = edgeId(core.node.fields.type);
const namePredicateId = edgeId(core.node.fields.name);
const labelPredicateId = edgeId(core.node.fields.label);
const createdAtPredicateId = edgeId(core.node.fields.createdAt);
const updatedAtPredicateId = edgeId(core.node.fields.updatedAt);
const secretHandleVersionPredicateId = edgeId(core.secretHandle.fields.version);
const secretHandleLastRotatedAtPredicateId = edgeId(core.secretHandle.fields.lastRotatedAt);
const principalKindPredicateId = edgeId(core.principal.fields.kind);
const principalStatusPredicateId = edgeId(core.principal.fields.status);
const graphWriteTransactionValidationKey = "$sync:tx";
const webAppAuthorityPolicyVersion = 0;
const webAppGraphId = "graph:global";
const webAppAuthorityCapabilityKeys: readonly string[] = [];
const authorityRoleKey = "graph:authority";
const writeSecretFieldCommandKey = "write-secret-field";
const writeSecretFieldCommandBasePredicateIds = [
  typePredicateId,
  createdAtPredicateId,
  namePredicateId,
  updatedAtPredicateId,
  secretHandleVersionPredicateId,
  secretHandleLastRotatedAtPredicateId,
] as const;
const moduleScopeCursorPrefix = "scope:";
const workflowModuleEntityTypeIds = new Set(
  Object.values(workflowSchema)
    .filter(isEntityType)
    .map((typeDef) => {
      const values = typeDef.values as { readonly id?: string; readonly key: string };
      return values.id ?? values.key;
    }),
);
const principalHomeGraphIdPredicateId = edgeId(core.principal.fields.homeGraphId);
const authSubjectProjectionPrincipalPredicateId = edgeId(
  core.authSubjectProjection.fields.principal,
);
const authSubjectProjectionIssuerPredicateId = edgeId(core.authSubjectProjection.fields.issuer);
const authSubjectProjectionProviderPredicateId = edgeId(core.authSubjectProjection.fields.provider);
const authSubjectProjectionProviderAccountIdPredicateId = edgeId(
  core.authSubjectProjection.fields.providerAccountId,
);
const authSubjectProjectionAuthUserIdPredicateId = edgeId(
  core.authSubjectProjection.fields.authUserId,
);
const authSubjectProjectionStatusPredicateId = edgeId(core.authSubjectProjection.fields.status);
const principalRoleBindingPrincipalPredicateId = edgeId(core.principalRoleBinding.fields.principal);
const principalRoleBindingRoleKeyPredicateId = edgeId(core.principalRoleBinding.fields.roleKey);
const principalRoleBindingStatusPredicateId = edgeId(core.principalRoleBinding.fields.status);
const principalTypeId = core.principal.values.id;
const authSubjectProjectionTypeId = core.authSubjectProjection.values.id;
const principalRoleBindingTypeId = core.principalRoleBinding.values.id;
const nonAuthorityHiddenIdentityTypeIds = new Set([
  principalTypeId,
  authSubjectProjectionTypeId,
  principalRoleBindingTypeId,
]);
const activePrincipalStatusId = core.principalStatus.values.active.id;
const activeAuthSubjectStatusId = core.authSubjectStatus.values.active.id;
const activePrincipalRoleBindingStatusId = core.principalRoleBindingStatus.values.active.id;
const principalKindById = new Map<string, PrincipalKind>([
  [core.principalKind.values.human.id, "human"],
  [core.principalKind.values.service.id, "service"],
  [core.principalKind.values.agent.id, "agent"],
  [core.principalKind.values.anonymous.id, "anonymous"],
  [core.principalKind.values.remoteGraph.id, "remoteGraph"],
]);

let authorityCursorEpoch = 0;

function createAuthorityCursorPrefix(): string {
  authorityCursorEpoch = Math.max(authorityCursorEpoch + 1, Date.now());
  return `web-authority:${authorityCursorEpoch}:`;
}

function clonePersistedValue<T>(value: T): T {
  return structuredClone(value);
}

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatPolicyErrorMessage(error: PolicyError): string {
  return `${error.code}: ${error.message}`;
}

function createFallbackPolicyDescriptor(
  field: CompiledFieldDefinition["field"],
): PredicatePolicyDescriptor {
  return {
    predicateId: edgeId(field),
    transportVisibility: field.authority?.visibility ?? "replicated",
    requiredWriteScope: field.authority?.write ?? "client-tx",
    readAudience:
      (field.authority?.visibility ?? "replicated") === "authority-only" ? "authority" : "public",
    writeAudience: "authority",
    shareable: false,
  } satisfies PredicatePolicyDescriptor;
}

function resolveCompiledFieldPolicy(
  field: CompiledFieldDefinition["field"],
): PredicatePolicyDescriptor {
  return fieldPolicyDescriptor(field) ?? createFallbackPolicyDescriptor(field);
}

function assertCurrentPolicyVersion(authorization: AuthorizationContext): PolicyError | undefined {
  if (authorization.policyVersion === webAppAuthorityPolicyVersion) {
    return undefined;
  }

  return {
    code: "policy.stale_context",
    message: `Authorization context policy version "${authorization.policyVersion}" does not match authority policy version "${webAppAuthorityPolicyVersion}". Refresh the authorization context and retry.`,
    retryable: false,
    refreshRequired: true,
  };
}

class WebAppAuthorityMutationError extends Error {
  readonly status: number;
  readonly code?: PolicyError["code"];
  readonly retryable?: boolean;
  readonly refreshRequired?: boolean;

  constructor(
    status: number,
    message: string,
    options: Partial<Pick<PolicyError, "code" | "retryable" | "refreshRequired">> = {},
  ) {
    super(message);
    this.name = "WebAppAuthorityMutationError";
    this.status = status;
    this.code = options.code;
    this.retryable = options.retryable;
    this.refreshRequired = options.refreshRequired;
  }
}

function isDefinitionField(
  value: unknown,
): value is CompiledFieldDefinition["field"] & Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CompiledFieldDefinition["field"]>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.range === "string" &&
    typeof candidate.cardinality === "string"
  );
}

function getFieldLabel(field: CompiledFieldDefinition["field"]): string {
  if (field.meta?.label) return field.meta.label;
  const segments = field.key.split(":");
  return segments.at(-1) ?? field.key;
}

function flattenSecretFieldDefinitions(
  tree: Record<string, unknown>,
  ownerTypeId: string,
  path: string[] = [],
  entries = new Map<string, CompiledFieldDefinition>(),
): Map<string, CompiledFieldDefinition> {
  for (const [fieldName, value] of Object.entries(tree)) {
    if (isDefinitionField(value)) {
      const predicateId = edgeId(value);
      const existing = entries.get(predicateId);
      if (existing) {
        entries.set(predicateId, {
          ...existing,
          ownerTypeIds: new Set([...existing.ownerTypeIds, ownerTypeId]),
        });
        continue;
      }

      entries.set(predicateId, {
        field: value,
        fieldLabel: getFieldLabel(value),
        ownerTypeIds: new Set([ownerTypeId]),
        pathLabel: [...path, fieldName].join("."),
        policy: resolveCompiledFieldPolicy(value),
      });
      continue;
    }

    if (!value || typeof value !== "object") continue;
    flattenSecretFieldDefinitions(
      value as Record<string, unknown>,
      ownerTypeId,
      [...path, fieldName],
      entries,
    );
  }

  return entries;
}

function buildCompiledFieldIndex(
  graph: Record<string, AnyTypeOutput>,
): ReadonlyMap<string, CompiledFieldDefinition> {
  const entries = new Map<string, CompiledFieldDefinition>();

  for (const typeDef of Object.values(graph)) {
    if (!isEntityType(typeDef)) continue;
    const typeValues = typeDef.values as { readonly key: string; readonly id?: string };
    flattenSecretFieldDefinitions(typeDef.fields, typeValues.id ?? typeValues.key, [], entries);
  }

  return entries;
}

function getCompiledGraphArtifacts(graph: WebAppAuthorityGraph): CompiledGraphArtifacts {
  const cached = compiledGraphArtifactsCache.get(graph);
  if (cached) return cached;

  const bootstrappedStore = createStore();
  bootstrap(bootstrappedStore, graph);
  const compiled = {
    bootstrappedSnapshot: bootstrappedStore.snapshot(),
    compiledFieldIndex: buildCompiledFieldIndex(graph),
    scalarByKey: collectScalarCodecs(graph),
    typeByKey: collectTypeIndex(graph),
  };

  compiledGraphArtifactsCache.set(graph, compiled);
  return compiled;
}

function buildTransactionValidationError(
  transaction: GraphWriteTransaction,
  issues: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly path: readonly string[];
  }>,
): GraphValidationError<GraphWriteTransaction> {
  return new GraphValidationError({
    ok: false,
    phase: "authoritative",
    event: "reconcile",
    value: transaction,
    changedPredicateKeys: issues.length > 0 ? [graphWriteTransactionValidationKey] : [],
    issues: issues.map((issue) => ({
      source: "runtime" as const,
      code: issue.code,
      message: issue.message,
      path: Object.freeze([...issue.path]),
      predicateKey: graphWriteTransactionValidationKey,
      nodeId: graphWriteTransactionValidationKey,
    })),
  });
}

function resolveCommandErrorStatus(error: PolicyError): number {
  switch (error.code) {
    case "auth.unauthenticated":
      return 401;
    case "policy.stale_context":
      return 409;
    default:
      return 403;
  }
}

function resolveReadErrorStatus(error: PolicyError): number {
  return resolveCommandErrorStatus(error);
}

function createCommandPolicyError(error: PolicyError): WebAppAuthorityMutationError {
  return new WebAppAuthorityMutationError(
    resolveCommandErrorStatus(error),
    formatPolicyErrorMessage(error),
    {
      code: error.code,
      retryable: error.retryable,
      refreshRequired: error.refreshRequired,
    },
  );
}

class WebAppAuthorityReadError extends Error {
  readonly status: number;
  readonly code?: PolicyError["code"];
  readonly retryable?: boolean;
  readonly refreshRequired?: boolean;

  constructor(
    status: number,
    message: string,
    options: Partial<Pick<PolicyError, "code" | "retryable" | "refreshRequired">> = {},
  ) {
    super(message);
    this.name = "WebAppAuthorityReadError";
    this.status = status;
    this.code = options.code;
    this.retryable = options.retryable;
    this.refreshRequired = options.refreshRequired;
  }
}

function createReadPolicyError(error: PolicyError): WebAppAuthorityReadError {
  return new WebAppAuthorityReadError(
    resolveReadErrorStatus(error),
    formatPolicyErrorMessage(error),
    {
      code: error.code,
      retryable: error.retryable,
      refreshRequired: error.refreshRequired,
    },
  );
}

type PlannedWebAppAuthorityScope = {
  readonly scope: ModuleSyncScope;
  readonly typeIds: ReadonlySet<string>;
};

function isGraphScopeRequest(
  scope: WebAppAuthoritySyncScopeRequest | undefined,
): scope is WebAppAuthorityGraphSyncScopeRequest | undefined {
  return scope === undefined || scope.kind === undefined || scope.kind === "graph";
}

function createPolicyFilterVersion(policyVersion: number): string {
  return `policy:${policyVersion}`;
}

function formatScopedModuleCursor(scope: ModuleSyncScope, cursor: string): string {
  const params = new URLSearchParams();
  params.set("kind", scope.kind);
  params.set("moduleId", scope.moduleId);
  params.set("scopeId", scope.scopeId);
  params.set("definitionHash", scope.definitionHash);
  params.set("policyFilterVersion", scope.policyFilterVersion);
  params.set("cursor", cursor);
  return `${moduleScopeCursorPrefix}${params.toString()}`;
}

function parseScopedModuleCursor(
  cursor: string,
): (ModuleSyncScope & { readonly cursor: string }) | null {
  if (!cursor.startsWith(moduleScopeCursorPrefix)) return null;

  const params = new URLSearchParams(cursor.slice(moduleScopeCursorPrefix.length));
  if (params.get("kind") !== "module") return null;
  const moduleId = params.get("moduleId");
  const scopeId = params.get("scopeId");
  const definitionHash = params.get("definitionHash");
  const policyFilterVersion = params.get("policyFilterVersion");
  const graphCursor = params.get("cursor");
  if (!moduleId || !scopeId || !definitionHash || !policyFilterVersion || !graphCursor) {
    return null;
  }

  return {
    ...createModuleSyncScope({
      moduleId,
      scopeId,
      definitionHash,
      policyFilterVersion,
    }),
    cursor: graphCursor,
  };
}

function resolveScopedSubjectId(
  operation: GraphWriteTransaction["ops"][number],
  edgeById: Map<string, StoreSnapshot["edges"][number]>,
): string | undefined {
  if (operation.op === "assert") return operation.edge.s;
  return edgeById.get(operation.edgeId)?.s;
}

function subjectTypeId(store: Store, subjectId: string): string | undefined {
  return store.get(subjectId, typePredicateId) ?? store.find(subjectId, typePredicateId)[0]?.o;
}

function scopeIncludesSubject(
  store: Store,
  typeIds: ReadonlySet<string>,
  subjectId: string,
): boolean {
  const currentTypeId = subjectTypeId(store, subjectId);
  return currentTypeId !== undefined && typeIds.has(currentTypeId);
}

function filterModuleScopedSnapshot(
  snapshot: StoreSnapshot,
  store: Store,
  plannedScope: PlannedWebAppAuthorityScope,
): StoreSnapshot {
  const edges = snapshot.edges
    .filter((edge) => scopeIncludesSubject(store, plannedScope.typeIds, edge.s))
    .map((edge) => ({ ...edge }));
  const visibleEdgeIds = new Set(edges.map((edge) => edge.id));

  return {
    edges,
    retracted: snapshot.retracted.filter((edgeId) => visibleEdgeIds.has(edgeId)),
  };
}

function filterModuleScopedWriteResult(
  result: AuthoritativeGraphWriteResult,
  store: Store,
  edgeById: Map<string, StoreSnapshot["edges"][number]>,
  plannedScope: PlannedWebAppAuthorityScope,
): AuthoritativeGraphWriteResult | undefined {
  const ops = result.transaction.ops.filter((operation) => {
    const scopedSubjectId = resolveScopedSubjectId(operation, edgeById);
    if (!scopedSubjectId) return true;
    return scopeIncludesSubject(store, plannedScope.typeIds, scopedSubjectId);
  });
  if (ops.length === 0) return undefined;

  return {
    ...result,
    transaction: {
      ...result.transaction,
      ops,
    },
  };
}

function planSyncScope(
  scope: WebAppAuthoritySyncScopeRequest | undefined,
  authorization: AuthorizationContext,
): PlannedWebAppAuthorityScope | undefined {
  if (isGraphScopeRequest(scope)) return undefined;

  if (scope.moduleId !== workflowModuleId || scope.scopeId !== workflowReviewScopeId) {
    throw new WebAppAuthorityReadError(
      404,
      `Scope "${scope.scopeId}" was not found for module "${scope.moduleId}".`,
    );
  }

  return {
    scope: createModuleSyncScope({
      moduleId: scope.moduleId,
      scopeId: scope.scopeId,
      definitionHash: workflowReviewScopeDefinitionHash,
      policyFilterVersion: createPolicyFilterVersion(authorization.policyVersion),
    }),
    typeIds: workflowModuleEntityTypeIds,
  };
}
export class WebAppAuthoritySessionPrincipalLookupError extends Error {
  readonly status: number;
  readonly code = "auth.principal_missing" as const;
  readonly reason: "conflict" | "missing";

  constructor(status: number, reason: "conflict" | "missing", message: string) {
    super(message);
    this.name = "WebAppAuthoritySessionPrincipalLookupError";
    this.status = status;
    this.reason = reason;
  }
}
function getFirstObject(store: Store, subjectId: string, predicateId: string): string | undefined {
  return store.facts(subjectId, predicateId)[0]?.o;
}

function getEntityLabel(store: Store, id: string): string {
  return (
    getFirstObject(store, id, namePredicateId) ?? getFirstObject(store, id, labelPredicateId) ?? id
  );
}

function hasEntityOfType(store: Store, entityId: string, typeId: string): boolean {
  return store.facts(entityId, typePredicateId, typeId).length > 0;
}

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => typeof value === "string"))];
}

function matchesAuthSubjectProjection(
  store: Store,
  projectionId: string,
  subject: AuthSubjectRef,
): boolean {
  return (
    getFirstObject(store, projectionId, authSubjectProjectionIssuerPredicateId) ===
      subject.issuer &&
    getFirstObject(store, projectionId, authSubjectProjectionProviderPredicateId) ===
      subject.provider &&
    getFirstObject(store, projectionId, authSubjectProjectionProviderAccountIdPredicateId) ===
      subject.providerAccountId &&
    getFirstObject(store, projectionId, authSubjectProjectionAuthUserIdPredicateId) ===
      subject.authUserId
  );
}

function listActiveAuthSubjectProjectionIds(store: Store, subject: AuthSubjectRef): string[] {
  return uniqueStrings(
    store
      .facts(undefined, authSubjectProjectionIssuerPredicateId, subject.issuer)
      .map((edge) => edge.s)
      .filter(
        (projectionId) =>
          hasEntityOfType(store, projectionId, authSubjectProjectionTypeId) &&
          getFirstObject(store, projectionId, authSubjectProjectionStatusPredicateId) ===
            activeAuthSubjectStatusId &&
          matchesAuthSubjectProjection(store, projectionId, subject),
      ),
  );
}

function listActiveAuthUserProjectionIds(store: Store, authUserId: string): string[] {
  return uniqueStrings(
    store
      .facts(undefined, authSubjectProjectionAuthUserIdPredicateId, authUserId)
      .map((edge) => edge.s)
      .filter(
        (projectionId) =>
          hasEntityOfType(store, projectionId, authSubjectProjectionTypeId) &&
          getFirstObject(store, projectionId, authSubjectProjectionStatusPredicateId) ===
            activeAuthSubjectStatusId,
      ),
  );
}

function readPrincipalRoleKeys(store: Store, principalId: string): readonly string[] {
  return uniqueStrings(
    store
      .facts(undefined, principalRoleBindingPrincipalPredicateId, principalId)
      .map((edge) => edge.s)
      .filter(
        (bindingId) =>
          hasEntityOfType(store, bindingId, principalRoleBindingTypeId) &&
          getFirstObject(store, bindingId, principalRoleBindingStatusPredicateId) ===
            activePrincipalRoleBindingStatusId,
      )
      .map((bindingId) => getFirstObject(store, bindingId, principalRoleBindingRoleKeyPredicateId)),
  ).sort();
}

function readSessionPrincipalProjection(
  store: Store,
  principalId: string,
  graphId: string,
): SessionPrincipalProjection | null {
  if (!hasEntityOfType(store, principalId, principalTypeId)) return null;
  if (getFirstObject(store, principalId, principalStatusPredicateId) !== activePrincipalStatusId) {
    return null;
  }
  if (getFirstObject(store, principalId, principalHomeGraphIdPredicateId) !== graphId) {
    return null;
  }

  const principalKindId = getFirstObject(store, principalId, principalKindPredicateId);
  const principalKind = principalKindId ? principalKindById.get(principalKindId) : undefined;
  if (!principalKind) return null;

  return {
    principalId,
    principalKind,
    roleKeys: readPrincipalRoleKeys(store, principalId),
    capabilityGrantIds: [],
    capabilityVersion: 0,
  };
}

function readProjectionSessionPrincipalProjection(
  store: Store,
  projectionId: string,
  graphId: string,
): SessionPrincipalProjection | null {
  const principalId = getFirstObject(
    store,
    projectionId,
    authSubjectProjectionPrincipalPredicateId,
  );
  return principalId ? readSessionPrincipalProjection(store, principalId, graphId) : null;
}

function readAuthUserPrincipalIds(store: Store, graphId: string, authUserId: string): string[] {
  return uniqueStrings(
    listActiveAuthUserProjectionIds(store, authUserId)
      .map((projectionId) =>
        getFirstObject(store, projectionId, authSubjectProjectionPrincipalPredicateId),
      )
      .filter((principalId): principalId is string => {
        if (!principalId) return false;
        return readSessionPrincipalProjection(store, principalId, graphId) !== null;
      }),
  );
}

function principalNeedsHomeGraphRepair(store: Store, principalId: string): boolean {
  return !store
    .facts(principalId, principalHomeGraphIdPredicateId)
    .some((edge) => typeof edge.o === "string" && edge.o.trim().length > 0);
}

function listPrincipalIdsMissingHomeGraphId(store: Store): string[] {
  return uniqueStrings(
    store
      .facts(undefined, typePredicateId, principalTypeId)
      .map((edge) => edge.s)
      .filter((principalId) => principalNeedsHomeGraphRepair(store, principalId)),
  );
}

async function repairLegacyPrincipalHomeGraphIds(
  authority: PersistedWebAppAuthority,
): Promise<void> {
  const principalIdsToRepair = listPrincipalIdsMissingHomeGraphId(authority.store);
  if (principalIdsToRepair.length === 0) return;

  const repaired = planAuthorityMutation(
    authority.store.snapshot(),
    `repair:principal-home-graph-id:${Date.now()}`,
    (_mutationGraph, mutationStore) => {
      for (const principalId of principalIdsToRepair) {
        setSingleReferenceField(
          mutationStore,
          principalId,
          principalHomeGraphIdPredicateId,
          webAppGraphId,
        );
      }

      return principalIdsToRepair;
    },
  );

  if (!repaired.changed) return;

  await authority.applyTransaction(repaired.transaction, {
    writeScope: "authority-only",
  });
}

function authSubjectLookupLabel(subject: AuthSubjectRef): string {
  return `${subject.issuer}:${subject.provider}:${subject.providerAccountId}`;
}

function buildAuthSubjectProjectionName(subject: AuthSubjectRef): string {
  return `Auth subject ${authSubjectLookupLabel(subject)}`;
}

function buildPrincipalName(subject: AuthSubjectRef): string {
  return `Principal ${subject.authUserId}`;
}

function createMissingSessionPrincipalLookupError(input: SessionPrincipalLookupInput): never {
  throw new WebAppAuthoritySessionPrincipalLookupError(
    404,
    "missing",
    `No graph principal projection exists for subject "${authSubjectLookupLabel(input.subject)}" in graph "${input.graphId}".`,
  );
}

function createConflictingSessionPrincipalLookupError(
  input: SessionPrincipalLookupInput,
  principalIds: readonly string[],
): never {
  throw new WebAppAuthoritySessionPrincipalLookupError(
    409,
    "conflict",
    `Multiple active graph principals (${principalIds.join(", ")}) are linked to Better Auth user "${input.subject.authUserId}" in graph "${input.graphId}".`,
  );
}

function createConflictingAuthSubjectProjectionError(
  input: SessionPrincipalLookupInput,
  projectionIds: readonly string[],
): never {
  throw new WebAppAuthoritySessionPrincipalLookupError(
    409,
    "conflict",
    `Multiple active auth subject projections (${projectionIds.join(", ")}) exist for subject "${authSubjectLookupLabel(input.subject)}" in graph "${input.graphId}".`,
  );
}

function setSingleReferenceField(
  store: Store,
  subjectId: string,
  predicateId: string,
  objectId: string,
): void {
  const current = store.facts(subjectId, predicateId);
  if (current.length === 1 && current[0]?.o === objectId) return;

  store.batch(() => {
    for (const edge of current) {
      store.retract(edge.id);
    }
    store.assert(subjectId, predicateId, objectId);
  });
}

function planAuthorityMutation<TResult>(
  snapshot: StoreSnapshot,
  txId: string,
  mutate: (graph: NamespaceClient<WebAppGraph>, store: Store) => TResult,
): {
  readonly changed: boolean;
  readonly result: TResult;
  readonly transaction: GraphWriteTransaction;
} {
  return planRecordedMutation(snapshot, webAppGraph, txId, mutate);
}

function createTransactionEdgeIndex(
  snapshot: StoreSnapshot,
): ReadonlyMap<string, StoreSnapshot["edges"][number]> {
  return new Map(snapshot.edges.map((edge) => [edge.id, edge]));
}

function resolveOperationTarget(
  operation: GraphWriteTransaction["ops"][number],
  edgeById: ReadonlyMap<string, StoreSnapshot["edges"][number]>,
):
  | {
      readonly subjectId: string;
      readonly predicateId: string;
    }
  | undefined {
  if (operation.op === "assert") {
    return {
      subjectId: operation.edge.s,
      predicateId: operation.edge.p,
    };
  }

  const edge = edgeById.get(operation.edgeId);
  if (!edge) return undefined;
  return {
    subjectId: edge.s,
    predicateId: edge.p,
  };
}

function resolveTransactionTarget(
  transaction: GraphWriteTransaction,
  snapshot: StoreSnapshot,
): ReadonlyArray<{
  readonly path: readonly string[];
  readonly subjectId: string;
  readonly predicateId: string;
}> {
  const edgeById = createTransactionEdgeIndex(snapshot);
  const targets: Array<{
    readonly path: readonly string[];
    readonly subjectId: string;
    readonly predicateId: string;
  }> = [];

  for (const [index, operation] of transaction.ops.entries()) {
    const target = resolveOperationTarget(operation, edgeById);
    if (!target) continue;
    targets.push({
      path: [`ops[${index}]`],
      subjectId: target.subjectId,
      predicateId: target.predicateId,
    });
  }

  return targets;
}

function createAuthorizationTarget(
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
  subjectId: string,
  predicateId: string,
) {
  return {
    subjectId,
    predicateId,
    policy: compiledFieldIndex.get(predicateId)?.policy,
  };
}

function authorizationHasAuthorityAccess(authorization: AuthorizationContext): boolean {
  return (
    authorization.principalKind === "service" ||
    authorization.principalKind === "agent" ||
    authorization.roleKeys.includes(authorityRoleKey)
  );
}

function subjectIsHiddenIdentityEntity(store: Store, subjectId: string): boolean {
  return store
    .facts(subjectId, typePredicateId)
    .some((edge) => nonAuthorityHiddenIdentityTypeIds.has(edge.o));
}

function evaluateAuthorityOnlyIdentityRead(
  authorization: AuthorizationContext,
  subjectId: string,
  predicateId: string,
) {
  return authorizeRead({
    authorization,
    capabilityKeys: webAppAuthorityCapabilityKeys,
    target: {
      subjectId,
      predicateId,
      policy: {
        predicateId,
        transportVisibility: "authority-only",
        requiredWriteScope: "authority-only",
        readAudience: "authority",
        writeAudience: "authority",
        shareable: false,
      },
    },
  });
}

function evaluateReadAuthorization(
  store: Store,
  authorization: AuthorizationContext,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
  subjectId: string,
  predicateId: string,
) {
  if (
    !authorizationHasAuthorityAccess(authorization) &&
    subjectIsHiddenIdentityEntity(store, subjectId)
  ) {
    return evaluateAuthorityOnlyIdentityRead(authorization, subjectId, predicateId);
  }

  return authorizeRead({
    authorization,
    capabilityKeys: webAppAuthorityCapabilityKeys,
    target: createAuthorizationTarget(compiledFieldIndex, subjectId, predicateId),
  });
}

function createReadableReplicationAuthorizer(
  store: Store,
  authorization: AuthorizationContext,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
): ReplicationReadAuthorizer {
  const staleContextError = assertCurrentPolicyVersion(authorization);
  if (staleContextError) {
    throw createReadPolicyError(staleContextError);
  }

  return ({ subjectId, predicateId }) =>
    evaluateReadAuthorization(store, authorization, compiledFieldIndex, subjectId, predicateId)
      .allowed;
}

function filterReadableSnapshot(
  store: Store,
  snapshot: StoreSnapshot,
  authorization: AuthorizationContext,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
): StoreSnapshot {
  const authorizeReadablePredicate = createReadableReplicationAuthorizer(
    store,
    authorization,
    compiledFieldIndex,
  );

  const edges = snapshot.edges
    .filter((edge) =>
      authorizeReadablePredicate({
        subjectId: edge.s,
        predicateId: edge.p,
      }),
    )
    .map((edge) => ({ ...edge }));
  const visibleEdgeIds = new Set(edges.map((edge) => edge.id));

  return {
    edges,
    retracted: snapshot.retracted.filter((edgeId) => visibleEdgeIds.has(edgeId)),
  };
}

function assertTransactionAuthorized(
  transaction: GraphWriteTransaction,
  snapshot: StoreSnapshot,
  authorization: AuthorizationContext,
  writeScope: AuthoritativeWriteScope,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
): void {
  const staleContextError = assertCurrentPolicyVersion(authorization);
  if (staleContextError) {
    throw buildTransactionValidationError(transaction, [
      {
        code: staleContextError.code,
        message: formatPolicyErrorMessage(staleContextError),
        path: ["authorization", "policyVersion"],
      },
    ]);
  }

  const issues = resolveTransactionTarget(transaction, snapshot)
    .map((target) => {
      const decision = authorizeWrite({
        authorization,
        capabilityKeys: webAppAuthorityCapabilityKeys,
        target: createAuthorizationTarget(compiledFieldIndex, target.subjectId, target.predicateId),
        writeScope,
      });
      if (decision.allowed) return undefined;
      return {
        code: decision.error.code,
        message: formatPolicyErrorMessage(decision.error),
        path: target.path,
      };
    })
    .filter((issue): issue is NonNullable<typeof issue> => issue !== undefined);

  if (issues.length > 0) {
    throw buildTransactionValidationError(transaction, issues);
  }
}

function buildWriteSecretFieldCommandTargets(
  input: {
    readonly entityId: string;
    readonly predicateId: string;
    readonly secretId: string;
  },
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
) {
  return [
    createAuthorizationTarget(compiledFieldIndex, input.secretId, typePredicateId),
    createAuthorizationTarget(compiledFieldIndex, input.secretId, createdAtPredicateId),
    createAuthorizationTarget(compiledFieldIndex, input.secretId, namePredicateId),
    createAuthorizationTarget(compiledFieldIndex, input.secretId, updatedAtPredicateId),
    createAuthorizationTarget(compiledFieldIndex, input.secretId, secretHandleVersionPredicateId),
    createAuthorizationTarget(
      compiledFieldIndex,
      input.secretId,
      secretHandleLastRotatedAtPredicateId,
    ),
    createAuthorizationTarget(compiledFieldIndex, input.entityId, input.predicateId),
  ];
}

function createWriteSecretFieldCommandPolicy(predicateId: string): GraphCommandPolicy {
  return {
    // Branch 1 publishes a generic secret-backed field boundary here. The web
    // command envelope stays consumer-owned, but the touched predicate must be
    // the concrete secret-backed field being written rather than an env-var
    // proof-specific predicate id.
    touchesPredicates: [
      ...writeSecretFieldCommandBasePredicateIds.map((touchedPredicateId) => ({
        predicateId: touchedPredicateId,
      })),
      { predicateId },
    ],
  };
}

function assertCommandAuthorized(input: {
  readonly authorization: AuthorizationContext;
  readonly commandKey: string;
  readonly commandPolicy: GraphCommandPolicy;
  readonly touchedPredicates: ReturnType<typeof buildWriteSecretFieldCommandTargets>;
  readonly writeScope: AuthoritativeWriteScope;
}): void {
  const staleContextError = assertCurrentPolicyVersion(input.authorization);
  if (staleContextError) {
    throw createCommandPolicyError(staleContextError);
  }

  const decision = authorizeCommand({
    authorization: input.authorization,
    capabilityKeys: webAppAuthorityCapabilityKeys,
    commandKey: input.commandKey,
    commandPolicy: input.commandPolicy,
    touchedPredicates: input.touchedPredicates,
    writeScope: input.writeScope,
  });
  if (!decision.allowed) {
    throw createCommandPolicyError(decision.error);
  }
}

function runWebAuthorityMutationRollbacks(
  rollbacks: readonly WebAuthorityMutationRollback[],
): void {
  const rollbackErrors: unknown[] = [];
  for (let index = rollbacks.length - 1; index >= 0; index -= 1) {
    const rollback = rollbacks[index];
    if (!rollback) continue;
    try {
      rollback();
    } catch (error) {
      rollbackErrors.push(error);
    }
  }

  if (rollbackErrors.length === 1) {
    throw rollbackErrors[0];
  }
  if (rollbackErrors.length > 1) {
    throw new AggregateError(rollbackErrors, "Web authority mutation rollback failed.");
  }
}

/**
 * Applies a staged web authority mutation and unwinds any authority-local side
 * effects if the authoritative commit fails.
 */
export async function applyStagedWebAuthorityMutation<TResult>(input: {
  readonly changed: boolean;
  readonly result: TResult;
  readonly writeScope: AuthoritativeWriteScope;
  readonly commit: (writeScope: AuthoritativeWriteScope) => Promise<void>;
  readonly stage?: (result: TResult, context: WebAuthorityMutationStageContext) => void;
}): Promise<TResult> {
  if (!input.changed) return input.result;

  const rollbacks: WebAuthorityMutationRollback[] = [];
  try {
    input.stage?.(input.result, {
      addRollback(rollback) {
        rollbacks.push(rollback);
      },
    });
    await input.commit(input.writeScope);
  } catch (error) {
    try {
      runWebAuthorityMutationRollbacks(rollbacks);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Web authority mutation failed and rollback did not complete.",
      );
    }
    throw error;
  }

  return input.result;
}

function createAuthorityStorage(
  storage: WebAppAuthorityStorage,
  pendingSecretWriteRef: { current: WebAppAuthoritySecretWrite | null },
): PersistedAuthoritativeGraphStorage {
  // This adapter is the explicit boundary between the stable graph/runtime
  // persisted-authority contract and web-only secret side storage.
  return {
    async load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null> {
      const persistedState = await storage.load();
      if (!persistedState) return null;

      return {
        snapshot: clonePersistedValue(persistedState.snapshot),
        writeHistory: persistedState.writeHistory
          ? clonePersistedValue(persistedState.writeHistory)
          : undefined,
        needsPersistence: persistedState.needsPersistence,
      };
    },
    async commit(input): Promise<void> {
      const secretWrite = pendingSecretWriteRef.current
        ? clonePersistedValue(pendingSecretWriteRef.current)
        : undefined;

      try {
        await storage.commit(clonePersistedValue(input), secretWrite ? { secretWrite } : undefined);
      } finally {
        pendingSecretWriteRef.current = null;
      }
    },
    async persist(input): Promise<void> {
      await storage.persist(clonePersistedValue(input));
    },
  };
}

export async function createWebAppAuthority(
  storage: WebAppAuthorityStorage,
  options: WebAppAuthorityOptions = {},
): Promise<WebAppAuthority> {
  const graph = options.graph ?? webAppGraph;
  const { bootstrappedSnapshot, compiledFieldIndex, scalarByKey, typeByKey } =
    getCompiledGraphArtifacts(graph);
  const store = createStore(bootstrappedSnapshot);

  // Load every retained plaintext row. The current proof does not garbage
  // collect side-table entries when graph references are retracted.
  const persistedSecrets = await storage.loadSecrets();
  const secretValuesRef = {
    current: new Map(
      Object.entries(persistedSecrets).map(([secretId, secret]) => [secretId, secret.value]),
    ),
  };
  const pendingSecretWriteRef = {
    current: null as WebAppAuthoritySecretWrite | null,
  };
  const authority = await createPersistedAuthoritativeGraph(store, graph, {
    storage: createAuthorityStorage(storage, pendingSecretWriteRef),
    seed() {
      if (options.seedExampleGraph !== false) {
        seedExampleGraph(createTypeClient(store, webAppGraph));
      }
    },
    createCursorPrefix: createAuthorityCursorPrefix,
    maxRetainedTransactions: options.maxRetainedTransactions,
  });
  // Early persisted Better Auth rollouts could create graph principals without
  // `homeGraphId`. Repair them before any sync or direct graph reads materialize
  // those entities through the typed client.
  await repairLegacyPrincipalHomeGraphIds(authority);

  function readSnapshot(options: WebAppAuthorityReadOptions): StoreSnapshot {
    return filterReadableSnapshot(
      authority.store,
      authority.store.snapshot(),
      options.authorization,
      compiledFieldIndex,
    );
  }

  function readPredicateValue(
    subjectId: string,
    predicateId: string,
    options: WebAppAuthorityPredicateReadOptions,
  ): unknown {
    const fieldDefinition = compiledFieldIndex.get(predicateId);
    if (!fieldDefinition) {
      throw new WebAppAuthorityReadError(404, `Predicate "${predicateId}" was not found.`);
    }

    const staleContextError = assertCurrentPolicyVersion(options.authorization);
    if (staleContextError) {
      throw createReadPolicyError(staleContextError);
    }

    const decision = evaluateReadAuthorization(
      authority.store,
      options.authorization,
      compiledFieldIndex,
      subjectId,
      predicateId,
    );
    if (!decision.allowed) {
      throw createReadPolicyError(decision.error);
    }

    return decodePredicateValue(
      authority.store,
      subjectId,
      fieldDefinition.field,
      scalarByKey,
      typeByKey,
      {
        strictRequired: options.strictRequired,
      },
    );
  }

  function createSyncPayload(options: WebAppAuthoritySyncOptions) {
    const authorizeRead = createReadableReplicationAuthorizer(
      authority.store,
      options.authorization,
      compiledFieldIndex,
    );
    const plannedScope = planSyncScope(options.scope, options.authorization);
    const payload = authority.createSyncPayload({
      authorizeRead,
      freshness: options.freshness,
    });
    if (!plannedScope) {
      return payload;
    }

    return {
      ...payload,
      scope: plannedScope.scope,
      snapshot: filterModuleScopedSnapshot(payload.snapshot, authority.store, plannedScope),
      cursor: formatScopedModuleCursor(plannedScope.scope, payload.cursor),
    };
  }

  async function applyTransaction(
    transaction: GraphWriteTransaction,
    options: WebAppAuthorityTransactionOptions,
  ) {
    const writeScope = options.writeScope ?? "client-tx";
    assertTransactionAuthorized(
      transaction,
      authority.store.snapshot(),
      options.authorization,
      writeScope,
      compiledFieldIndex,
    );
    return authority.applyTransaction(transaction, {
      writeScope,
    });
  }

  function getIncrementalSyncResult(
    after: string | undefined,
    options: WebAppAuthoritySyncOptions,
  ) {
    const authorizeRead = createReadableReplicationAuthorizer(
      authority.store,
      options.authorization,
      compiledFieldIndex,
    );
    const plannedScope = planSyncScope(options.scope, options.authorization);
    if (!plannedScope) {
      return authority.getIncrementalSyncResult(after, {
        authorizeRead,
        freshness: options.freshness,
      });
    }

    if (after) {
      const currentScopedCursor = formatScopedModuleCursor(
        plannedScope.scope,
        authority.createSyncPayload({
          authorizeRead,
          freshness: options.freshness,
        }).cursor,
      );
      const parsedAfter = parseScopedModuleCursor(after);
      if (!parsedAfter) {
        return createIncrementalSyncFallback("scope-changed", {
          after,
          cursor: currentScopedCursor,
          freshness: options.freshness,
          scope: plannedScope.scope,
        });
      }
      if (
        parsedAfter.moduleId !== plannedScope.scope.moduleId ||
        parsedAfter.scopeId !== plannedScope.scope.scopeId ||
        parsedAfter.definitionHash !== plannedScope.scope.definitionHash
      ) {
        return createIncrementalSyncFallback("scope-changed", {
          after,
          cursor: currentScopedCursor,
          freshness: options.freshness,
          scope: plannedScope.scope,
        });
      }
      if (parsedAfter.policyFilterVersion !== plannedScope.scope.policyFilterVersion) {
        return createIncrementalSyncFallback("policy-changed", {
          after,
          cursor: currentScopedCursor,
          freshness: options.freshness,
          scope: plannedScope.scope,
        });
      }
      after = parsedAfter.cursor;
    }

    const result = authority.getIncrementalSyncResult(after, {
      authorizeRead,
      freshness: options.freshness,
    });
    const resultAfter = formatScopedModuleCursor(plannedScope.scope, result.after);
    const resultCursor = formatScopedModuleCursor(plannedScope.scope, result.cursor);
    if ("fallback" in result) {
      return createIncrementalSyncFallback(result.fallback, {
        after: resultAfter,
        cursor: resultCursor,
        freshness: result.freshness,
        scope: plannedScope.scope,
      });
    }

    const edgeById = new Map(authority.store.snapshot().edges.map((edge) => [edge.id, edge]));
    const transactions = result.transactions.flatMap((transaction) => {
      const scoped = filterModuleScopedWriteResult(
        transaction,
        authority.store,
        edgeById,
        plannedScope,
      );
      return scoped ? [scoped] : [];
    });

    return createIncrementalSyncPayload(transactions, {
      after: resultAfter,
      cursor: resultCursor,
      freshness: result.freshness,
      scope: plannedScope.scope,
    });
  }

  async function lookupSessionPrincipal(
    input: SessionPrincipalLookupInput,
    options: WebAppAuthoritySessionPrincipalLookupOptions = {},
  ): Promise<SessionPrincipalProjection> {
    const exactProjectionIds = listActiveAuthSubjectProjectionIds(authority.store, input.subject);
    if (exactProjectionIds.length > 1) {
      createConflictingAuthSubjectProjectionError(input, exactProjectionIds);
    }

    const exactProjectionId = exactProjectionIds[0];
    if (exactProjectionId) {
      const resolved = readProjectionSessionPrincipalProjection(
        authority.store,
        exactProjectionId,
        input.graphId,
      );
      if (resolved) return resolved;
    }

    const authUserPrincipalIds = readAuthUserPrincipalIds(
      authority.store,
      input.graphId,
      input.subject.authUserId,
    );
    if (authUserPrincipalIds.length > 1) {
      createConflictingSessionPrincipalLookupError(input, authUserPrincipalIds);
    }

    if (options.allowRepair === false) {
      createMissingSessionPrincipalLookupError(input);
    }

    const repaired = planAuthorityMutation(
      authority.store.snapshot(),
      `auth-subject-repair:${Date.now()}`,
      (mutationGraph) => {
        const principalId =
          authUserPrincipalIds[0] ??
          mutationGraph.principal.create({
            homeGraphId: input.graphId,
            kind: core.principalKind.values.human.id,
            name: buildPrincipalName(input.subject),
            status: activePrincipalStatusId,
          });
        const mirroredAt = new Date();
        const projectionName = buildAuthSubjectProjectionName(input.subject);
        const projectionId =
          exactProjectionId ??
          mutationGraph.authSubjectProjection.create({
            authUserId: input.subject.authUserId,
            issuer: input.subject.issuer,
            mirroredAt,
            name: projectionName,
            principal: principalId,
            provider: input.subject.provider,
            providerAccountId: input.subject.providerAccountId,
            status: activeAuthSubjectStatusId,
          });

        if (exactProjectionId) {
          mutationGraph.authSubjectProjection.update(exactProjectionId, {
            mirroredAt,
            name: projectionName,
            principal: principalId,
            status: activeAuthSubjectStatusId,
          });
        }

        return {
          principalId,
          projectionId,
        };
      },
    );

    if (repaired.changed) {
      await authority.applyTransaction(repaired.transaction, {
        writeScope: "authority-only",
      });
    }

    const resolved = readProjectionSessionPrincipalProjection(
      authority.store,
      repaired.result.projectionId,
      input.graphId,
    );
    if (resolved) return resolved;

    createMissingSessionPrincipalLookupError(input);
  }

  async function runWriteSecretFieldCommand(
    input: WriteSecretFieldInput,
    options: WebAppAuthoritySecretFieldOptions,
  ): Promise<WriteSecretFieldResult> {
    const entityId = trimOptionalString(input.entityId);
    const predicateId = trimOptionalString(input.predicateId);
    const plaintext = trimOptionalString(input.plaintext);

    if (!entityId) {
      throw new WebAppAuthorityMutationError(400, secretFieldEntityIdRequiredMessage);
    }
    if (!predicateId) {
      throw new WebAppAuthorityMutationError(400, secretFieldPredicateIdRequiredMessage);
    }
    if (!plaintext) {
      throw new WebAppAuthorityMutationError(400, secretFieldPlaintextRequiredMessage);
    }

    const fieldDefinition = compiledFieldIndex.get(predicateId);
    if (!fieldDefinition) {
      throw new WebAppAuthorityMutationError(404, `Predicate "${predicateId}" was not found.`);
    }
    if (!isSecretBackedField(fieldDefinition.field)) {
      throw new WebAppAuthorityMutationError(
        400,
        `Predicate "${predicateId}" is not a secret-backed field.`,
      );
    }
    if (fieldDefinition.field.cardinality === "many") {
      throw new WebAppAuthorityMutationError(
        400,
        `Secret-backed field "${fieldDefinition.pathLabel}" does not support multi-value writes.`,
      );
    }

    const entityTypeIds = authority.store.facts(entityId, typePredicateId).map((edge) => edge.o);
    if (entityTypeIds.length === 0) {
      throw new WebAppAuthorityMutationError(404, `Entity "${entityId}" was not found.`);
    }
    if (!entityTypeIds.some((typeId) => fieldDefinition.ownerTypeIds.has(typeId))) {
      throw new WebAppAuthorityMutationError(
        400,
        `Predicate "${predicateId}" is not defined on entity "${entityId}".`,
      );
    }

    const existingSecretId = getFirstObject(authority.store, entityId, predicateId);
    const rotated =
      existingSecretId !== undefined && secretValuesRef.current.get(existingSecretId) !== plaintext;
    const secretName = buildSecretHandleName(
      getEntityLabel(authority.store, entityId),
      fieldDefinition.fieldLabel,
    );
    const planned = planAuthorityMutation(
      authority.store.snapshot(),
      `secret-field:${entityId}:${predicateId}:${Date.now()}`,
      (mutationGraph, mutationStore) => {
        let secretId = existingSecretId;
        let secretVersion = secretId ? (mutationGraph.secretHandle.get(secretId)?.version ?? 0) : 0;

        if (!secretId) {
          secretId = mutationGraph.secretHandle.create({
            name: secretName,
            version: 1,
            lastRotatedAt: new Date(),
          });
          setSingleReferenceField(mutationStore, entityId, predicateId, secretId);
          secretVersion = 1;
        } else if (rotated) {
          secretVersion = (mutationGraph.secretHandle.get(secretId)?.version ?? 0) + 1;
          mutationGraph.secretHandle.update(secretId, {
            name: secretName,
            version: secretVersion,
            lastRotatedAt: new Date(),
          });
          setSingleReferenceField(mutationStore, entityId, predicateId, secretId);
        } else {
          mutationGraph.secretHandle.update(secretId, {
            name: secretName,
          });
          setSingleReferenceField(mutationStore, entityId, predicateId, secretId);
          secretVersion = mutationGraph.secretHandle.get(secretId)?.version ?? secretVersion;
        }

        return {
          created: existingSecretId === undefined,
          entityId,
          predicateId,
          rotated,
          secretId,
          secretVersion,
        } satisfies WriteSecretFieldResult;
      },
    );
    assertCommandAuthorized({
      authorization: options.authorization,
      commandKey: writeSecretFieldCommandKey,
      commandPolicy: createWriteSecretFieldCommandPolicy(predicateId),
      touchedPredicates: buildWriteSecretFieldCommandTargets(
        {
          entityId,
          predicateId,
          secretId: planned.result.secretId,
        },
        compiledFieldIndex,
      ),
      writeScope: "server-command",
    });
    return applyStagedWebAuthorityMutation({
      changed: planned.changed,
      result: planned.result,
      writeScope: "server-command",
      async commit(writeScope) {
        await applyTransaction(planned.transaction, {
          authorization: options.authorization,
          writeScope,
        });
      },
      stage(result, context) {
        const previousSecretValues = secretValuesRef.current;
        context.addRollback(() => {
          secretValuesRef.current = previousSecretValues;
          pendingSecretWriteRef.current = null;
        });

        const nextSecretValues = new Map(previousSecretValues);
        nextSecretValues.set(result.secretId, plaintext);
        secretValuesRef.current = nextSecretValues;
        pendingSecretWriteRef.current = {
          secretId: result.secretId,
          value: plaintext,
          version: result.secretVersion,
        };
      },
    });
  }

  async function executeCommand<Command extends WebAppAuthorityCommand>(
    command: Command,
    options: WebAppAuthorityCommandOptions,
  ): Promise<WebAppAuthorityCommandResult<Command["kind"]>> {
    if (command.kind === "write-secret-field") {
      return runWriteSecretFieldCommand(command.input, options) as Promise<
        WebAppAuthorityCommandResult<Command["kind"]>
      >;
    }
    if (command.kind === "workflow-mutation") {
      return runWorkflowMutationCommand(
        command.input,
        {
          store: authority.store,
          applyTransaction,
        },
        options,
      ) as Promise<WebAppAuthorityCommandResult<Command["kind"]>>;
    }
    throw new Error("Unsupported web authority command.");
  }

  async function writeSecretField(
    input: WriteSecretFieldInput,
    options: WebAppAuthoritySecretFieldOptions,
  ): Promise<WriteSecretFieldResult> {
    return runWriteSecretFieldCommand(input, options);
  }

  const { graph: _graph, store: _store, ...authorityApi } = authority;

  return {
    ...authorityApi,
    executeCommand,
    applyTransaction,
    createSyncPayload,
    getIncrementalSyncResult,
    lookupSessionPrincipal,
    readPredicateValue,
    readSnapshot,
    writeSecretField,
  };
}
