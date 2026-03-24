import {
  applyGraphWriteTransaction,
  type AuthSubjectRef,
  type AuthorizationContext,
  type AnyTypeOutput,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeWriteScope,
  authorizeCommand,
  authorizeRead,
  authorizeWrite,
  bootstrap,
  collectScalarCodecs,
  collectTypeIndex,
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  createModuleReadScope,
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
  type InvalidationEvent,
  type PredicatePolicyDescriptor,
  readPredicateValue as decodePredicateValue,
  type ReplicationReadAuthorizer,
  type SyncDiagnostics,
  type Store,
  type StoreSnapshot,
  type AuthoritativeGraphWriteResult,
  validateShareGrant,
  matchesModuleReadScopeRequest,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import {
  agentSession,
  compileWorkflowReviewScopeDependencyKeys,
  createWorkflowReviewInvalidationEvent,
  repositoryBranch,
  repositoryCommit,
  workflowBranch,
  workflowCommit,
  workflowProject,
  workflowRepository,
  createWorkflowProjectionIndex,
  type CommitQueueScopeFailureCode,
  type CommitQueueScopeQuery,
  type CommitQueueScopeResult,
  type ProjectBranchScopeFailureCode,
  type ProjectBranchScopeQuery,
  type ProjectBranchScopeResult,
  WorkflowProjectionQueryError,
  workflowSchema,
  workflowReviewModuleReadScope,
  type WorkflowMutationAction,
  type WorkflowMutationResult,
} from "@io/core/graph/modules/ops/workflow";
import { pkm } from "@io/core/graph/modules/pkm";

import type {
  BearerShareLookupInput,
  BearerShareProjection,
  SessionPrincipalLookupInput,
  SessionPrincipalProjection,
} from "./auth-bridge.js";
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
import { runWorkflowMutationCommand } from "./workflow-authority.js";
import type { WorkflowReviewLiveRegistrationTarget } from "./workflow-live-transport.js";

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
type AuthorizationDecisionTarget = {
  readonly subjectId: string;
  readonly predicateId: string;
  readonly policy?: PredicatePolicyDescriptor | null;
};
type ResolvedAuthorizationCapabilityGrant = {
  readonly id: string;
  readonly statusId?: string;
  readonly resourceKindId: string;
  readonly resourcePredicateId?: string;
  readonly resourceCommandKey?: string;
  readonly resourceSurfaceId?: string;
  readonly targetKindId?: string;
  readonly constraintRootEntityId?: string;
  readonly constraintPredicateIds: readonly string[];
  readonly constraintExpiresAt?: string;
};
type AuthorizationCapabilityResolver = {
  readonly readKeysFor: (target: AuthorizationDecisionTarget) => readonly string[];
  readonly allowsSharedReadFor: (target: AuthorizationDecisionTarget) => boolean;
  readonly writeKeysFor: (target: AuthorizationDecisionTarget) => readonly string[];
  readonly commandKeysFor: (input: {
    readonly commandKey: string;
    readonly commandPolicy: GraphCommandPolicy;
    readonly touchedPredicates: readonly AuthorizationDecisionTarget[];
  }) => readonly string[];
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

export type WebAppAuthoritySecretLoadOptions = {
  readonly secretIds?: readonly string[];
};

export type WebAppAuthoritySecretInventoryRecord = {
  readonly version: number;
};

export type WebAppAuthoritySecretRepairInput = {
  readonly liveSecretIds: readonly string[];
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
  inspectSecrets(): Promise<Record<string, WebAppAuthoritySecretInventoryRecord>>;
  /**
   * Load the currently live authority-only plaintext rows needed for the
   * current graph snapshot during bootstrap.
   */
  loadSecrets(
    options?: WebAppAuthoritySecretLoadOptions,
  ): Promise<Record<string, WebAppAuthoritySecretRecord>>;
  repairSecrets(input: WebAppAuthoritySecretRepairInput): Promise<void>;
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
  lookupBearerShare(input: BearerShareLookupInput): Promise<BearerShareProjection>;
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
  readProjectBranchScope(
    query: ProjectBranchScopeQuery,
    options: WebAppAuthorityReadOptions,
  ): ProjectBranchScopeResult;
  readCommitQueueScope(
    query: CommitQueueScopeQuery,
    options: WebAppAuthorityReadOptions,
  ): CommitQueueScopeResult;
  planWorkflowReviewLiveRegistration(
    cursor: string,
    options: WebAppAuthorityReadOptions,
  ): WorkflowReviewLiveRegistrationTarget;
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
  readonly onWorkflowReviewInvalidation?: (invalidation: InvalidationEvent) => void;
  readonly retainedHistoryPolicy?: AuthoritativeGraphRetainedHistoryPolicy;
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
const principalCapabilityVersionPredicateId = edgeId(core.principal.fields.capabilityVersion);
const graphWriteTransactionValidationKey = "$sync:tx";
const webAppAuthorityPolicyVersion = 0;
const webAppGraphId = "graph:global";
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
const workflowProjectionReadEntityTypeIds = new Set(
  [
    workflowProject,
    workflowRepository,
    workflowBranch,
    workflowCommit,
    repositoryBranch,
    repositoryCommit,
    agentSession,
  ].map((typeDef) => {
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
const capabilityGrantResourceKindPredicateId = edgeId(core.capabilityGrant.fields.resourceKind);
const capabilityGrantResourcePredicateIdPredicateId = edgeId(
  core.capabilityGrant.fields.resourcePredicateId,
);
const capabilityGrantResourceCommandKeyPredicateId = edgeId(
  core.capabilityGrant.fields.resourceCommandKey,
);
const capabilityGrantResourcePermissionKeyPredicateId = edgeId(
  core.capabilityGrant.fields.resourcePermissionKey,
);
const capabilityGrantResourceSurfaceIdPredicateId = edgeId(
  core.capabilityGrant.fields.resourceSurfaceId,
);
const capabilityGrantTargetKindPredicateId = edgeId(core.capabilityGrant.fields.targetKind);
const capabilityGrantTargetPrincipalPredicateId = edgeId(
  core.capabilityGrant.fields.targetPrincipal,
);
const capabilityGrantTargetGraphIdPredicateId = edgeId(core.capabilityGrant.fields.targetGraphId);
const capabilityGrantBearerTokenHashPredicateId = edgeId(
  core.capabilityGrant.fields.bearerTokenHash,
);
const capabilityGrantGrantedByPrincipalPredicateId = edgeId(
  core.capabilityGrant.fields.grantedByPrincipal,
);
const capabilityGrantConstraintRootEntityIdPredicateId = edgeId(
  core.capabilityGrant.fields.constraintRootEntityId,
);
const capabilityGrantConstraintPredicateIdPredicateId = edgeId(
  core.capabilityGrant.fields.constraintPredicateId,
);
const capabilityGrantConstraintExpiresAtPredicateId = edgeId(
  core.capabilityGrant.fields.constraintExpiresAt,
);
const capabilityGrantConstraintDelegatedFromGrantIdPredicateId = edgeId(
  core.capabilityGrant.fields.constraintDelegatedFromGrantId,
);
const capabilityGrantStatusPredicateId = edgeId(core.capabilityGrant.fields.status);
const capabilityGrantIssuedAtPredicateId = edgeId(core.capabilityGrant.fields.issuedAt);
const capabilityGrantRevokedAtPredicateId = edgeId(core.capabilityGrant.fields.revokedAt);
const shareGrantSurfaceIdPredicateId = edgeId(core.shareGrant.fields.surfaceId);
const shareGrantSurfaceKindPredicateId = edgeId(core.shareGrant.fields.surfaceKind);
const shareGrantSurfaceRootEntityIdPredicateId = edgeId(core.shareGrant.fields.surfaceRootEntityId);
const shareGrantSurfacePredicateIdPredicateId = edgeId(core.shareGrant.fields.surfacePredicateId);
const shareGrantCapabilityGrantPredicateId = edgeId(core.shareGrant.fields.capabilityGrant);
const shareGrantStatusPredicateId = edgeId(core.shareGrant.fields.status);
const principalTypeId = core.principal.values.id;
const authSubjectProjectionTypeId = core.authSubjectProjection.values.id;
const principalRoleBindingTypeId = core.principalRoleBinding.values.id;
const capabilityGrantTypeId = core.capabilityGrant.values.id;
const shareGrantTypeId = core.shareGrant.values.id;
const nonAuthorityHiddenIdentityTypeIds = new Set([
  principalTypeId,
  authSubjectProjectionTypeId,
  principalRoleBindingTypeId,
  capabilityGrantTypeId,
  shareGrantTypeId,
]);
const activePrincipalStatusId = core.principalStatus.values.active.id;
const activeAuthSubjectStatusId = core.authSubjectStatus.values.active.id;
const activePrincipalRoleBindingStatusId = core.principalRoleBindingStatus.values.active.id;
const activeCapabilityGrantStatusId = core.capabilityGrantStatus.values.active.id;
const expiredCapabilityGrantStatusId = core.capabilityGrantStatus.values.expired.id;
const principalCapabilityGrantTargetKindId = core.capabilityGrantTargetKind.values.principal.id;
const bearerCapabilityGrantTargetKindId = core.capabilityGrantTargetKind.values.bearer.id;
const revokedCapabilityGrantStatusId = core.capabilityGrantStatus.values.revoked.id;
const predicateReadCapabilityGrantResourceKindId =
  core.capabilityGrantResourceKind.values.predicateRead.id;
const predicateWriteCapabilityGrantResourceKindId =
  core.capabilityGrantResourceKind.values.predicateWrite.id;
const commandExecuteCapabilityGrantResourceKindId =
  core.capabilityGrantResourceKind.values.commandExecute.id;
const shareSurfaceCapabilityGrantResourceKindId =
  core.capabilityGrantResourceKind.values.shareSurface.id;
const entityPredicateSliceShareSurfaceKindId = core.shareSurfaceKind.values.entityPredicateSlice.id;
const shareGrantVisibilityTriggerPredicateIds = new Set([
  typePredicateId,
  shareGrantSurfaceIdPredicateId,
  shareGrantSurfaceKindPredicateId,
  shareGrantSurfaceRootEntityIdPredicateId,
  shareGrantSurfacePredicateIdPredicateId,
  shareGrantCapabilityGrantPredicateId,
  shareGrantStatusPredicateId,
]);
const capabilityVersionTriggerPredicateIds = new Set([
  typePredicateId,
  principalRoleBindingPrincipalPredicateId,
  principalRoleBindingRoleKeyPredicateId,
  principalRoleBindingStatusPredicateId,
  capabilityGrantResourceKindPredicateId,
  capabilityGrantResourcePredicateIdPredicateId,
  capabilityGrantResourceCommandKeyPredicateId,
  capabilityGrantResourcePermissionKeyPredicateId,
  capabilityGrantResourceSurfaceIdPredicateId,
  capabilityGrantTargetKindPredicateId,
  capabilityGrantTargetPrincipalPredicateId,
  capabilityGrantTargetGraphIdPredicateId,
  capabilityGrantBearerTokenHashPredicateId,
  capabilityGrantGrantedByPrincipalPredicateId,
  capabilityGrantConstraintRootEntityIdPredicateId,
  capabilityGrantConstraintPredicateIdPredicateId,
  capabilityGrantConstraintExpiresAtPredicateId,
  capabilityGrantConstraintDelegatedFromGrantIdPredicateId,
  capabilityGrantStatusPredicateId,
  capabilityGrantIssuedAtPredicateId,
  capabilityGrantRevokedAtPredicateId,
]);
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

function assertCurrentCapabilityVersion(
  store: Store,
  authorization: AuthorizationContext,
): PolicyError | undefined {
  if (!authorization.principalId) {
    return undefined;
  }
  if (!hasEntityOfType(store, authorization.principalId, principalTypeId)) {
    return undefined;
  }

  const currentCapabilityVersion = readPrincipalCapabilityVersion(store, authorization.principalId);
  if (authorization.capabilityVersion === currentCapabilityVersion) {
    return undefined;
  }

  return {
    code: "policy.stale_context",
    message: `Authorization context capability version "${authorization.capabilityVersion}" does not match principal capability version "${currentCapabilityVersion}" for principal "${authorization.principalId}". Refresh the authorization context and retry.`,
    retryable: false,
    refreshRequired: true,
  };
}

function assertCurrentAuthorizationVersion(
  store: Store,
  authorization: AuthorizationContext,
): PolicyError | undefined {
  return (
    assertCurrentPolicyVersion(authorization) ??
    assertCurrentCapabilityVersion(store, authorization)
  );
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

type WebAppAuthoritySecretVersionMismatch = {
  readonly graphVersion: number;
  readonly secretId: string;
  readonly storedVersion: number;
};

type WebAppAuthoritySecretStartupDrift = {
  readonly invalidSecretIds: readonly string[];
  readonly liveSecretIds: readonly string[];
  readonly missingSecretIds: readonly string[];
  readonly orphanedSecretIds: readonly string[];
  readonly versionMismatches: readonly WebAppAuthoritySecretVersionMismatch[];
};

function hasBlockingSecretStartupDrift(drift: WebAppAuthoritySecretStartupDrift): boolean {
  return (
    drift.invalidSecretIds.length > 0 ||
    drift.missingSecretIds.length > 0 ||
    drift.versionMismatches.length > 0
  );
}

function formatSecretStartupDriftMessage(drift: WebAppAuthoritySecretStartupDrift): string {
  const details: string[] = [];
  if (drift.invalidSecretIds.length > 0) {
    details.push(`missing graph metadata for ${drift.invalidSecretIds.join(", ")}`);
  }
  if (drift.missingSecretIds.length > 0) {
    details.push(`missing plaintext rows for ${drift.missingSecretIds.join(", ")}`);
  }
  if (drift.versionMismatches.length > 0) {
    details.push(
      `version mismatch for ${drift.versionMismatches
        .map(
          ({ secretId, graphVersion, storedVersion }) =>
            `${secretId} (graph ${graphVersion}, stored ${storedVersion})`,
        )
        .join(", ")}`,
    );
  }

  const blockingSummary = details.length > 0 ? `: ${details.join("; ")}` : ".";
  const orphanedSummary =
    drift.orphanedSecretIds.length > 0
      ? ` Unreferenced side-storage rows for ${drift.orphanedSecretIds.join(", ")} were left untouched because startup repair stopped at the blocking drift.`
      : "";

  return `Cannot start web authority because secret storage drift was detected${blockingSummary}.${orphanedSummary}`;
}

class WebAppAuthoritySecretStorageDriftError extends Error {
  readonly invalidSecretIds: readonly string[];
  readonly liveSecretIds: readonly string[];
  readonly missingSecretIds: readonly string[];
  readonly orphanedSecretIds: readonly string[];
  readonly versionMismatches: readonly WebAppAuthoritySecretVersionMismatch[];

  constructor(drift: WebAppAuthoritySecretStartupDrift) {
    super(formatSecretStartupDriftMessage(drift));
    this.name = "WebAppAuthoritySecretStorageDriftError";
    this.invalidSecretIds = drift.invalidSecretIds;
    this.liveSecretIds = drift.liveSecretIds;
    this.missingSecretIds = drift.missingSecretIds;
    this.orphanedSecretIds = drift.orphanedSecretIds;
    this.versionMismatches = drift.versionMismatches;
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

type WorkflowProjectionReadFailureCode =
  | ProjectBranchScopeFailureCode
  | CommitQueueScopeFailureCode;

function resolveWorkflowProjectionReadStatus(code: WorkflowProjectionReadFailureCode): number {
  switch (code) {
    case "project-not-found":
    case "branch-not-found":
      return 404;
    case "projection-stale":
      return 409;
    case "policy-denied":
      return 403;
  }
}

export class WebAppAuthorityWorkflowReadError extends Error {
  readonly status: number;
  readonly code: WorkflowProjectionReadFailureCode;
  readonly retryable?: boolean;
  readonly refreshRequired?: boolean;

  constructor(
    status: number,
    code: WorkflowProjectionReadFailureCode,
    message: string,
    options: Partial<Pick<PolicyError, "retryable" | "refreshRequired">> = {},
  ) {
    super(message);
    this.name = "WebAppAuthorityWorkflowReadError";
    this.status = status;
    this.code = code;
    this.retryable = options.retryable;
    this.refreshRequired = options.refreshRequired;
  }
}

function createWorkflowProjectionPolicyError(error: PolicyError): WebAppAuthorityWorkflowReadError {
  return new WebAppAuthorityWorkflowReadError(
    resolveReadErrorStatus(error),
    "policy-denied",
    formatPolicyErrorMessage(error),
    {
      retryable: error.retryable,
      refreshRequired: error.refreshRequired,
    },
  );
}

function throwWorkflowProjectionReadError(error: unknown): never {
  if (error instanceof WorkflowProjectionQueryError) {
    throw new WebAppAuthorityWorkflowReadError(
      resolveWorkflowProjectionReadStatus(error.code),
      error.code,
      error.message,
    );
  }

  throw error;
}

type WorkflowLiveScopeFailureCode = "auth.unauthenticated" | "policy-changed" | "scope-changed";

export class WebAppAuthorityWorkflowLiveScopeError extends Error {
  readonly status: number;
  readonly code?: WorkflowLiveScopeFailureCode;

  constructor(status: number, message: string, code?: WorkflowLiveScopeFailureCode) {
    super(message);
    this.name = "WebAppAuthorityWorkflowLiveScopeError";
    this.status = status;
    this.code = code;
  }
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

function formatScopedSyncDiagnostics(
  scope: ModuleSyncScope,
  diagnostics: SyncDiagnostics | undefined,
): SyncDiagnostics | undefined {
  if (!diagnostics) return undefined;
  return {
    ...diagnostics,
    retainedBaseCursor: formatScopedModuleCursor(scope, diagnostics.retainedBaseCursor),
  };
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

function requireWorkflowLiveRegistrationPrincipal(authorization: AuthorizationContext): {
  readonly principalId: string;
  readonly sessionId: string;
} {
  if (!authorization.principalId || !authorization.sessionId) {
    throw new WebAppAuthorityWorkflowLiveScopeError(
      401,
      "Workflow live registrations require an authenticated session principal.",
      "auth.unauthenticated",
    );
  }

  return {
    principalId: authorization.principalId,
    sessionId: authorization.sessionId,
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

function addTouchedSubjectTypeId(
  typeIds: Set<string>,
  store: Store,
  subjectId: string | undefined,
): void {
  if (!subjectId) {
    return;
  }

  const typeId = subjectTypeId(store, subjectId);
  if (typeId) {
    typeIds.add(typeId);
  }
}

function collectTouchedTypeIdsForTransaction(
  snapshot: StoreSnapshot,
  store: Store,
  transaction: GraphWriteTransaction,
): readonly string[] {
  const edgeById = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
  const typeIds = new Set<string>();

  for (const operation of transaction.ops) {
    if (operation.op === "assert" && operation.edge.p === typePredicateId) {
      typeIds.add(operation.edge.o);
    }
    addTouchedSubjectTypeId(typeIds, store, resolveScopedSubjectId(operation, edgeById));
  }

  return [...typeIds];
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
    cursor: formatScopedModuleCursor(plannedScope.scope, result.cursor),
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

  if (!matchesModuleReadScopeRequest(scope, workflowReviewModuleReadScope)) {
    throw new WebAppAuthorityReadError(
      404,
      `Scope "${scope.scopeId}" was not found for module "${scope.moduleId}".`,
    );
  }

  return {
    scope: createModuleReadScope(
      workflowReviewModuleReadScope,
      createPolicyFilterVersion(authorization.policyVersion),
    ),
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

export class WebAppAuthorityBearerShareLookupError extends Error {
  readonly status: number;
  readonly code = "grant.invalid" as const;
  readonly reason: "conflict" | "expired" | "missing" | "revoked";

  constructor(
    status: number,
    reason: "conflict" | "expired" | "missing" | "revoked",
    message: string,
  ) {
    super(message);
    this.name = "WebAppAuthorityBearerShareLookupError";
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

export function collectLiveSecretIds(snapshot: StoreSnapshot): readonly string[] {
  const retractedEdgeIds = new Set(snapshot.retracted);
  const secretHandleIds = new Set<string>();

  for (const edge of snapshot.edges) {
    if (retractedEdgeIds.has(edge.id)) continue;
    if (edge.p === typePredicateId && edge.o === core.secretHandle.values.id) {
      secretHandleIds.add(edge.s);
    }
  }

  if (secretHandleIds.size === 0) {
    return [];
  }

  const liveSecretIds = new Set<string>();
  for (const edge of snapshot.edges) {
    if (retractedEdgeIds.has(edge.id)) continue;
    if (secretHandleIds.has(edge.o)) {
      liveSecretIds.add(edge.o);
    }
  }

  return [...liveSecretIds].sort((left, right) => left.localeCompare(right));
}

function toSecretInventory(
  secrets:
    | Record<string, WebAppAuthoritySecretInventoryRecord>
    | Record<string, WebAppAuthoritySecretRecord>,
): Record<string, WebAppAuthoritySecretInventoryRecord> {
  return Object.fromEntries(
    Object.entries(secrets)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([secretId, secret]) => [
        secretId,
        {
          version: secret.version,
        },
      ]),
  );
}

function resolveSecretStartupDrift(
  snapshot: StoreSnapshot,
  graph: WebAppAuthorityGraph,
  secretInventory: Record<string, WebAppAuthoritySecretInventoryRecord>,
): WebAppAuthoritySecretStartupDrift {
  const liveSecretIds = collectLiveSecretIds(snapshot);
  const liveSecretIdSet = new Set(liveSecretIds);
  const persistedStore = createStore(snapshot);
  const persistedGraph = createTypeClient(persistedStore, graph);
  const missingSecretIds: string[] = [];
  const invalidSecretIds: string[] = [];
  const versionMismatches: WebAppAuthoritySecretVersionMismatch[] = [];

  for (const secretId of liveSecretIds) {
    const handle = persistedGraph.secretHandle.get(secretId);
    const rawGraphVersion = handle?.version;
    const graphVersion =
      typeof rawGraphVersion === "number"
        ? rawGraphVersion
        : Number.parseInt(rawGraphVersion ?? "", 10);
    if (!Number.isInteger(graphVersion)) {
      invalidSecretIds.push(secretId);
      continue;
    }

    const stored = secretInventory[secretId];
    if (!stored) {
      missingSecretIds.push(secretId);
      continue;
    }
    if (stored.version !== graphVersion) {
      versionMismatches.push({
        secretId,
        graphVersion,
        storedVersion: stored.version,
      });
    }
  }

  return {
    invalidSecretIds,
    liveSecretIds,
    missingSecretIds,
    orphanedSecretIds: Object.keys(secretInventory)
      .filter((secretId) => !liveSecretIdSet.has(secretId))
      .sort((left, right) => left.localeCompare(right)),
    versionMismatches: versionMismatches.sort((left, right) =>
      left.secretId.localeCompare(right.secretId),
    ),
  };
}

function hasEntityOfType(store: Store, entityId: string, typeId: string): boolean {
  return store.facts(entityId, typePredicateId, typeId).length > 0;
}

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => typeof value === "string"))];
}

function readNonNegativeIntegerField(store: Store, subjectId: string, predicateId: string): number {
  const raw = getFirstObject(store, subjectId, predicateId);
  if (raw === undefined) {
    return 0;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function readPrincipalCapabilityVersion(store: Store, principalId: string): number {
  return readNonNegativeIntegerField(store, principalId, principalCapabilityVersionPredicateId);
}

function readCapabilityGrantTargetPrincipalId(
  store: Store,
  capabilityGrantId: string,
): string | undefined {
  return getFirstObject(store, capabilityGrantId, capabilityGrantTargetKindPredicateId) ===
    principalCapabilityGrantTargetKindId
    ? getFirstObject(store, capabilityGrantId, capabilityGrantTargetPrincipalPredicateId)
    : undefined;
}

function readCapabilityGrantTargetKindId(
  store: Store,
  capabilityGrantId: string,
): string | undefined {
  return getFirstObject(store, capabilityGrantId, capabilityGrantTargetKindPredicateId);
}

function readResolvedAuthorizationCapabilityGrant(
  store: Store,
  capabilityGrantId: string,
): ResolvedAuthorizationCapabilityGrant | null {
  if (!hasEntityOfType(store, capabilityGrantId, capabilityGrantTypeId)) {
    return null;
  }

  const resourceKindId =
    getFirstObject(store, capabilityGrantId, capabilityGrantResourceKindPredicateId) ?? "";
  if (resourceKindId.length === 0) {
    return null;
  }

  return {
    id: capabilityGrantId,
    statusId: getFirstObject(store, capabilityGrantId, capabilityGrantStatusPredicateId),
    resourceKindId,
    resourcePredicateId: getFirstObject(
      store,
      capabilityGrantId,
      capabilityGrantResourcePredicateIdPredicateId,
    ),
    resourceCommandKey: getFirstObject(
      store,
      capabilityGrantId,
      capabilityGrantResourceCommandKeyPredicateId,
    ),
    resourceSurfaceId: getFirstObject(
      store,
      capabilityGrantId,
      capabilityGrantResourceSurfaceIdPredicateId,
    ),
    targetKindId: readCapabilityGrantTargetKindId(store, capabilityGrantId),
    constraintRootEntityId: getFirstObject(
      store,
      capabilityGrantId,
      capabilityGrantConstraintRootEntityIdPredicateId,
    ),
    constraintPredicateIds: uniqueStrings(
      store
        .facts(capabilityGrantId, capabilityGrantConstraintPredicateIdPredicateId)
        .map((edge) => edge.o),
    ),
    constraintExpiresAt: getFirstObject(
      store,
      capabilityGrantId,
      capabilityGrantConstraintExpiresAtPredicateId,
    ),
  };
}

function readActivePrincipalCapabilityGrantIds(
  store: Store,
  principalId: string,
): readonly string[] {
  return uniqueStrings(
    store
      .facts(undefined, capabilityGrantTargetPrincipalPredicateId, principalId)
      .map((edge) => edge.s)
      .filter(
        (capabilityGrantId) =>
          hasEntityOfType(store, capabilityGrantId, capabilityGrantTypeId) &&
          getFirstObject(store, capabilityGrantId, capabilityGrantStatusPredicateId) ===
            activeCapabilityGrantStatusId &&
          readCapabilityGrantTargetPrincipalId(store, capabilityGrantId) === principalId,
      ),
  ).sort();
}

function isBearerShareAuthorizationContext(authorization: AuthorizationContext): boolean {
  return authorization.principalId === null && authorization.principalKind === "anonymous";
}

function readAuthorizationCapabilityGrants(
  store: Store,
  authorization: AuthorizationContext,
): readonly ResolvedAuthorizationCapabilityGrant[] {
  if (authorization.capabilityGrantIds.length === 0) {
    return [];
  }

  if (authorization.principalId) {
    const activeGrantIds = new Set(
      readActivePrincipalCapabilityGrantIds(store, authorization.principalId),
    );

    return uniqueStrings(authorization.capabilityGrantIds)
      .filter((capabilityGrantId) => activeGrantIds.has(capabilityGrantId))
      .map((capabilityGrantId) =>
        readResolvedAuthorizationCapabilityGrant(store, capabilityGrantId),
      )
      .filter((grant): grant is ResolvedAuthorizationCapabilityGrant => grant !== null);
  }

  if (!isBearerShareAuthorizationContext(authorization)) {
    return [];
  }

  return uniqueStrings(authorization.capabilityGrantIds)
    .map((capabilityGrantId) => readResolvedAuthorizationCapabilityGrant(store, capabilityGrantId))
    .filter((grant): grant is ResolvedAuthorizationCapabilityGrant => {
      return (
        grant !== null &&
        grant.statusId === activeCapabilityGrantStatusId &&
        grant.targetKindId === bearerCapabilityGrantTargetKindId &&
        grant.resourceKindId === shareSurfaceCapabilityGrantResourceKindId &&
        grant.constraintExpiresAt !== undefined &&
        !grantHasExpired(grant)
      );
    });
}

function grantHasExpired(grant: ResolvedAuthorizationCapabilityGrant): boolean {
  if (!grant.constraintExpiresAt) {
    return false;
  }

  const expiresAt = Date.parse(grant.constraintExpiresAt);
  return Number.isNaN(expiresAt) || expiresAt <= Date.now();
}

function readActiveCapabilityGrantShareGrantIds(
  store: Store,
  capabilityGrantId: string,
): readonly string[] {
  return uniqueStrings(
    store
      .facts(undefined, shareGrantCapabilityGrantPredicateId, capabilityGrantId)
      .map((edge) => edge.s)
      .filter(
        (shareGrantId) =>
          hasEntityOfType(store, shareGrantId, shareGrantTypeId) &&
          getFirstObject(store, shareGrantId, shareGrantStatusPredicateId) ===
            activeCapabilityGrantStatusId &&
          getFirstObject(store, shareGrantId, shareGrantCapabilityGrantPredicateId) ===
            capabilityGrantId,
      ),
  ).sort();
}

function readValidatedActiveShareGrants(
  store: Store,
  grant: ResolvedAuthorizationCapabilityGrant,
): ReadonlyArray<{
  readonly id: string;
  readonly rootEntityId: string;
  readonly predicateIds: readonly string[];
}> {
  const resourceSurfaceId = grant.resourceSurfaceId;
  if (
    grant.resourceKindId !== shareSurfaceCapabilityGrantResourceKindId ||
    resourceSurfaceId === undefined ||
    grant.constraintRootEntityId === undefined ||
    grant.constraintPredicateIds.length === 0
  ) {
    return [];
  }

  return readActiveCapabilityGrantShareGrantIds(store, grant.id).flatMap((shareGrantId) => {
    const surfaceKindId = getFirstObject(store, shareGrantId, shareGrantSurfaceKindPredicateId);
    const surfaceId = getFirstObject(store, shareGrantId, shareGrantSurfaceIdPredicateId);
    const rootEntityId = getFirstObject(
      store,
      shareGrantId,
      shareGrantSurfaceRootEntityIdPredicateId,
    );
    const predicateIds = uniqueStrings(
      store.facts(shareGrantId, shareGrantSurfacePredicateIdPredicateId).map((edge) => edge.o),
    );

    if (
      surfaceKindId !== entityPredicateSliceShareSurfaceKindId ||
      surfaceId === undefined ||
      rootEntityId === undefined
    ) {
      return [];
    }

    const validation = validateShareGrant(
      {
        id: shareGrantId,
        surface: {
          surfaceId,
          kind: "entity-predicate-slice",
          rootEntityId,
          predicateIds,
        },
        capabilityGrantId: grant.id,
        status: "active",
      },
      {
        id: grant.id,
        resource: {
          kind: "share-surface",
          surfaceId: resourceSurfaceId,
        },
        constraints: {
          rootEntityId: grant.constraintRootEntityId,
          predicateIds: grant.constraintPredicateIds,
          ...(grant.constraintExpiresAt === undefined
            ? {}
            : { expiresAt: grant.constraintExpiresAt }),
        },
        status: "active",
      },
    );

    return validation.ok
      ? [
          {
            id: shareGrantId,
            rootEntityId,
            predicateIds,
          },
        ]
      : [];
  });
}

function readCapabilityGrantShareGrantIds(
  store: Store,
  capabilityGrantId: string,
): readonly string[] {
  return uniqueStrings(
    store
      .facts(undefined, shareGrantCapabilityGrantPredicateId, capabilityGrantId)
      .map((edge) => edge.s)
      .filter(
        (shareGrantId) =>
          hasEntityOfType(store, shareGrantId, shareGrantTypeId) &&
          getFirstObject(store, shareGrantId, shareGrantCapabilityGrantPredicateId) ===
            capabilityGrantId,
      ),
  ).sort();
}

function readBearerShareProjection(
  store: Store,
  input: BearerShareLookupInput,
): BearerShareProjection {
  const matchingGrantIds = uniqueStrings(
    store
      .facts(undefined, capabilityGrantBearerTokenHashPredicateId, input.tokenHash)
      .map((edge) => edge.s)
      .filter(
        (capabilityGrantId) =>
          hasEntityOfType(store, capabilityGrantId, capabilityGrantTypeId) &&
          readCapabilityGrantTargetKindId(store, capabilityGrantId) ===
            bearerCapabilityGrantTargetKindId,
      ),
  ).sort();

  if (matchingGrantIds.length === 0) {
    createMissingBearerShareLookupError(input);
  }

  const matchingGrants = matchingGrantIds
    .map((capabilityGrantId) => readResolvedAuthorizationCapabilityGrant(store, capabilityGrantId))
    .filter((grant): grant is ResolvedAuthorizationCapabilityGrant => grant !== null);
  const activeEligibleGrants = matchingGrants.filter(
    (grant) =>
      grant.statusId === activeCapabilityGrantStatusId &&
      grant.targetKindId === bearerCapabilityGrantTargetKindId &&
      grant.resourceKindId === shareSurfaceCapabilityGrantResourceKindId &&
      grant.constraintExpiresAt !== undefined &&
      !grantHasExpired(grant) &&
      readValidatedActiveShareGrants(store, grant).length > 0,
  );

  if (activeEligibleGrants.length > 1) {
    createConflictingBearerShareLookupError(
      input,
      activeEligibleGrants.map((grant) => grant.id),
    );
  }

  const activeEligibleGrant = activeEligibleGrants[0];
  if (activeEligibleGrant) {
    return {
      capabilityGrantIds: [activeEligibleGrant.id],
    };
  }

  if (
    matchingGrants.some(
      (grant) =>
        grant.statusId === expiredCapabilityGrantStatusId ||
        (grant.statusId === activeCapabilityGrantStatusId && grantHasExpired(grant)),
    ) ||
    matchingGrants.some((grant) =>
      readCapabilityGrantShareGrantIds(store, grant.id).some(
        (shareGrantId) =>
          getFirstObject(store, shareGrantId, shareGrantStatusPredicateId) ===
          expiredCapabilityGrantStatusId,
      ),
    )
  ) {
    createExpiredBearerShareLookupError(input);
  }

  if (
    matchingGrants.some((grant) => grant.statusId === revokedCapabilityGrantStatusId) ||
    matchingGrants.some((grant) =>
      readCapabilityGrantShareGrantIds(store, grant.id).some(
        (shareGrantId) =>
          getFirstObject(store, shareGrantId, shareGrantStatusPredicateId) ===
          revokedCapabilityGrantStatusId,
      ),
    ) ||
    matchingGrants.some(
      (grant) =>
        readCapabilityGrantShareGrantIds(store, grant.id).length > 0 &&
        readValidatedActiveShareGrants(store, grant).length === 0,
    )
  ) {
    createRevokedBearerShareLookupError(input);
  }

  createMissingBearerShareLookupError(input);
}

function grantMatchesPredicateTarget(
  grant: ResolvedAuthorizationCapabilityGrant,
  resourceKindId: string,
  target: AuthorizationDecisionTarget,
): boolean {
  if (grant.resourceKindId !== resourceKindId || grantHasExpired(grant)) {
    return false;
  }
  if (grant.resourcePredicateId !== target.predicateId) {
    return false;
  }
  if (
    grant.constraintRootEntityId !== undefined &&
    grant.constraintRootEntityId !== target.subjectId
  ) {
    return false;
  }
  return (
    grant.constraintPredicateIds.length === 0 ||
    grant.constraintPredicateIds.includes(target.predicateId)
  );
}

function grantMatchesSharedPredicateTarget(
  store: Store,
  grant: ResolvedAuthorizationCapabilityGrant,
  target: AuthorizationDecisionTarget,
): boolean {
  const resourceSurfaceId = grant.resourceSurfaceId;
  if (
    grant.resourceKindId !== shareSurfaceCapabilityGrantResourceKindId ||
    grantHasExpired(grant) ||
    resourceSurfaceId === undefined ||
    grant.constraintRootEntityId === undefined ||
    grant.constraintPredicateIds.length === 0 ||
    target.policy?.shareable !== true ||
    target.policy.transportVisibility !== "replicated"
  ) {
    return false;
  }

  return readValidatedActiveShareGrants(store, grant).some(
    (shareGrant) =>
      shareGrant.rootEntityId === target.subjectId &&
      shareGrant.predicateIds.includes(target.predicateId),
  );
}

function grantMatchesCommand(
  grant: ResolvedAuthorizationCapabilityGrant,
  commandKey: string,
  touchedPredicates: readonly AuthorizationDecisionTarget[],
): boolean {
  if (
    grant.resourceKindId !== commandExecuteCapabilityGrantResourceKindId ||
    grantHasExpired(grant)
  ) {
    return false;
  }
  if (grant.resourceCommandKey !== commandKey) {
    return false;
  }
  if (
    grant.constraintRootEntityId !== undefined &&
    touchedPredicates.some((target) => target.subjectId !== grant.constraintRootEntityId)
  ) {
    return false;
  }
  return (
    grant.constraintPredicateIds.length === 0 ||
    touchedPredicates.every((target) => grant.constraintPredicateIds.includes(target.predicateId))
  );
}

function appendCapabilityKeys(
  target: Set<string>,
  capabilityKeys: readonly string[] | undefined,
): void {
  if (!capabilityKeys) {
    return;
  }
  for (const capabilityKey of capabilityKeys) {
    target.add(capabilityKey);
  }
}

function createAuthorizationCapabilityResolver(
  store: Store,
  authorization: AuthorizationContext,
): AuthorizationCapabilityResolver {
  const grants = readAuthorizationCapabilityGrants(store, authorization);

  function resolvePredicateCapabilityKeys(
    resourceKindId: string,
    target: AuthorizationDecisionTarget,
  ): readonly string[] {
    const requiredCapabilities = target.policy?.requiredCapabilities;
    if (!requiredCapabilities || requiredCapabilities.length === 0) {
      return [];
    }

    return grants.some((grant) => grantMatchesPredicateTarget(grant, resourceKindId, target))
      ? [...requiredCapabilities]
      : [];
  }

  return {
    readKeysFor(target) {
      return resolvePredicateCapabilityKeys(predicateReadCapabilityGrantResourceKindId, target);
    },
    allowsSharedReadFor(target) {
      return grants.some((grant) => grantMatchesSharedPredicateTarget(store, grant, target));
    },
    writeKeysFor(target) {
      return resolvePredicateCapabilityKeys(predicateWriteCapabilityGrantResourceKindId, target);
    },
    commandKeysFor(input) {
      const capabilityKeys = new Set<string>();

      if (
        (input.commandPolicy.capabilities?.length ?? 0) > 0 &&
        grants.some((grant) =>
          grantMatchesCommand(grant, input.commandKey, input.touchedPredicates),
        )
      ) {
        appendCapabilityKeys(capabilityKeys, input.commandPolicy.capabilities);
      }

      for (const target of input.touchedPredicates) {
        appendCapabilityKeys(
          capabilityKeys,
          resolvePredicateCapabilityKeys(predicateWriteCapabilityGrantResourceKindId, target),
        );
      }

      return [...capabilityKeys];
    },
  };
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
    capabilityGrantIds: readActivePrincipalCapabilityGrantIds(store, principalId),
    capabilityVersion: readPrincipalCapabilityVersion(store, principalId),
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

function createMissingBearerShareLookupError(input: BearerShareLookupInput): never {
  throw new WebAppAuthorityBearerShareLookupError(
    404,
    "missing",
    `No active bearer share grant exists for token hash "${input.tokenHash}" in graph "${input.graphId}".`,
  );
}

function createExpiredBearerShareLookupError(input: BearerShareLookupInput): never {
  throw new WebAppAuthorityBearerShareLookupError(
    403,
    "expired",
    `Bearer share token "${input.tokenHash}" has expired in graph "${input.graphId}".`,
  );
}

function createRevokedBearerShareLookupError(input: BearerShareLookupInput): never {
  throw new WebAppAuthorityBearerShareLookupError(
    403,
    "revoked",
    `Bearer share token "${input.tokenHash}" has been revoked in graph "${input.graphId}".`,
  );
}

function createConflictingBearerShareLookupError(
  input: BearerShareLookupInput,
  capabilityGrantIds: readonly string[],
): never {
  throw new WebAppAuthorityBearerShareLookupError(
    409,
    "conflict",
    `Multiple active bearer share grants (${capabilityGrantIds.join(", ")}) matched token hash "${input.tokenHash}" in graph "${input.graphId}".`,
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

function resolveRoleBindingPrincipalIds(
  store: Store,
  principalRoleBindingId: string,
): readonly string[] {
  return uniqueStrings([
    getFirstObject(store, principalRoleBindingId, principalRoleBindingPrincipalPredicateId),
  ]);
}

function resolveCapabilityGrantPrincipalIds(
  store: Store,
  capabilityGrantId: string,
): readonly string[] {
  return uniqueStrings([readCapabilityGrantTargetPrincipalId(store, capabilityGrantId)]);
}

function resolveShareGrantPrincipalIds(store: Store, shareGrantId: string): readonly string[] {
  const capabilityGrantId = getFirstObject(
    store,
    shareGrantId,
    shareGrantCapabilityGrantPredicateId,
  );
  if (!capabilityGrantId) {
    return [];
  }

  return resolveCapabilityGrantPrincipalIds(store, capabilityGrantId);
}

function readShareGrantCapabilityGrantId(store: Store, shareGrantId: string): string | undefined {
  return getFirstObject(store, shareGrantId, shareGrantCapabilityGrantPredicateId);
}

function resolveCapabilityVersionAffectedPrincipalIds(
  beforeStore: Store,
  afterStore: Store,
  transaction: GraphWriteTransaction,
  snapshot: StoreSnapshot,
): readonly string[] {
  const touchedPredicatesBySubject = new Map<string, Set<string>>();
  const edgeById = createTransactionEdgeIndex(snapshot);

  for (const operation of transaction.ops) {
    const predicateId =
      operation.op === "assert" ? operation.edge.p : edgeById.get(operation.edgeId)?.p;
    const subjectId =
      operation.op === "assert" ? operation.edge.s : edgeById.get(operation.edgeId)?.s;
    if (!predicateId || !subjectId || !capabilityVersionTriggerPredicateIds.has(predicateId)) {
      continue;
    }

    const predicates = touchedPredicatesBySubject.get(subjectId);
    if (predicates) {
      predicates.add(predicateId);
      continue;
    }
    touchedPredicatesBySubject.set(subjectId, new Set([predicateId]));
  }

  const affectedPrincipalIds = new Set<string>();
  for (const subjectId of touchedPredicatesBySubject.keys()) {
    if (
      hasEntityOfType(beforeStore, subjectId, principalRoleBindingTypeId) ||
      hasEntityOfType(afterStore, subjectId, principalRoleBindingTypeId)
    ) {
      for (const principalId of resolveRoleBindingPrincipalIds(beforeStore, subjectId)) {
        affectedPrincipalIds.add(principalId);
      }
      for (const principalId of resolveRoleBindingPrincipalIds(afterStore, subjectId)) {
        affectedPrincipalIds.add(principalId);
      }
    }

    if (
      hasEntityOfType(beforeStore, subjectId, capabilityGrantTypeId) ||
      hasEntityOfType(afterStore, subjectId, capabilityGrantTypeId)
    ) {
      for (const principalId of resolveCapabilityGrantPrincipalIds(beforeStore, subjectId)) {
        affectedPrincipalIds.add(principalId);
      }
      for (const principalId of resolveCapabilityGrantPrincipalIds(afterStore, subjectId)) {
        affectedPrincipalIds.add(principalId);
      }
    }
  }

  return [...affectedPrincipalIds].sort();
}

function planCapabilityVersionInvalidationTransaction(
  snapshot: StoreSnapshot,
  transaction: GraphWriteTransaction,
): GraphWriteTransaction {
  if (transaction.ops.length === 0) {
    return transaction;
  }

  const beforeStore = createStore(snapshot);
  const afterStore = createStore(snapshot);
  applyGraphWriteTransaction(afterStore, transaction);

  const affectedPrincipalIds = resolveCapabilityVersionAffectedPrincipalIds(
    beforeStore,
    afterStore,
    transaction,
    snapshot,
  );
  if (affectedPrincipalIds.length === 0) {
    return transaction;
  }

  const affectedPrincipalIdSet = new Set(affectedPrincipalIds);
  const edgeById = createTransactionEdgeIndex(snapshot);
  const filteredTransaction = {
    ...transaction,
    ops: transaction.ops.filter((operation) => {
      if (operation.op === "assert") {
        return !(
          operation.edge.p === principalCapabilityVersionPredicateId &&
          affectedPrincipalIdSet.has(operation.edge.s)
        );
      }

      const edge = edgeById.get(operation.edgeId);
      return !(
        edge?.p === principalCapabilityVersionPredicateId && affectedPrincipalIdSet.has(edge.s)
      );
    }),
  };

  return planRecordedMutation(
    snapshot,
    webAppGraph,
    transaction.id,
    (_mutationGraph, mutationStore) => {
      applyGraphWriteTransaction(mutationStore, filteredTransaction);

      for (const principalId of affectedPrincipalIds) {
        if (!hasEntityOfType(mutationStore, principalId, principalTypeId)) {
          continue;
        }

        setSingleReferenceField(
          mutationStore,
          principalId,
          principalCapabilityVersionPredicateId,
          String(readPrincipalCapabilityVersion(mutationStore, principalId) + 1),
        );
      }
    },
  ).transaction;
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

function changesRequireVisibilityReset(
  store: Store,
  snapshot: StoreSnapshot,
  changes: ReturnType<PersistedWebAppAuthority["getChangesAfter"]>,
  authorization: AuthorizationContext,
): boolean {
  if (changes.kind !== "changes" || changes.changes.length === 0) {
    return false;
  }

  const bearerCapabilityGrantIds = new Set(
    isBearerShareAuthorizationContext(authorization)
      ? readAuthorizationCapabilityGrants(store, authorization).map((grant) => grant.id)
      : [],
  );
  const edgeById = createTransactionEdgeIndex(snapshot);
  for (const result of changes.changes) {
    for (const operation of result.transaction.ops) {
      const target = resolveOperationTarget(operation, edgeById);
      if (!target) {
        continue;
      }

      if (
        authorization.principalId !== null &&
        target.subjectId === authorization.principalId &&
        target.predicateId === principalCapabilityVersionPredicateId
      ) {
        return true;
      }

      if (
        bearerCapabilityGrantIds.size > 0 &&
        capabilityVersionTriggerPredicateIds.has(target.predicateId) &&
        hasEntityOfType(store, target.subjectId, capabilityGrantTypeId) &&
        bearerCapabilityGrantIds.has(target.subjectId)
      ) {
        return true;
      }

      if (
        !shareGrantVisibilityTriggerPredicateIds.has(target.predicateId) ||
        !hasEntityOfType(store, target.subjectId, shareGrantTypeId)
      ) {
        continue;
      }

      if (
        (authorization.principalId !== null &&
          resolveShareGrantPrincipalIds(store, target.subjectId).includes(
            authorization.principalId,
          )) ||
        (bearerCapabilityGrantIds.size > 0 &&
          (() => {
            const capabilityGrantId = readShareGrantCapabilityGrantId(store, target.subjectId);
            return capabilityGrantId ? bearerCapabilityGrantIds.has(capabilityGrantId) : false;
          })())
      ) {
        return true;
      }
    }
  }

  return false;
}

function createAuthorizationTarget(
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
  subjectId: string,
  predicateId: string,
): AuthorizationDecisionTarget {
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
  capabilityResolver: AuthorizationCapabilityResolver,
  subjectId: string,
  predicateId: string,
) {
  if (
    !authorizationHasAuthorityAccess(authorization) &&
    subjectIsHiddenIdentityEntity(store, subjectId)
  ) {
    return evaluateAuthorityOnlyIdentityRead(authorization, subjectId, predicateId);
  }

  const target = createAuthorizationTarget(compiledFieldIndex, subjectId, predicateId);
  return authorizeRead({
    authorization,
    capabilityKeys: capabilityResolver.readKeysFor(target),
    sharedRead: capabilityResolver.allowsSharedReadFor(target),
    target,
  });
}

function createReadableReplicationAuthorizer(
  store: Store,
  authorization: AuthorizationContext,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
): ReplicationReadAuthorizer {
  const staleContextError = assertCurrentAuthorizationVersion(store, authorization);
  if (staleContextError) {
    throw createReadPolicyError(staleContextError);
  }
  const capabilityResolver = createAuthorizationCapabilityResolver(store, authorization);

  return ({ subjectId, predicateId }) =>
    evaluateReadAuthorization(
      store,
      authorization,
      compiledFieldIndex,
      capabilityResolver,
      subjectId,
      predicateId,
    ).allowed;
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

function listWorkflowProjectionSubjectIds(store: Store): string[] {
  const subjectIds = new Set<string>();
  for (const edge of store.snapshot().edges) {
    if (edge.p === typePredicateId && workflowProjectionReadEntityTypeIds.has(edge.o)) {
      subjectIds.add(edge.s);
    }
  }

  return [...subjectIds];
}

function assertWorkflowProjectionReadable(
  store: Store,
  authorization: AuthorizationContext,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
): void {
  const staleContextError = assertCurrentAuthorizationVersion(store, authorization);
  if (staleContextError) {
    throw createWorkflowProjectionPolicyError(staleContextError);
  }
  const capabilityResolver = createAuthorizationCapabilityResolver(store, authorization);

  for (const subjectId of listWorkflowProjectionSubjectIds(store)) {
    for (const edge of store.facts(subjectId)) {
      const decision = evaluateReadAuthorization(
        store,
        authorization,
        compiledFieldIndex,
        capabilityResolver,
        subjectId,
        edge.p,
      );
      if (!decision.allowed) {
        throw createWorkflowProjectionPolicyError(decision.error);
      }
    }
  }
}

function assertTransactionAuthorized(
  transaction: GraphWriteTransaction,
  snapshot: StoreSnapshot,
  authorization: AuthorizationContext,
  writeScope: AuthoritativeWriteScope,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
): void {
  const store = createStore(snapshot);
  const policyVersionError = assertCurrentPolicyVersion(authorization);
  const capabilityVersionError = policyVersionError
    ? undefined
    : assertCurrentCapabilityVersion(store, authorization);
  const staleContextError = policyVersionError ?? capabilityVersionError;
  if (staleContextError) {
    throw buildTransactionValidationError(transaction, [
      {
        code: staleContextError.code,
        message: formatPolicyErrorMessage(staleContextError),
        path: ["authorization", capabilityVersionError ? "capabilityVersion" : "policyVersion"],
      },
    ]);
  }
  const capabilityResolver = createAuthorizationCapabilityResolver(store, authorization);

  const issues = resolveTransactionTarget(transaction, snapshot)
    .map((target) => {
      const authorizationTarget = createAuthorizationTarget(
        compiledFieldIndex,
        target.subjectId,
        target.predicateId,
      );
      const decision = authorizeWrite({
        authorization,
        capabilityKeys: capabilityResolver.writeKeysFor(authorizationTarget),
        target: authorizationTarget,
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
  readonly store: Store;
  readonly commandKey: string;
  readonly commandPolicy: GraphCommandPolicy;
  readonly touchedPredicates: ReturnType<typeof buildWriteSecretFieldCommandTargets>;
  readonly writeScope: AuthoritativeWriteScope;
}): void {
  const staleContextError = assertCurrentAuthorizationVersion(input.store, input.authorization);
  if (staleContextError) {
    throw createCommandPolicyError(staleContextError);
  }
  const capabilityResolver = createAuthorizationCapabilityResolver(
    input.store,
    input.authorization,
  );

  const decision = authorizeCommand({
    authorization: input.authorization,
    capabilityKeys: capabilityResolver.commandKeysFor({
      commandKey: input.commandKey,
      commandPolicy: input.commandPolicy,
      touchedPredicates: input.touchedPredicates,
    }),
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
  preloadedPersistedState: PersistedAuthoritativeGraphStorageLoadResult | null,
): PersistedAuthoritativeGraphStorage {
  // This adapter is the explicit boundary between the stable graph/runtime
  // persisted-authority contract and web-only secret side storage.
  let preloadedLoadUsed = false;

  return {
    async load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null> {
      if (!preloadedLoadUsed) {
        preloadedLoadUsed = true;
        const persistedState = preloadedPersistedState;
        if (!persistedState) return null;

        return {
          snapshot: clonePersistedValue(persistedState.snapshot),
          writeHistory: persistedState.writeHistory
            ? clonePersistedValue(persistedState.writeHistory)
            : undefined,
          needsPersistence: persistedState.needsPersistence,
        };
      }

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
  const persistedState = await storage.load();
  const { bootstrappedSnapshot, compiledFieldIndex, scalarByKey, typeByKey } =
    getCompiledGraphArtifacts(graph);
  const store = createStore(bootstrappedSnapshot);
  let persistedSecrets: Record<string, WebAppAuthoritySecretRecord> = {};
  if (persistedState) {
    const startupSecretInventory = await storage.inspectSecrets();
    const startupDrift = resolveSecretStartupDrift(
      persistedState.snapshot,
      graph,
      startupSecretInventory,
    );
    if (hasBlockingSecretStartupDrift(startupDrift)) {
      throw new WebAppAuthoritySecretStorageDriftError(startupDrift);
    }
    if (startupDrift.orphanedSecretIds.length > 0) {
      await storage.repairSecrets({
        liveSecretIds: startupDrift.liveSecretIds,
      });
    }
    persistedSecrets =
      startupDrift.liveSecretIds.length > 0
        ? await storage.loadSecrets({ secretIds: startupDrift.liveSecretIds })
        : {};
    const loadedSecretDrift = resolveSecretStartupDrift(
      persistedState.snapshot,
      graph,
      toSecretInventory(persistedSecrets),
    );
    if (hasBlockingSecretStartupDrift(loadedSecretDrift)) {
      throw new WebAppAuthoritySecretStorageDriftError(loadedSecretDrift);
    }
  }
  const secretValuesRef = {
    current: new Map(
      Object.entries(persistedSecrets).map(([secretId, secret]) => [secretId, secret.value]),
    ),
  };
  const pendingSecretWriteRef = {
    current: null as WebAppAuthoritySecretWrite | null,
  };
  const authority = await createPersistedAuthoritativeGraph(store, graph, {
    storage: createAuthorityStorage(storage, pendingSecretWriteRef, persistedState),
    seed() {
      if (options.seedExampleGraph !== false) {
        seedExampleGraph(createTypeClient(store, webAppGraph));
      }
    },
    createCursorPrefix: createAuthorityCursorPrefix,
    retainedHistoryPolicy: options.retainedHistoryPolicy,
  });
  const workflowReviewInvalidationListener = options.onWorkflowReviewInvalidation;
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

    const staleContextError = assertCurrentAuthorizationVersion(
      authority.store,
      options.authorization,
    );
    if (staleContextError) {
      throw createReadPolicyError(staleContextError);
    }

    const decision = evaluateReadAuthorization(
      authority.store,
      options.authorization,
      compiledFieldIndex,
      createAuthorizationCapabilityResolver(authority.store, options.authorization),
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

  function createAuthorizedWorkflowProjection(authorization: AuthorizationContext) {
    assertWorkflowProjectionReadable(authority.store, authorization, compiledFieldIndex);
    return createWorkflowProjectionIndex(createTypeClient(authority.store, workflowSchema));
  }

  function readProjectBranchScope(
    query: ProjectBranchScopeQuery,
    options: WebAppAuthorityReadOptions,
  ): ProjectBranchScopeResult {
    const projection = createAuthorizedWorkflowProjection(options.authorization);
    try {
      return projection.readProjectBranchScope(query);
    } catch (error) {
      return throwWorkflowProjectionReadError(error);
    }
  }

  function readCommitQueueScope(
    query: CommitQueueScopeQuery,
    options: WebAppAuthorityReadOptions,
  ): CommitQueueScopeResult {
    const projection = createAuthorizedWorkflowProjection(options.authorization);
    try {
      return projection.readCommitQueueScope(query);
    } catch (error) {
      return throwWorkflowProjectionReadError(error);
    }
  }

  function planWorkflowReviewLiveRegistration(
    cursor: string,
    options: WebAppAuthorityReadOptions,
  ): WorkflowReviewLiveRegistrationTarget {
    const staleContextError = assertCurrentAuthorizationVersion(
      authority.store,
      options.authorization,
    );
    if (staleContextError) {
      throw createReadPolicyError(staleContextError);
    }

    const parsedCursor = parseScopedModuleCursor(cursor);
    if (!parsedCursor) {
      throw new WebAppAuthorityWorkflowLiveScopeError(
        400,
        "Workflow live registration requires the current scoped workflow-review cursor.",
      );
    }

    const plannedScope = planSyncScope(workflowReviewModuleReadScope, options.authorization);
    if (!plannedScope) {
      throw new WebAppAuthorityWorkflowLiveScopeError(
        500,
        "Workflow live registration planning requires the shipped workflow review scope.",
      );
    }

    if (
      parsedCursor.moduleId !== plannedScope.scope.moduleId ||
      parsedCursor.scopeId !== plannedScope.scope.scopeId ||
      parsedCursor.definitionHash !== plannedScope.scope.definitionHash
    ) {
      throw new WebAppAuthorityWorkflowLiveScopeError(
        409,
        `Workflow live registration cursor no longer matches scope "${plannedScope.scope.scopeId}". Re-sync and register again.`,
        "scope-changed",
      );
    }

    if (parsedCursor.policyFilterVersion !== plannedScope.scope.policyFilterVersion) {
      throw new WebAppAuthorityWorkflowLiveScopeError(
        409,
        `Workflow live registration cursor policy "${parsedCursor.policyFilterVersion}" does not match the current workflow review policy filter "${plannedScope.scope.policyFilterVersion}". Re-sync and register again.`,
        "policy-changed",
      );
    }

    const principal = requireWorkflowLiveRegistrationPrincipal(options.authorization);

    return Object.freeze({
      sessionId: principal.sessionId,
      principalId: principal.principalId,
      scopeId: plannedScope.scope.scopeId,
      definitionHash: plannedScope.scope.definitionHash,
      policyFilterVersion: plannedScope.scope.policyFilterVersion,
      dependencyKeys: Object.freeze([...compileWorkflowReviewScopeDependencyKeys()]),
    });
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
      diagnostics: formatScopedSyncDiagnostics(plannedScope.scope, payload.diagnostics),
    };
  }

  async function applyTransaction(
    transaction: GraphWriteTransaction,
    options: WebAppAuthorityTransactionOptions,
  ) {
    const writeScope = options.writeScope ?? "client-tx";
    const snapshot = authority.store.snapshot();
    const plannedTransaction = planCapabilityVersionInvalidationTransaction(snapshot, transaction);
    const touchedTypeIds = collectTouchedTypeIdsForTransaction(
      snapshot,
      authority.store,
      plannedTransaction,
    );
    assertTransactionAuthorized(
      transaction,
      snapshot,
      options.authorization,
      writeScope,
      compiledFieldIndex,
    );
    const result = await authority.applyTransaction(plannedTransaction, {
      writeScope,
    });

    if (!result.replayed) {
      const invalidation = createWorkflowReviewInvalidationEvent({
        eventId: `workflow-review:${result.cursor}`,
        graphId: webAppGraphId,
        sourceCursor: result.cursor,
        touchedTypeIds,
      });
      if (invalidation) {
        try {
          // Live fan-out is ephemeral; losing it must not affect the committed write.
          workflowReviewInvalidationListener?.(invalidation);
        } catch {}
      }
    }

    return result;
  }

  function getIncrementalSyncResult(
    after: string | undefined,
    options: WebAppAuthoritySyncOptions,
  ) {
    const requestedAfter = after;
    const snapshot = authority.store.snapshot();
    const authorizeRead = createReadableReplicationAuthorizer(
      authority.store,
      options.authorization,
      compiledFieldIndex,
    );
    const plannedScope = planSyncScope(options.scope, options.authorization);
    if (after && plannedScope) {
      const currentPayload = authority.createSyncPayload({
        authorizeRead,
        freshness: options.freshness,
      });
      const currentScopedCursor = formatScopedModuleCursor(
        plannedScope.scope,
        currentPayload.cursor,
      );
      const currentDiagnostics = formatScopedSyncDiagnostics(
        plannedScope.scope,
        currentPayload.diagnostics,
      );
      const parsedAfter = parseScopedModuleCursor(after);
      if (!parsedAfter) {
        return createIncrementalSyncFallback("scope-changed", {
          after,
          cursor: currentScopedCursor,
          freshness: options.freshness,
          scope: plannedScope.scope,
          diagnostics: currentDiagnostics,
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
          diagnostics: currentDiagnostics,
        });
      }
      if (parsedAfter.policyFilterVersion !== plannedScope.scope.policyFilterVersion) {
        return createIncrementalSyncFallback("policy-changed", {
          after,
          cursor: currentScopedCursor,
          freshness: options.freshness,
          scope: plannedScope.scope,
          diagnostics: currentDiagnostics,
        });
      }
      after = parsedAfter.cursor;
    }

    if (after) {
      const changes = authority.getChangesAfter(after);
      if (
        changesRequireVisibilityReset(authority.store, snapshot, changes, options.authorization)
      ) {
        const cursor = plannedScope
          ? formatScopedModuleCursor(plannedScope.scope, changes.cursor)
          : changes.cursor;

        return createIncrementalSyncFallback(plannedScope ? "policy-changed" : "reset", {
          after: requestedAfter ?? after,
          cursor,
          freshness: options.freshness,
          ...(plannedScope ? { scope: plannedScope.scope } : {}),
        });
      }
    }

    const result = authority.getIncrementalSyncResult(after, {
      authorizeRead,
      freshness: options.freshness,
    });
    if (!plannedScope) {
      return result;
    }
    const resultAfter = formatScopedModuleCursor(plannedScope.scope, result.after);
    const resultCursor = formatScopedModuleCursor(plannedScope.scope, result.cursor);
    if ("fallback" in result) {
      return createIncrementalSyncFallback(result.fallback, {
        after: resultAfter,
        cursor: resultCursor,
        freshness: result.freshness,
        scope: plannedScope.scope,
        diagnostics: formatScopedSyncDiagnostics(plannedScope.scope, result.diagnostics),
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
      diagnostics: formatScopedSyncDiagnostics(plannedScope.scope, result.diagnostics),
    });
  }

  async function lookupBearerShare(input: BearerShareLookupInput): Promise<BearerShareProjection> {
    return readBearerShareProjection(authority.store, input);
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
      store: authority.store,
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
    lookupBearerShare,
    lookupSessionPrincipal,
    planWorkflowReviewLiveRegistration,
    readCommitQueueScope,
    readPredicateValue,
    readProjectBranchScope,
    readSnapshot,
    writeSecretField,
  };
}
