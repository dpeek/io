import {
  defineAdmissionPolicy,
  type AdmissionPolicy,
  type AuthSubjectRef,
  type AuthorizationContext,
  authorizeCommand,
  authorizeRead,
  authorizeWrite,
  createPersistedAuthoritativeGraph,
  type GraphCommandPolicy,
  type PersistedAuthoritativeGraph,
  type PersistedAuthoritativeGraphRetainedRecord,
  type PersistedAuthoritativeGraphStorage,
  type PersistedAuthoritativeGraphStorageCommitInput,
  type PersistedAuthoritativeGraphStorageLoadResult,
  type PersistedAuthoritativeGraphStoragePersistInput,
  type PolicyError,
  type PrincipalKind,
  type ReplicationReadAuthorizer,
  validateShareGrant,
  type WebPrincipalSummary,
} from "@io/graph-authority";
import { bootstrap } from "@io/graph-bootstrap";
import {
  collectScalarCodecs,
  collectTypeIndex,
  createGraphClient,
  GraphValidationError,
  type NormalizedQueryRequest,
  type GraphClient,
  type QueryIdentityExecutionContext,
  type QueryLiteral,
  type QueryResultItem,
  type QueryResultPage,
  readPredicateValue as decodePredicateValue,
  type SerializedQueryResponse,
  type SerializedQueryRequest,
  SerializedQueryValidationError,
  normalizeSerializedQueryRequest,
} from "@io/graph-client";
import {
  createGraphStore as createStore,
  edgeId,
  isEntityType,
  isSecretBackedField,
  resolveFieldPolicyDescriptor,
  type AnyTypeOutput,
  type Cardinality,
  type GraphFieldAuthority,
  type GraphStore,
  type GraphStoreSnapshot,
  type PredicatePolicyDescriptor,
} from "@io/graph-kernel";
import {
  type AuthoritativeGraphRetainedHistoryPolicy,
  type GraphWriteTransaction,
  type AuthoritativeGraphWriteResult,
  type GraphWriteScope,
} from "@io/graph-kernel";
import { core, coreCatalogModuleReadScope, coreGraphBootstrapOptions } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";
import {
  agentSession,
  type AgentSessionAppendRequest,
  type AgentSessionAppendResult,
  type ArtifactWriteRequest,
  type ArtifactWriteResult,
  type DecisionWriteRequest,
  type DecisionWriteResult,
  compileWorkflowReviewScopeDependencyKeys,
  createWorkflowReviewInvalidationEvent,
  createWorkflowProjectionIndexFromRetainedState,
  repositoryBranch,
  repositoryCommit,
  branch,
  commit,
  project,
  repository,
  createRetainedWorkflowProjectionState,
  type CommitQueueScopeFailureCode,
  type CommitQueueScopeQuery,
  type CommitQueueScopeResult,
  type ProjectBranchScopeFailureCode,
  type ProjectBranchScopeQuery,
  type ProjectBranchScopeResult,
  type RetainedWorkflowProjectionState,
  WorkflowProjectionQueryError,
  projectionSchema,
  workflowReviewModuleReadScope,
  type WorkflowMutationAction,
  type WorkflowMutationResult,
} from "@io/graph-module-workflow";
import {
  createModuleReadScope,
  matchesModuleReadScopeRequest,
  type InvalidationEvent,
} from "@io/graph-projection";
import {
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  createModuleSyncScope,
  type ModuleSyncScope,
  type SyncDiagnostics,
} from "@io/graph-sync";

import type {
  BearerShareLookupInput,
  BearerShareProjection,
  SessionPrincipalLookupInput,
  SessionPrincipalProjection,
} from "./auth-bridge.js";
import { seedExampleGraph } from "./example-data.js";
import { planRecordedMutation, planRecordedMutationAsync } from "./mutation-planning.js";
import { webAppPolicyVersion } from "./policy-version.js";
import {
  getInstalledModuleQuerySurface,
  getInstalledModuleQuerySurfaceRendererCompatibility,
  installedModuleQueryEditorCatalog,
  installedModuleQuerySurfaceRegistry,
} from "./query-surface-registry.js";
import {
  resolveSerializedQueryCollectionExecutor,
  resolveSerializedQueryScopeExecutor,
} from "./serialized-query-executor-registry.js";
import { createWebAppSerializedQueryExecutorRegistry } from "./registered-serialized-query-executors.js";
import {
  createGraphBackedSavedQueryRepository,
  deriveSavedQueryRecord,
  deriveSavedViewRecord,
  resolveSavedQueryDefinition,
  resolveSavedViewDefinition,
  toSavedQueryDefinitionInput,
  toSavedViewDefinitionInput,
  validateSavedQueryCompatibility,
  validateSavedViewCompatibility,
  type SavedQueryRecordInput,
  type SavedQueryRecord,
  type SavedQueryResolution,
  type SavedViewRecordInput,
  type SavedViewRecord,
  type SavedViewResolution,
} from "./saved-query.js";
import {
  buildSecretHandleName,
  secretFieldEntityIdRequiredMessage,
  secretFieldPlaintextRequiredMessage,
  secretFieldPredicateIdRequiredMessage,
  type WriteSecretFieldInput,
  type WriteSecretFieldResult,
} from "./secret-fields.js";
import {
  createPersistedRetainedDocumentRecords,
  createRetainedDocumentState,
  hasRetainedDocumentState,
  loadRetainedDocumentStateFromPersistedRecords,
  planRetainedDocumentRecovery,
  retainedDocumentRecordKinds,
  sameRetainedDocumentState,
  type RetainedDocumentState,
} from "./retained-documents.js";
import { runWorkflowArtifactWriteCommand } from "./workflow-artifact.js";
import { runWorkflowDecisionWriteCommand } from "./workflow-decision.js";
import { runAgentSessionAppendCommand } from "./workflow-session-history.js";
import { runWorkflowMutationCommand } from "./workflow-authority.js";
import { readWorkflowSessionFeed as readWorkflowSessionFeedResult } from "./workflow-session-feed.js";
import type {
  WorkflowSessionFeedReadQuery,
  WorkflowSessionFeedReadResult,
} from "./workflow-session-feed-contract.js";
import { WorkflowMutationError } from "./workflow-mutation-helpers.js";
import type { WorkflowReviewLiveRegistrationTarget } from "./workflow-live-transport.js";

const webAppGraph = { ...core, ...workflow } as const;

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
  readonly bootstrappedSnapshot: GraphStoreSnapshot;
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

export type AgentSessionAppendWebAppAuthorityCommand = {
  readonly kind: "agent-session-append";
  readonly input: AgentSessionAppendRequest;
};

export type ArtifactWriteWebAppAuthorityCommand = {
  readonly kind: "artifact-write";
  readonly input: ArtifactWriteRequest;
};

export type DecisionWriteWebAppAuthorityCommand = {
  readonly kind: "decision-write";
  readonly input: DecisionWriteRequest;
};

export type BootstrapOperatorAccessInput = {
  readonly email: string;
  readonly graphId?: string;
  readonly roleKeys?: readonly string[];
};

export type BootstrapOperatorAccessWebAppAuthorityCommand = {
  readonly kind: "bootstrap-operator-access";
  readonly input: BootstrapOperatorAccessInput;
};

export type SetAdmissionApprovalInput = {
  readonly email: string;
  readonly graphId?: string;
  readonly roleKeys?: readonly string[];
  readonly status?: "active" | "revoked";
};

export type SetAdmissionApprovalWebAppAuthorityCommand = {
  readonly kind: "set-admission-approval";
  readonly input: SetAdmissionApprovalInput;
};

export type WebAppAuthorityCommand =
  | WriteSecretFieldWebAuthorityCommand
  | WorkflowMutationWebAppAuthorityCommand
  | AgentSessionAppendWebAppAuthorityCommand
  | ArtifactWriteWebAppAuthorityCommand
  | DecisionWriteWebAppAuthorityCommand
  | BootstrapOperatorAccessWebAppAuthorityCommand
  | SetAdmissionApprovalWebAppAuthorityCommand;

export type BootstrapOperatorAccessResult = {
  readonly approvalId: string;
  readonly created: boolean;
  readonly email: string;
  readonly graphId: string;
  readonly policyId: string;
  readonly roleKeys: readonly string[];
};

export type SetAdmissionApprovalResult = {
  readonly approvalId: string;
  readonly created: boolean;
  readonly email: string;
  readonly graphId: string;
  readonly roleKeys: readonly string[];
  readonly status: "active" | "revoked";
};

type WebAppAuthorityCommandResultMap = {
  "write-secret-field": WriteSecretFieldResult;
  "workflow-mutation": WorkflowMutationResult;
  "agent-session-append": AgentSessionAppendResult;
  "artifact-write": ArtifactWriteResult;
  "decision-write": DecisionWriteResult;
  "bootstrap-operator-access": BootstrapOperatorAccessResult;
  "set-admission-approval": SetAdmissionApprovalResult;
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
  loadWorkflowProjection(): Promise<RetainedWorkflowProjectionState | null>;
  replaceRetainedDocuments(retainedDocuments: RetainedDocumentState | null): Promise<void>;
  replaceWorkflowProjection(projection: RetainedWorkflowProjectionState | null): Promise<void>;
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
      readonly projection?: RetainedWorkflowProjectionState;
    },
  ): Promise<void>;
  persist(
    input: PersistedAuthoritativeGraphStoragePersistInput,
    options?: {
      readonly projection?: RetainedWorkflowProjectionState;
    },
  ): Promise<void>;
}

type WebAppAuthoritySyncFreshness = NonNullable<
  Parameters<PersistedWebAppAuthority["createTotalSyncPayload"]>[0]
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

export type WebAppAuthoritySavedQueryUpsertInput = SavedQueryRecordInput;

export type WebAppAuthoritySavedViewUpsertInput = SavedViewRecordInput;

export type WebAppAuthoritySavedQueryResolutionInput = {
  readonly executionContext?: QueryIdentityExecutionContext;
  readonly params?: Readonly<Record<string, QueryLiteral>>;
  readonly queryId: string;
};

export type WebAppAuthoritySavedViewResolutionInput = {
  readonly executionContext?: QueryIdentityExecutionContext;
  readonly params?: Readonly<Record<string, QueryLiteral>>;
  readonly viewId: string;
};

export type WebAppAuthority = Omit<
  PersistedWebAppAuthority,
  "applyTransaction" | "createTotalSyncPayload" | "getIncrementalSyncResult" | "graph" | "store"
> & {
  activateSessionPrincipalRoleBindings(
    input: SessionPrincipalLookupInput,
  ): Promise<SessionPrincipalProjection>;
  deleteSavedQuery(id: string, options: WebAppAuthorityReadOptions): Promise<void>;
  deleteSavedView(id: string, options: WebAppAuthorityReadOptions): Promise<void>;
  getPolicyVersion(): number;
  getSavedQuery(
    id: string,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedQueryRecord | undefined>;
  getSavedView(
    id: string,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedViewRecord | undefined>;
  listSavedQueries(options: WebAppAuthorityReadOptions): Promise<readonly SavedQueryRecord[]>;
  listSavedViews(options: WebAppAuthorityReadOptions): Promise<readonly SavedViewRecord[]>;
  lookupBearerShare(input: BearerShareLookupInput): Promise<BearerShareProjection>;
  lookupSessionPrincipal(
    input: SessionPrincipalLookupInput,
    options?: WebAppAuthoritySessionPrincipalLookupOptions,
  ): Promise<SessionPrincipalProjection>;
  readSnapshot(options: WebAppAuthorityReadOptions): GraphStoreSnapshot;
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
  readWorkflowSessionFeed(
    query: WorkflowSessionFeedReadQuery,
    options: WebAppAuthorityReadOptions,
  ): WorkflowSessionFeedReadResult;
  resolveSavedQuery(
    input: WebAppAuthoritySavedQueryResolutionInput,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedQueryResolution>;
  resolveSavedView(
    input: WebAppAuthoritySavedViewResolutionInput,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedViewResolution>;
  executeSerializedQuery(
    request: SerializedQueryRequest,
    options: WebAppAuthorityReadOptions,
  ): Promise<SerializedQueryResponse>;
  saveSavedQuery(
    input: WebAppAuthoritySavedQueryUpsertInput,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedQueryRecord>;
  saveSavedView(
    input: WebAppAuthoritySavedViewUpsertInput,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedViewRecord>;
  planWorkflowReviewLiveRegistration(
    cursor: string,
    options: WebAppAuthorityReadOptions,
  ): WorkflowReviewLiveRegistrationTarget;
  createTotalSyncPayload(
    options: WebAppAuthoritySyncOptions,
  ): ReturnType<PersistedWebAppAuthority["createTotalSyncPayload"]>;
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
  rebuildRetainedWorkflowProjection(): Promise<void>;
  writeSecretField(
    input: WriteSecretFieldInput,
    options: WebAppAuthoritySecretFieldOptions,
  ): Promise<WriteSecretFieldResult>;
};

export type WebAppAuthorityOptions = {
  readonly graph?: WebAppAuthorityGraph;
  readonly onWorkflowReviewInvalidation?: (invalidation: InvalidationEvent) => void;
  readonly policyVersion?: number;
  readonly retainedHistoryPolicy?: AuthoritativeGraphRetainedHistoryPolicy;
  readonly seedExampleGraph?: boolean;
};

const typePredicateId = edgeId(core.node.fields.type);
const namePredicateId = edgeId(core.node.fields.name);
const createdAtPredicateId = edgeId(core.node.fields.createdAt);
const updatedAtPredicateId = edgeId(core.node.fields.updatedAt);
const secretHandleVersionPredicateId = edgeId(core.secretHandle.fields.version);
const secretHandleLastRotatedAtPredicateId = edgeId(core.secretHandle.fields.lastRotatedAt);
const principalKindPredicateId = edgeId(core.principal.fields.kind);
const principalStatusPredicateId = edgeId(core.principal.fields.status);
const principalCapabilityVersionPredicateId = edgeId(core.principal.fields.capabilityVersion);
const graphWriteTransactionValidationKey = "$sync:tx";
const webAppGraphId = "graph:global";
const authorityRoleKey = "graph:authority";
const graphMemberRoleKey = "graph:member";
const ownerRoleKey = "graph:owner";
const setAdmissionApprovalCommandKey = "set-admission-approval";
const writeSecretFieldCommandKey = "write-secret-field";
const defaultBootstrapOperatorRoleKeys = [ownerRoleKey, authorityRoleKey] as const;
const writeSecretFieldCommandBasePredicateIds = [
  typePredicateId,
  createdAtPredicateId,
  namePredicateId,
  updatedAtPredicateId,
  secretHandleVersionPredicateId,
  secretHandleLastRotatedAtPredicateId,
] as const;
const moduleScopeCursorPrefix = "scope:";
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

const workflowModuleEntityTypeIds = createModuleEntityTypeIds(projectionSchema);
const coreModuleEntityTypeIds = createModuleEntityTypeIds(core);
const projectionReadEntityTypeIds = new Set(
  [
    project,
    repository,
    branch,
    commit,
    repositoryBranch,
    repositoryCommit,
    agentSession,
    workflow.document,
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
const admissionApprovalGraphIdPredicateId = edgeId(core.admissionApproval.fields.graphId);
const admissionApprovalEmailPredicateId = edgeId(core.admissionApproval.fields.email);
const admissionApprovalRoleKeyPredicateId = edgeId(core.admissionApproval.fields.roleKey);
const admissionApprovalStatusPredicateId = edgeId(core.admissionApproval.fields.status);
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
const admissionPolicyGraphIdPredicateId = edgeId(core.admissionPolicy.fields.graphId);
const admissionPolicyBootstrapModePredicateId = edgeId(core.admissionPolicy.fields.bootstrapMode);
const admissionPolicySignupPolicyPredicateId = edgeId(core.admissionPolicy.fields.signupPolicy);
const admissionPolicyAllowedEmailDomainPredicateId = edgeId(
  core.admissionPolicy.fields.allowedEmailDomain,
);
const admissionPolicyFirstUserRoleKeyPredicateId = edgeId(
  core.admissionPolicy.fields.firstUserRoleKey,
);
const admissionPolicySignupRoleKeyPredicateId = edgeId(core.admissionPolicy.fields.signupRoleKey);
const principalTypeId = core.principal.values.id;
const authSubjectProjectionTypeId = core.authSubjectProjection.values.id;
const principalRoleBindingTypeId = core.principalRoleBinding.values.id;
const admissionApprovalTypeId = core.admissionApproval.values.id;
const capabilityGrantTypeId = core.capabilityGrant.values.id;
const shareGrantTypeId = core.shareGrant.values.id;
const admissionPolicyTypeId = core.admissionPolicy.values.id;
const nonAuthorityHiddenIdentityTypeIds = new Set([
  principalTypeId,
  authSubjectProjectionTypeId,
  principalRoleBindingTypeId,
  admissionApprovalTypeId,
  capabilityGrantTypeId,
  shareGrantTypeId,
  admissionPolicyTypeId,
]);
const activePrincipalStatusId = core.principalStatus.values.active.id;
const activeAuthSubjectStatusId = core.authSubjectStatus.values.active.id;
const activePrincipalRoleBindingStatusId = core.principalRoleBindingStatus.values.active.id;
const activeAdmissionApprovalStatusId = core.admissionApprovalStatus.values.active.id;
const revokedAdmissionApprovalStatusId = core.admissionApprovalStatus.values.revoked.id;
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
const firstUserAdmissionBootstrapModeId = core.admissionBootstrapMode.values.firstUser.id;
const manualAdmissionBootstrapModeId = core.admissionBootstrapMode.values.manual.id;
const openAdmissionSignupPolicyId = core.admissionSignupPolicy.values.open.id;
const closedAdmissionSignupPolicyId = core.admissionSignupPolicy.values.closed.id;
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

function headCursor(
  writeHistory: PersistedAuthoritativeGraphStoragePersistInput["writeHistory"],
): string {
  return (
    writeHistory.results.at(-1)?.cursor ??
    `${writeHistory.cursorPrefix}${writeHistory.baseSequence}`
  );
}

function buildRetainedWorkflowProjectionState(
  snapshot: GraphStoreSnapshot,
  sourceCursor: string,
): RetainedWorkflowProjectionState {
  const projectionStore = createStore(snapshot);
  return createRetainedWorkflowProjectionState(
    createGraphClient(projectionStore, projectionSchema),
    {
      sourceCursor,
    },
  );
}

function buildRetainedDocumentState(snapshot: GraphStoreSnapshot): RetainedDocumentState {
  return createRetainedDocumentState(snapshot);
}

const retainedDocumentRecordKindSet = new Set<string>(retainedDocumentRecordKinds);

function filterNonDocumentRetainedRecords(
  records: readonly PersistedAuthoritativeGraphRetainedRecord[] | null | undefined,
): readonly PersistedAuthoritativeGraphRetainedRecord[] {
  if (!records || records.length === 0) {
    return [];
  }

  return records.filter((record) => !retainedDocumentRecordKindSet.has(record.recordKind));
}

function mergeSnapshotWithBootstrappedSchema(
  bootstrappedSnapshot: GraphStoreSnapshot,
  persistedSnapshot: GraphStoreSnapshot,
): GraphStoreSnapshot {
  const edgesById = new Map(
    bootstrappedSnapshot.edges.map((edge) => [edge.id, clonePersistedValue(edge)] as const),
  );
  for (const edge of persistedSnapshot.edges) {
    edgesById.set(edge.id, clonePersistedValue(edge));
  }

  const retracted = new Set([...bootstrappedSnapshot.retracted, ...persistedSnapshot.retracted]);

  return {
    edges: [...edgesById.values()],
    retracted: [...retracted],
  };
}

function sameRetainedWorkflowProjectionState(
  left: RetainedWorkflowProjectionState,
  right: RetainedWorkflowProjectionState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function classifyRetainedWorkflowProjectionRecovery(
  retained: RetainedWorkflowProjectionState | null,
  authoritative: RetainedWorkflowProjectionState,
): "missing" | "incompatible" | "stale" | null {
  if (!retained) {
    return "missing";
  }

  try {
    createWorkflowProjectionIndexFromRetainedState(retained);
  } catch {
    return "incompatible";
  }

  return sameRetainedWorkflowProjectionState(retained, authoritative) ? null : "stale";
}

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatPolicyErrorMessage(error: PolicyError): string {
  return `${error.code}: ${error.message}`;
}

function assertCurrentPolicyVersion(
  authorization: AuthorizationContext,
  authorityPolicyVersion: number,
): PolicyError | undefined {
  if (authorization.policyVersion === authorityPolicyVersion) {
    return undefined;
  }

  return {
    code: "policy.stale_context",
    message: `Authorization context policy version "${authorization.policyVersion}" does not match authority policy version "${authorityPolicyVersion}". Refresh the authorization context and retry.`,
    retryable: false,
    refreshRequired: true,
  };
}

function assertCurrentCapabilityVersion(
  store: GraphStore,
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
  store: GraphStore,
  authorization: AuthorizationContext,
  authorityPolicyVersion: number,
): PolicyError | undefined {
  return (
    assertCurrentPolicyVersion(authorization, authorityPolicyVersion) ??
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
        policy: resolveFieldPolicyDescriptor(value)!,
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
  bootstrap(bootstrappedStore, graph, coreGraphBootstrapOptions);
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

class UnsupportedSerializedQueryPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSerializedQueryPlanError";
  }
}

class StaleSerializedQueryCursorError extends Error {
  constructor(cursor: string) {
    super(
      `Cursor "${cursor}" is stale for the current serialized query. Restart from the first page or refresh the active query and retry.`,
    );
    this.name = "StaleSerializedQueryCursorError";
  }
}

function createSerializedQueryErrorResponse(error: string, code: string): SerializedQueryResponse {
  return {
    ok: false,
    error,
    code,
  };
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
  edgeById: Map<string, GraphStoreSnapshot["edges"][number]>,
): string | undefined {
  if (operation.op === "assert") return operation.edge.s;
  return edgeById.get(operation.edgeId)?.s;
}

function subjectTypeId(store: GraphStore, subjectId: string): string | undefined {
  return store.get(subjectId, typePredicateId) ?? store.find(subjectId, typePredicateId)[0]?.o;
}

function addTouchedSubjectTypeId(
  typeIds: Set<string>,
  store: GraphStore,
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
  snapshot: GraphStoreSnapshot,
  store: GraphStore,
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
  store: GraphStore,
  typeIds: ReadonlySet<string>,
  subjectId: string,
): boolean {
  const currentTypeId = subjectTypeId(store, subjectId);
  return currentTypeId !== undefined && typeIds.has(currentTypeId);
}

function filterModuleScopedSnapshot(
  snapshot: GraphStoreSnapshot,
  store: GraphStore,
  plannedScope: PlannedWebAppAuthorityScope,
): GraphStoreSnapshot {
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
  store: GraphStore,
  edgeById: Map<string, GraphStoreSnapshot["edges"][number]>,
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
  authorityPolicyVersion: number,
): PlannedWebAppAuthorityScope | undefined {
  if (isGraphScopeRequest(scope)) return undefined;

  if (matchesModuleReadScopeRequest(scope, workflowReviewModuleReadScope)) {
    return {
      scope: createModuleReadScope(
        workflowReviewModuleReadScope,
        createPolicyFilterVersion(authorityPolicyVersion),
      ),
      typeIds: workflowModuleEntityTypeIds,
    };
  }

  if (matchesModuleReadScopeRequest(scope, coreCatalogModuleReadScope)) {
    return {
      scope: createModuleReadScope(
        coreCatalogModuleReadScope,
        createPolicyFilterVersion(authorityPolicyVersion),
      ),
      typeIds: coreModuleEntityTypeIds,
    };
  }

  throw new WebAppAuthorityReadError(
    404,
    `Scope "${scope.scopeId}" was not found for module "${scope.moduleId}".`,
  );
}
export class WebAppAuthoritySessionPrincipalLookupError extends Error {
  readonly status: number;
  readonly code = "auth.principal_missing" as const;
  readonly reason: "conflict" | "denied" | "missing";

  constructor(status: number, reason: "conflict" | "denied" | "missing", message: string) {
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
function getFirstObject(
  store: GraphStore,
  subjectId: string,
  predicateId: string,
): string | undefined {
  return store.facts(subjectId, predicateId)[0]?.o;
}

function getEntityLabel(store: GraphStore, id: string): string {
  return getFirstObject(store, id, namePredicateId) ?? id;
}

export function collectLiveSecretIds(snapshot: GraphStoreSnapshot): readonly string[] {
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
  snapshot: GraphStoreSnapshot,
  graph: WebAppAuthorityGraph,
  secretInventory: Record<string, WebAppAuthoritySecretInventoryRecord>,
): WebAppAuthoritySecretStartupDrift {
  const liveSecretIds = collectLiveSecretIds(snapshot);
  const liveSecretIdSet = new Set(liveSecretIds);
  const persistedStore = createStore(snapshot);
  const persistedGraph = createGraphClient(persistedStore, graph);
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

function hasEntityOfType(store: GraphStore, entityId: string, typeId: string): boolean {
  return store.facts(entityId, typePredicateId, typeId).length > 0;
}

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => typeof value === "string"))];
}

function readNonNegativeIntegerField(
  store: GraphStore,
  subjectId: string,
  predicateId: string,
): number {
  const raw = getFirstObject(store, subjectId, predicateId);
  if (raw === undefined) {
    return 0;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function readPrincipalCapabilityVersion(store: GraphStore, principalId: string): number {
  return readNonNegativeIntegerField(store, principalId, principalCapabilityVersionPredicateId);
}

function readCapabilityGrantTargetPrincipalId(
  store: GraphStore,
  capabilityGrantId: string,
): string | undefined {
  return getFirstObject(store, capabilityGrantId, capabilityGrantTargetKindPredicateId) ===
    principalCapabilityGrantTargetKindId
    ? getFirstObject(store, capabilityGrantId, capabilityGrantTargetPrincipalPredicateId)
    : undefined;
}

function readCapabilityGrantTargetKindId(
  store: GraphStore,
  capabilityGrantId: string,
): string | undefined {
  return getFirstObject(store, capabilityGrantId, capabilityGrantTargetKindPredicateId);
}

function readResolvedAuthorizationCapabilityGrant(
  store: GraphStore,
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
  store: GraphStore,
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
  store: GraphStore,
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
  store: GraphStore,
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
  store: GraphStore,
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
  store: GraphStore,
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
  store: GraphStore,
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
  store: GraphStore,
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
  store: GraphStore,
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
  store: GraphStore,
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

function listActiveAuthSubjectProjectionIds(store: GraphStore, subject: AuthSubjectRef): string[] {
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

function listActiveAuthUserProjectionIds(store: GraphStore, authUserId: string): string[] {
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

function readPrincipalRoleKeys(store: GraphStore, principalId: string): readonly string[] {
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

function principalHasAuthorityAccess(
  principalKind: PrincipalKind,
  roleKeys: readonly string[],
): boolean {
  return (
    principalKind === "service" || principalKind === "agent" || roleKeys.includes(authorityRoleKey)
  );
}

function principalHasGraphMemberAccess(
  principalKind: PrincipalKind,
  roleKeys: readonly string[],
): boolean {
  return (
    principalHasAuthorityAccess(principalKind, roleKeys) ||
    roleKeys.includes(graphMemberRoleKey) ||
    roleKeys.includes(ownerRoleKey)
  );
}

function readPrincipalSharedReadAccess(store: GraphStore, principalId: string): boolean {
  return readActivePrincipalCapabilityGrantIds(store, principalId).some((capabilityGrantId) => {
    const grant = readResolvedAuthorizationCapabilityGrant(store, capabilityGrantId);
    return grant !== null && readValidatedActiveShareGrants(store, grant).length > 0;
  });
}

function readWebPrincipalSummary(
  store: GraphStore,
  principalId: string,
  graphId: string,
  policyVersion: number,
): WebPrincipalSummary | null {
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

  const roleKeys = readPrincipalRoleKeys(store, principalId);
  const capabilityGrantIds = readActivePrincipalCapabilityGrantIds(store, principalId);

  return {
    graphId,
    principalId,
    principalKind,
    roleKeys,
    capabilityGrantIds,
    access: {
      authority: principalHasAuthorityAccess(principalKind, roleKeys),
      graphMember: principalHasGraphMemberAccess(principalKind, roleKeys),
      sharedRead: readPrincipalSharedReadAccess(store, principalId),
    },
    capabilityVersion: readPrincipalCapabilityVersion(store, principalId),
    policyVersion,
  };
}

function readSessionPrincipalProjection(
  store: GraphStore,
  principalId: string,
  graphId: string,
  policyVersion: number = webAppPolicyVersion,
): SessionPrincipalProjection | null {
  const summary = readWebPrincipalSummary(store, principalId, graphId, policyVersion);
  if (!summary) return null;

  return {
    summary,
    principalId: summary.principalId,
    principalKind: summary.principalKind,
    roleKeys: summary.roleKeys,
    capabilityGrantIds: summary.capabilityGrantIds,
    capabilityVersion: summary.capabilityVersion,
  };
}

function readProjectionSessionPrincipalProjection(
  store: GraphStore,
  projectionId: string,
  graphId: string,
  policyVersion: number = webAppPolicyVersion,
): SessionPrincipalProjection | null {
  const principalId = getFirstObject(
    store,
    projectionId,
    authSubjectProjectionPrincipalPredicateId,
  );
  return principalId
    ? readSessionPrincipalProjection(store, principalId, graphId, policyVersion)
    : null;
}

function readAuthUserPrincipalIds(
  store: GraphStore,
  graphId: string,
  authUserId: string,
): string[] {
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

function principalNeedsHomeGraphRepair(store: GraphStore, principalId: string): boolean {
  return !store
    .facts(principalId, principalHomeGraphIdPredicateId)
    .some((edge) => typeof edge.o === "string" && edge.o.trim().length > 0);
}

function listPrincipalIdsMissingHomeGraphId(store: GraphStore): string[] {
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

function listAdmissionPolicyIds(store: GraphStore, graphId: string): string[] {
  return uniqueStrings(
    store
      .facts(undefined, admissionPolicyGraphIdPredicateId, graphId)
      .map((edge) => edge.s)
      .filter((policyId) => hasEntityOfType(store, policyId, admissionPolicyTypeId)),
  );
}

function readAdmissionPolicy(store: GraphStore, graphId: string): AdmissionPolicy | null {
  const policyIds = listAdmissionPolicyIds(store, graphId);
  if (policyIds.length === 0) {
    return null;
  }
  if (policyIds.length > 1) {
    throw new WebAppAuthoritySessionPrincipalLookupError(
      409,
      "conflict",
      `Multiple admission policies exist for graph "${graphId}".`,
    );
  }

  const policyId = policyIds[0];
  if (!policyId) {
    throw new WebAppAuthoritySessionPrincipalLookupError(
      404,
      "missing",
      `Admission policy for graph "${graphId}" was not found.`,
    );
  }
  const bootstrapModeId = getFirstObject(store, policyId, admissionPolicyBootstrapModePredicateId);
  const signupPolicyId = getFirstObject(store, policyId, admissionPolicySignupPolicyPredicateId);
  const bootstrapMode =
    bootstrapModeId === firstUserAdmissionBootstrapModeId
      ? "first-user"
      : bootstrapModeId === manualAdmissionBootstrapModeId
        ? "manual"
        : null;
  const signupPolicy =
    signupPolicyId === openAdmissionSignupPolicyId
      ? "open"
      : signupPolicyId === closedAdmissionSignupPolicyId
        ? "closed"
        : null;

  if (!bootstrapMode || !signupPolicy) {
    throw new WebAppAuthoritySessionPrincipalLookupError(
      409,
      "conflict",
      `Admission policy for graph "${graphId}" is missing required enum values.`,
    );
  }

  return defineAdmissionPolicy({
    graphId,
    bootstrapMode,
    signupPolicy,
    allowedEmailDomains: uniqueStrings(
      store
        .facts(policyId, admissionPolicyAllowedEmailDomainPredicateId)
        .map((edge) => edge.o)
        .filter((domain): domain is string => typeof domain === "string"),
    ).sort(),
    firstUserProvisioning: {
      roleKeys: uniqueStrings(
        store
          .facts(policyId, admissionPolicyFirstUserRoleKeyPredicateId)
          .map((edge) => edge.o)
          .filter((roleKey): roleKey is string => typeof roleKey === "string"),
      ).sort(),
    },
    signupProvisioning: {
      roleKeys: uniqueStrings(
        store
          .facts(policyId, admissionPolicySignupRoleKeyPredicateId)
          .map((edge) => edge.o)
          .filter((roleKey): roleKey is string => typeof roleKey === "string"),
      ).sort(),
    },
  });
}

type AdmissionApprovalProjection = {
  readonly approvalId: string;
  readonly email: string;
  readonly roleKeys: readonly string[];
};

function normalizeAdmissionEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new WebAppAuthorityMutationError(400, "Admission approval email must not be blank.");
  }
  return normalized;
}

function normalizeRoleKeys(
  roleKeys: readonly string[] | undefined,
  options: {
    readonly fallback?: readonly string[];
    readonly requireNonEmpty?: boolean;
  } = {},
): readonly string[] {
  const normalized = uniqueStrings(
    (roleKeys ?? options.fallback ?? [])
      .map((roleKey) => roleKey.trim())
      .filter((roleKey) => roleKey.length > 0),
  ).sort();

  if (options.requireNonEmpty && normalized.length === 0) {
    throw new WebAppAuthorityMutationError(400, "Admission approval role keys must not be empty.");
  }

  return normalized;
}

function listAdmissionApprovalIds(store: GraphStore, graphId: string, email: string): string[] {
  return uniqueStrings(
    store
      .facts(undefined, admissionApprovalGraphIdPredicateId, graphId)
      .map((edge) => edge.s)
      .filter(
        (approvalId) =>
          hasEntityOfType(store, approvalId, admissionApprovalTypeId) &&
          getFirstObject(store, approvalId, admissionApprovalEmailPredicateId) === email,
      ),
  );
}

function readActiveAdmissionApproval(
  store: GraphStore,
  graphId: string,
  email: string | undefined,
): AdmissionApprovalProjection | null {
  if (!email) {
    return null;
  }

  const approvalIds = listAdmissionApprovalIds(
    store,
    graphId,
    normalizeAdmissionEmail(email),
  ).filter(
    (approvalId) =>
      getFirstObject(store, approvalId, admissionApprovalStatusPredicateId) ===
      activeAdmissionApprovalStatusId,
  );

  if (approvalIds.length === 0) {
    return null;
  }
  if (approvalIds.length > 1) {
    throw new WebAppAuthoritySessionPrincipalLookupError(
      409,
      "conflict",
      `Multiple admission approvals exist for email "${email}" in graph "${graphId}".`,
    );
  }

  const approvalId = approvalIds[0];
  if (!approvalId) {
    return null;
  }

  return {
    approvalId,
    email: normalizeAdmissionEmail(email),
    roleKeys: uniqueStrings(
      store
        .facts(approvalId, admissionApprovalRoleKeyPredicateId)
        .map((edge) => edge.o)
        .filter((roleKey): roleKey is string => typeof roleKey === "string"),
    ).sort(),
  };
}

function countActiveAuthorityPrincipals(store: GraphStore, graphId: string): number {
  return uniqueStrings(
    store
      .facts(undefined, principalRoleBindingRoleKeyPredicateId, authorityRoleKey)
      .map((edge) => edge.s)
      .filter(
        (bindingId) =>
          hasEntityOfType(store, bindingId, principalRoleBindingTypeId) &&
          getFirstObject(store, bindingId, principalRoleBindingStatusPredicateId) ===
            activePrincipalRoleBindingStatusId,
      )
      .map((bindingId) =>
        getFirstObject(store, bindingId, principalRoleBindingPrincipalPredicateId),
      )
      .filter(
        (principalId): principalId is string =>
          typeof principalId === "string" &&
          readSessionPrincipalProjection(store, principalId, graphId) !== null,
      ),
  ).length;
}

function countAdmittedHumanPrincipals(store: GraphStore, graphId: string): number {
  return uniqueStrings(
    store
      .facts(undefined, typePredicateId, principalTypeId)
      .map((edge) => edge.s)
      .filter(
        (principalId) =>
          readSessionPrincipalProjection(store, principalId, graphId)?.principalKind === "human",
      ),
  ).length;
}

function readEmailDomain(email: string | undefined): string | null {
  if (!email) return null;

  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) {
    return null;
  }

  return email.slice(atIndex + 1).toLowerCase();
}

function resolveAdmissionRoleKeys(
  store: GraphStore,
  input: SessionPrincipalLookupInput,
): readonly string[] {
  const approval = readActiveAdmissionApproval(store, input.graphId, input.email);
  if (approval) {
    return approval.roleKeys;
  }

  const policy = readAdmissionPolicy(store, input.graphId);
  if (!policy) {
    return [];
  }

  if (
    policy.bootstrapMode === "first-user" &&
    countAdmittedHumanPrincipals(store, input.graphId) === 0
  ) {
    return policy.firstUserProvisioning.roleKeys;
  }

  if (policy.signupPolicy === "open") {
    if (policy.allowedEmailDomains.length === 0) {
      return policy.signupProvisioning.roleKeys;
    }

    const emailDomain = readEmailDomain(input.email);
    if (emailDomain && policy.allowedEmailDomains.includes(emailDomain)) {
      return policy.signupProvisioning.roleKeys;
    }
  }

  throw new WebAppAuthoritySessionPrincipalLookupError(
    403,
    "denied",
    `Admission policy denied first authenticated use for subject "${authSubjectLookupLabel(input.subject)}" in graph "${input.graphId}".`,
  );
}

function resolveInitialRoleBindingRoleKeys(
  store: GraphStore,
  input: SessionPrincipalLookupInput,
  principalId: string,
): readonly string[] {
  const existingRoleKeys = new Set(readPrincipalRoleKeys(store, principalId));
  const approval = readActiveAdmissionApproval(store, input.graphId, input.email);
  if (approval) {
    return approval.roleKeys.filter((roleKey) => !existingRoleKeys.has(roleKey));
  }

  const policy = readAdmissionPolicy(store, input.graphId);
  if (!policy) {
    return [];
  }

  if (
    policy.bootstrapMode === "first-user" &&
    countAdmittedHumanPrincipals(store, input.graphId) === 1 &&
    existingRoleKeys.size === 0
  ) {
    return policy.firstUserProvisioning.roleKeys;
  }

  if (policy.signupPolicy === "open") {
    if (policy.allowedEmailDomains.length === 0) {
      return policy.signupProvisioning.roleKeys.filter((roleKey) => !existingRoleKeys.has(roleKey));
    }

    const emailDomain = readEmailDomain(input.email);
    if (emailDomain && policy.allowedEmailDomains.includes(emailDomain)) {
      return policy.signupProvisioning.roleKeys.filter((roleKey) => !existingRoleKeys.has(roleKey));
    }
  }

  throw new WebAppAuthoritySessionPrincipalLookupError(
    403,
    "denied",
    `Initial role binding denied for subject "${authSubjectLookupLabel(input.subject)}" in graph "${input.graphId}".`,
  );
}

function ensurePrincipalRoleBindings(
  mutationGraph: GraphClient<WebAppGraph>,
  mutationStore: GraphStore,
  principalId: string,
  roleKeys: readonly string[],
): void {
  const existingRoleKeys = new Set(readPrincipalRoleKeys(mutationStore, principalId));
  for (const roleKey of uniqueStrings(roleKeys).sort()) {
    if (existingRoleKeys.has(roleKey)) {
      continue;
    }
    mutationGraph.principalRoleBinding.create({
      name: `${roleKey} for ${principalId}`,
      principal: principalId,
      roleKey,
      status: activePrincipalRoleBindingStatusId,
    });
    existingRoleKeys.add(roleKey);
  }
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
  store: GraphStore,
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
  store: GraphStore,
  principalRoleBindingId: string,
): readonly string[] {
  return uniqueStrings([
    getFirstObject(store, principalRoleBindingId, principalRoleBindingPrincipalPredicateId),
  ]);
}

function resolveCapabilityGrantPrincipalIds(
  store: GraphStore,
  capabilityGrantId: string,
): readonly string[] {
  return uniqueStrings([readCapabilityGrantTargetPrincipalId(store, capabilityGrantId)]);
}

function resolveShareGrantPrincipalIds(store: GraphStore, shareGrantId: string): readonly string[] {
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

function readShareGrantCapabilityGrantId(
  store: GraphStore,
  shareGrantId: string,
): string | undefined {
  return getFirstObject(store, shareGrantId, shareGrantCapabilityGrantPredicateId);
}

function resolveCapabilityVersionAffectedPrincipalIds(
  beforeStore: GraphStore,
  afterStore: GraphStore,
  transaction: GraphWriteTransaction,
  snapshot: GraphStoreSnapshot,
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
  snapshot: GraphStoreSnapshot,
  transaction: GraphWriteTransaction,
): GraphWriteTransaction {
  if (transaction.ops.length === 0) {
    return transaction;
  }

  const beforeStore = createStore(snapshot);
  const afterStore = createStore(snapshot);
  for (const operation of transaction.ops) {
    if (operation.op === "retract") {
      afterStore.retract(operation.edgeId);
      continue;
    }

    afterStore.assertEdge(operation.edge);
  }

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
      for (const operation of filteredTransaction.ops) {
        if (operation.op === "retract") {
          mutationStore.retract(operation.edgeId);
          continue;
        }

        mutationStore.assertEdge(operation.edge);
      }

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
  snapshot: GraphStoreSnapshot,
  txId: string,
  mutate: (graph: GraphClient<WebAppGraph>, store: GraphStore) => TResult,
): {
  readonly changed: boolean;
  readonly result: TResult;
  readonly transaction: GraphWriteTransaction;
} {
  return planRecordedMutation(snapshot, webAppGraph, txId, mutate);
}

function createTransactionEdgeIndex(
  snapshot: GraphStoreSnapshot,
): ReadonlyMap<string, GraphStoreSnapshot["edges"][number]> {
  return new Map(snapshot.edges.map((edge) => [edge.id, edge]));
}

function resolveOperationTarget(
  operation: GraphWriteTransaction["ops"][number],
  edgeById: ReadonlyMap<string, GraphStoreSnapshot["edges"][number]>,
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
  snapshot: GraphStoreSnapshot,
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
  store: GraphStore,
  snapshot: GraphStoreSnapshot,
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
    authorization.principalKind !== null &&
    principalHasAuthorityAccess(authorization.principalKind, authorization.roleKeys)
  );
}

function subjectIsHiddenIdentityEntity(store: GraphStore, subjectId: string): boolean {
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
  store: GraphStore,
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
  store: GraphStore,
  authorization: AuthorizationContext,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
  authorityPolicyVersion: number = webAppPolicyVersion,
): ReplicationReadAuthorizer {
  const staleContextError = assertCurrentAuthorizationVersion(
    store,
    authorization,
    authorityPolicyVersion,
  );
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
  store: GraphStore,
  snapshot: GraphStoreSnapshot,
  authorization: AuthorizationContext,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
): GraphStoreSnapshot {
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

function listWorkflowProjectionSubjectIds(store: GraphStore): string[] {
  const subjectIds = new Set<string>();
  for (const edge of store.snapshot().edges) {
    if (edge.p === typePredicateId && projectionReadEntityTypeIds.has(edge.o)) {
      subjectIds.add(edge.s);
    }
  }

  return [...subjectIds];
}

function assertWorkflowProjectionReadable(
  store: GraphStore,
  authorization: AuthorizationContext,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
  authorityPolicyVersion: number = webAppPolicyVersion,
): void {
  const staleContextError = assertCurrentAuthorizationVersion(
    store,
    authorization,
    authorityPolicyVersion,
  );
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
  snapshot: GraphStoreSnapshot,
  authorization: AuthorizationContext,
  authorityPolicyVersion: number,
  writeScope: GraphWriteScope,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
): void {
  const store = createStore(snapshot);
  const policyVersionError = assertCurrentPolicyVersion(authorization, authorityPolicyVersion);
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

function buildAdmissionApprovalCommandTargets(
  approvalId: string,
  compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>,
) {
  return [
    createAuthorizationTarget(compiledFieldIndex, approvalId, typePredicateId),
    createAuthorizationTarget(compiledFieldIndex, approvalId, createdAtPredicateId),
    createAuthorizationTarget(compiledFieldIndex, approvalId, namePredicateId),
    createAuthorizationTarget(compiledFieldIndex, approvalId, updatedAtPredicateId),
    createAuthorizationTarget(compiledFieldIndex, approvalId, admissionApprovalGraphIdPredicateId),
    createAuthorizationTarget(compiledFieldIndex, approvalId, admissionApprovalEmailPredicateId),
    createAuthorizationTarget(compiledFieldIndex, approvalId, admissionApprovalRoleKeyPredicateId),
    createAuthorizationTarget(compiledFieldIndex, approvalId, admissionApprovalStatusPredicateId),
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

function createAdmissionApprovalCommandPolicy(): GraphCommandPolicy {
  return {
    touchesPredicates: [
      typePredicateId,
      createdAtPredicateId,
      namePredicateId,
      updatedAtPredicateId,
      admissionApprovalGraphIdPredicateId,
      admissionApprovalEmailPredicateId,
      admissionApprovalRoleKeyPredicateId,
      admissionApprovalStatusPredicateId,
    ].map((predicateId) => ({ predicateId })),
  };
}

function assertCommandAuthorized(input: {
  readonly authorization: AuthorizationContext;
  readonly store: GraphStore;
  readonly authorityPolicyVersion?: number;
  readonly commandKey: string;
  readonly commandPolicy: GraphCommandPolicy;
  readonly touchedPredicates: readonly AuthorizationDecisionTarget[];
  readonly writeScope: GraphWriteScope;
}): void {
  const staleContextError = assertCurrentAuthorizationVersion(
    input.store,
    input.authorization,
    input.authorityPolicyVersion ?? webAppPolicyVersion,
  );
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
  readonly writeScope: GraphWriteScope;
  readonly commit: (writeScope: GraphWriteScope) => Promise<void>;
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
  retainedWorkflowProjectionRef: { current: RetainedWorkflowProjectionState | null },
  preloadedPersistedState: PersistedAuthoritativeGraphStorageLoadResult | null,
  preloadedRetainedDocuments: RetainedDocumentState | null,
): PersistedAuthoritativeGraphStorage {
  // This adapter is the explicit boundary between the stable graph/runtime
  // persisted-authority contract and web-only secret side storage.
  let preloadedLoadUsed = false;
  const carriedRetainedRecordsRef = {
    current: (() => {
      const nextRecords = [
        ...filterNonDocumentRetainedRecords(preloadedPersistedState?.retainedRecords),
        ...(preloadedRetainedDocuments
          ? createPersistedRetainedDocumentRecords(preloadedRetainedDocuments)
          : []),
      ];

      return nextRecords.length > 0 ? clonePersistedValue(nextRecords) : null;
    })() as readonly PersistedAuthoritativeGraphRetainedRecord[] | null,
  };
  const preservePreloadedRetainedDocumentsRef = {
    current: preloadedRetainedDocuments !== null,
  };

  function buildPersistedRetainedRecords(
    snapshot: GraphStoreSnapshot,
  ): readonly PersistedAuthoritativeGraphRetainedRecord[] | undefined {
    const snapshotRetainedDocuments = buildRetainedDocumentState(snapshot);
    const carriedRetainedRecords = carriedRetainedRecordsRef.current;

    if (
      preservePreloadedRetainedDocumentsRef.current &&
      preloadedRetainedDocuments &&
      !sameRetainedDocumentState(snapshotRetainedDocuments, preloadedRetainedDocuments)
    ) {
      return carriedRetainedRecords ? clonePersistedValue(carriedRetainedRecords) : undefined;
    }

    preservePreloadedRetainedDocumentsRef.current = false;

    const nextRecords = [
      ...filterNonDocumentRetainedRecords(carriedRetainedRecords),
      ...createPersistedRetainedDocumentRecords(
        hasRetainedDocumentState(snapshotRetainedDocuments)
          ? snapshotRetainedDocuments
          : {
              documents: [],
              blocks: [],
            },
      ),
    ];

    carriedRetainedRecordsRef.current =
      nextRecords.length > 0 ? clonePersistedValue(nextRecords) : null;
    return nextRecords.length > 0 ? nextRecords : undefined;
  }

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
          retainedRecords: carriedRetainedRecordsRef.current
            ? clonePersistedValue(carriedRetainedRecordsRef.current)
            : undefined,
          recovery: persistedState.recovery,
          startupDiagnostics: clonePersistedValue(persistedState.startupDiagnostics),
        };
      }

      const persistedState = await storage.load();
      if (!persistedState) return null;

      return {
        snapshot: clonePersistedValue(persistedState.snapshot),
        writeHistory: persistedState.writeHistory
          ? clonePersistedValue(persistedState.writeHistory)
          : undefined,
        retainedRecords: persistedState.retainedRecords
          ? clonePersistedValue(persistedState.retainedRecords)
          : undefined,
        recovery: persistedState.recovery,
        startupDiagnostics: clonePersistedValue(persistedState.startupDiagnostics),
      };
    },
    async commit(input): Promise<void> {
      const secretWrite = pendingSecretWriteRef.current
        ? clonePersistedValue(pendingSecretWriteRef.current)
        : undefined;
      const retainedRecords = buildPersistedRetainedRecords(input.snapshot);
      const projection = buildRetainedWorkflowProjectionState(
        input.snapshot,
        headCursor(input.writeHistory),
      );

      try {
        await storage.commit(
          clonePersistedValue({
            ...input,
            ...(retainedRecords ? { retainedRecords } : {}),
          }),
          {
            ...(secretWrite ? { secretWrite } : {}),
            projection,
          },
        );
        retainedWorkflowProjectionRef.current = clonePersistedValue(projection);
      } finally {
        pendingSecretWriteRef.current = null;
      }
    },
    async persist(input): Promise<void> {
      const retainedRecords = buildPersistedRetainedRecords(input.snapshot);
      const projection = buildRetainedWorkflowProjectionState(
        input.snapshot,
        headCursor(input.writeHistory),
      );
      await storage.persist(
        clonePersistedValue({
          ...input,
          ...(retainedRecords ? { retainedRecords } : {}),
        }),
        {
          projection,
        },
      );
      retainedWorkflowProjectionRef.current = clonePersistedValue(projection);
    },
  };
}

export async function createWebAppAuthority(
  storage: WebAppAuthorityStorage,
  options: WebAppAuthorityOptions = {},
): Promise<WebAppAuthority> {
  const authorityPolicyVersion = options.policyVersion ?? webAppPolicyVersion;
  const graph = options.graph ?? webAppGraph;
  const { bootstrappedSnapshot, compiledFieldIndex, scalarByKey, typeByKey } =
    getCompiledGraphArtifacts(graph);
  const loadedPersistedState = await storage.load();
  const persistedState = loadedPersistedState
    ? {
        ...loadedPersistedState,
        snapshot: mergeSnapshotWithBootstrappedSchema(
          bootstrappedSnapshot,
          loadedPersistedState.snapshot,
        ),
      }
    : null;
  const persistedRetainedDocuments =
    persistedState?.retainedRecords && persistedState.retainedRecords.length > 0
      ? loadRetainedDocumentStateFromPersistedRecords(persistedState.retainedRecords)
      : null;
  const persistedWorkflowProjection = persistedState
    ? await storage.loadWorkflowProjection()
    : null;
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
  const retainedWorkflowProjectionRef = {
    current: persistedWorkflowProjection
      ? clonePersistedValue(persistedWorkflowProjection)
      : (null as RetainedWorkflowProjectionState | null),
  };
  const authority = await createPersistedAuthoritativeGraph(store, graph, {
    storage: createAuthorityStorage(
      storage,
      pendingSecretWriteRef,
      retainedWorkflowProjectionRef,
      persistedState,
      persistedRetainedDocuments?.state ?? null,
    ),
    seed() {
      if (options.seedExampleGraph !== false) {
        seedExampleGraph(createGraphClient(store, webAppGraph));
      }
    },
    createCursorPrefix: createAuthorityCursorPrefix,
    retainedHistoryPolicy: options.retainedHistoryPolicy,
  });
  if (options.seedExampleGraph !== false) {
    const seeded = planAuthorityMutation(
      authority.store.snapshot(),
      `seed:example-graph-backfill:${Date.now()}`,
      (mutationGraph) => seedExampleGraph(mutationGraph),
    );
    if (seeded.changed) {
      await authority.applyTransaction(seeded.transaction, {
        writeScope: "server-command",
      });
    }
  }
  const workflowReviewInvalidationListener = options.onWorkflowReviewInvalidation;
  // Early persisted Better Auth rollouts could create graph principals without
  // `homeGraphId`. Repair them before any sync or direct graph reads materialize
  // those entities through the typed client.
  await repairLegacyPrincipalHomeGraphIds(authority);

  async function replaceRetainedDocuments(retainedDocuments: RetainedDocumentState): Promise<void> {
    await storage.replaceRetainedDocuments(clonePersistedValue(retainedDocuments));
  }

  const authoritativeRetainedDocuments = buildRetainedDocumentState(authority.store.snapshot());
  if (!persistedRetainedDocuments) {
    if (hasRetainedDocumentState(authoritativeRetainedDocuments)) {
      await replaceRetainedDocuments(authoritativeRetainedDocuments);
    }
  } else {
    const recoveredDocuments = planRetainedDocumentRecovery(
      authority.store.snapshot(),
      persistedRetainedDocuments.state,
      `recover:retained-documents:${Date.now()}`,
    );
    if (recoveredDocuments.changed) {
      await authority.applyTransaction(recoveredDocuments.transaction, {
        writeScope: "authority-only",
      });
    } else if (
      persistedRetainedDocuments.repairReasons.length > 0 ||
      !sameRetainedDocumentState(authoritativeRetainedDocuments, persistedRetainedDocuments.state)
    ) {
      await replaceRetainedDocuments(persistedRetainedDocuments.state);
    }
  }

  async function replaceRetainedWorkflowProjection(
    projection: RetainedWorkflowProjectionState,
  ): Promise<void> {
    await storage.replaceWorkflowProjection(clonePersistedValue(projection));
    retainedWorkflowProjectionRef.current = clonePersistedValue(projection);
  }

  async function rebuildRetainedWorkflowProjection(): Promise<void> {
    const projection = buildRetainedWorkflowProjectionState(
      authority.store.snapshot(),
      authority.createTotalSyncPayload().cursor,
    );
    await replaceRetainedWorkflowProjection(projection);
  }

  const recoveredWorkflowProjection = buildRetainedWorkflowProjectionState(
    authority.store.snapshot(),
    authority.createTotalSyncPayload().cursor,
  );
  if (
    classifyRetainedWorkflowProjectionRecovery(
      retainedWorkflowProjectionRef.current,
      recoveredWorkflowProjection,
    )
  ) {
    await replaceRetainedWorkflowProjection(recoveredWorkflowProjection);
  }

  function readSnapshot(options: WebAppAuthorityReadOptions): GraphStoreSnapshot {
    return filterReadableSnapshot(
      authority.store,
      authority.store.snapshot(),
      options.authorization,
      compiledFieldIndex,
    );
  }

  function requireSavedQueryOwnerId(options: WebAppAuthorityReadOptions): string {
    const staleContextError = assertCurrentAuthorizationVersion(
      authority.store,
      options.authorization,
      authorityPolicyVersion,
    );
    if (staleContextError) {
      throw createReadPolicyError(staleContextError);
    }
    if (!options.authorization.principalId) {
      throw new WebAppAuthorityReadError(401, "Saved queries require an identified principal.", {
        code: "auth.unauthenticated",
      });
    }
    return options.authorization.principalId;
  }

  function createSavedQueryExecutionContext(
    executionContext: QueryIdentityExecutionContext | undefined,
    authorization: AuthorizationContext,
  ): QueryIdentityExecutionContext {
    return {
      ...executionContext,
      ...(authorization.principalId ? { principalId: authorization.principalId } : {}),
      policyFilterVersion: createPolicyFilterVersion(authorityPolicyVersion),
    };
  }

  function createSavedQueryRepository(ownerId: string, store: GraphStore = authority.store) {
    return createGraphBackedSavedQueryRepository(createGraphClient(store, graph), ownerId);
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
      authorityPolicyVersion,
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

  function createReadableQueryStore(options: WebAppAuthorityReadOptions): GraphStore {
    return createStore(readSnapshot(options));
  }

  function buildEntityQueryItem(store: GraphStore, subjectId: string): QueryResultItem {
    const predicateIds = [...new Set(store.facts(subjectId).map((edge) => edge.p))].sort();
    const payload: Record<string, unknown> = {};

    for (const predicateId of predicateIds) {
      const fieldDefinition = compiledFieldIndex.get(predicateId);
      if (!fieldDefinition) {
        continue;
      }
      const value = decodePredicateValue(
        store,
        subjectId,
        fieldDefinition.field,
        scalarByKey,
        typeByKey,
      );
      if (value !== undefined) {
        payload[predicateId] = value;
      }
    }

    return {
      key: subjectId,
      entityId: subjectId,
      payload,
    };
  }

  function executeEntitySerializedQuery(
    query: Extract<NormalizedQueryRequest["query"], { readonly kind: "entity" }>,
    options: WebAppAuthorityReadOptions,
  ): QueryResultPage {
    const store = createReadableQueryStore(options);
    return {
      kind: "entity",
      items: [buildEntityQueryItem(store, query.entityId)],
      freshness: {
        completeness: "complete",
        freshness: "current",
      },
    };
  }

  function executeNeighborhoodSerializedQuery(
    query: Extract<NormalizedQueryRequest["query"], { readonly kind: "neighborhood" }>,
    options: WebAppAuthorityReadOptions,
  ): QueryResultPage {
    const snapshot = readSnapshot(options);
    const store = createStore(snapshot);
    const subjectIds = new Set(snapshot.edges.map((edge) => edge.s));
    const traversablePredicates = query.predicateIds ? new Set(query.predicateIds) : undefined;
    const maxDepth = query.depth ?? 1;
    const visited = new Set([query.rootId]);
    const orderedSubjectIds = [query.rootId];
    const queue = [{ subjectId: query.rootId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.depth >= maxDepth) {
        continue;
      }

      for (const edge of store.facts(current.subjectId)) {
        if (traversablePredicates && !traversablePredicates.has(edge.p)) {
          continue;
        }
        if (!subjectIds.has(edge.o) || visited.has(edge.o)) {
          continue;
        }
        visited.add(edge.o);
        orderedSubjectIds.push(edge.o);
        queue.push({
          subjectId: edge.o,
          depth: current.depth + 1,
        });
      }
    }

    return {
      kind: "neighborhood",
      items: orderedSubjectIds.map((subjectId) => buildEntityQueryItem(store, subjectId)),
      freshness: {
        completeness: "complete",
        freshness: "current",
      },
    };
  }

  const serializedQueryPageCursorPrefix = "serialized-query:";

  type SerializedQueryPageCursor = {
    readonly version: 1;
    readonly identityHash: string;
    readonly cursor: string;
  };

  function encodeSerializedQueryPageCursor(cursor: SerializedQueryPageCursor): string {
    return `${serializedQueryPageCursorPrefix}${Buffer.from(
      JSON.stringify(cursor),
      "utf8",
    ).toString("base64url")}`;
  }

  function decodeSerializedQueryPageCursor(cursor: string, identityHash: string): string {
    const encoded = cursor.startsWith(serializedQueryPageCursorPrefix)
      ? cursor.slice(serializedQueryPageCursorPrefix.length)
      : "";
    if (!encoded) {
      throw new StaleSerializedQueryCursorError(cursor);
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<SerializedQueryPageCursor>;
      if (
        parsed.version !== 1 ||
        typeof parsed.identityHash !== "string" ||
        parsed.identityHash !== identityHash ||
        typeof parsed.cursor !== "string" ||
        parsed.cursor.length === 0
      ) {
        throw new Error("stale");
      }
      return parsed.cursor;
    } catch {
      throw new StaleSerializedQueryCursorError(cursor);
    }
  }

  function resolveSerializedQueryPageCursor(
    pageCursor: string | undefined,
    identityHash: string,
  ): string | undefined {
    if (!pageCursor) {
      return undefined;
    }
    return decodeSerializedQueryPageCursor(pageCursor, identityHash);
  }

  function bindSerializedQueryPageCursor(
    page: QueryResultPage,
    identityHash: string,
  ): QueryResultPage {
    if (!page.nextCursor) {
      return page;
    }

    return {
      ...page,
      nextCursor: encodeSerializedQueryPageCursor({
        version: 1,
        identityHash,
        cursor: page.nextCursor,
      }),
    };
  }

  const serializedQueryExecutorRegistry = createWebAppSerializedQueryExecutorRegistry({
    executeModuleScopeQuery({ options, surface }) {
      const payload = createTotalSyncPayload({
        authorization: options.authorization,
        scope: {
          kind: "module",
          moduleId: surface.moduleId,
          scopeId: surface.source.scopeId,
        },
      });
      const store = createStore(payload.snapshot);
      const subjectIds = [...new Set(payload.snapshot.edges.map((edge) => edge.s))].sort();

      return {
        kind: "scope",
        items: subjectIds.map((subjectId) => buildEntityQueryItem(store, subjectId)),
        freshness: {
          completeness: payload.completeness,
          freshness: payload.freshness,
          scopeCursor: payload.cursor,
        },
      };
    },
    readCommitQueueScope,
    readProjectBranchScope,
    unsupported(message) {
      return new UnsupportedSerializedQueryPlanError(message);
    },
  });

  function executeCollectionSerializedQuery(
    query: Extract<NormalizedQueryRequest["query"], { readonly kind: "collection" }>,
    normalizedRequest: NormalizedQueryRequest,
    options: WebAppAuthorityReadOptions,
  ): QueryResultPage {
    const pageCursor = resolveSerializedQueryPageCursor(
      normalizedRequest.metadata.pageCursor,
      normalizedRequest.metadata.identityHash,
    );
    const resolution = resolveSerializedQueryCollectionExecutor(
      serializedQueryExecutorRegistry,
      query,
    );
    if (!resolution.ok) {
      switch (resolution.code) {
        case "unregistered-surface":
          throw new UnsupportedSerializedQueryPlanError(
            `Collection query "${query.indexId}" is not a registered serialized-query surface.`,
          );
        case "missing-executor":
          throw new UnsupportedSerializedQueryPlanError(
            `Collection query "${resolution.surface.surfaceId}" does not have a registered serialized-query executor.`,
          );
        case "stale-executor":
          throw new UnsupportedSerializedQueryPlanError(
            `Collection query "${resolution.surface.surfaceId}" requires serialized-query executor version "${resolution.surface.surfaceVersion}", but the registered executor reports "${resolution.executor.surfaceVersion}".`,
          );
      }
    }

    return bindSerializedQueryPageCursor(
      resolution.executor.execute({
        normalizedRequest: {
          ...normalizedRequest,
          query,
        },
        options,
        pageCursor,
        surface: resolution.surface,
      }),
      normalizedRequest.metadata.identityHash,
    );
  }

  function executeScopeSerializedQuery(
    query: Extract<NormalizedQueryRequest["query"], { readonly kind: "scope" }>,
    normalizedRequest: NormalizedQueryRequest,
    options: WebAppAuthorityReadOptions,
  ): QueryResultPage {
    const resolution = resolveSerializedQueryScopeExecutor(serializedQueryExecutorRegistry, query);
    if (!resolution.ok) {
      switch (resolution.code) {
        case "unregistered-surface":
          throw new UnsupportedSerializedQueryPlanError(
            `Scope query "${query.scopeId ?? "inline"}" is not a registered serialized-query surface.`,
          );
        case "missing-executor":
          throw new UnsupportedSerializedQueryPlanError(
            `Scope query "${resolution.surface.surfaceId}" does not have a registered serialized-query executor.`,
          );
        case "stale-executor":
          throw new UnsupportedSerializedQueryPlanError(
            `Scope query "${resolution.surface.surfaceId}" requires serialized-query executor version "${resolution.surface.surfaceVersion}", but the registered executor reports "${resolution.executor.surfaceVersion}".`,
          );
        case "ambiguous-surface":
          throw new UnsupportedSerializedQueryPlanError(
            `Scope query "${query.scopeId ?? "inline"}" matches multiple registered serialized-query surfaces: ${resolution.surfaces
              .map((surface) => `"${surface.surfaceId}"`)
              .join(", ")}.`,
          );
      }
    }

    return resolution.executor.execute({
      normalizedRequest: {
        ...normalizedRequest,
        query,
      },
      options,
      surface: resolution.surface,
    });
  }

  function executeNormalizedSerializedQuery(
    normalizedRequest: NormalizedQueryRequest,
    options: WebAppAuthorityReadOptions,
  ): QueryResultPage {
    switch (normalizedRequest.query.kind) {
      case "entity":
        return executeEntitySerializedQuery(normalizedRequest.query, options);
      case "neighborhood":
        return executeNeighborhoodSerializedQuery(normalizedRequest.query, options);
      case "collection":
        return executeCollectionSerializedQuery(
          normalizedRequest.query,
          normalizedRequest,
          options,
        );
      case "scope":
        return executeScopeSerializedQuery(normalizedRequest.query, normalizedRequest, options);
    }

    throw new UnsupportedSerializedQueryPlanError("Serialized query kind is not supported.");
  }

  function createSavedQueryConflict(message: string): WebAppAuthorityReadError {
    return new WebAppAuthorityReadError(409, message);
  }

  function coerceSavedQueryConflict(error: unknown): WebAppAuthorityReadError | undefined {
    if (!(error instanceof Error)) {
      return undefined;
    }
    const name = (error as { name?: string }).name;
    if (name === "SavedQueryDefinitionError" || name === "SavedQuerySaveError") {
      return createSavedQueryConflict(error.message);
    }
    return undefined;
  }

  async function listSavedQueries(
    options: WebAppAuthorityReadOptions,
  ): Promise<readonly SavedQueryRecord[]> {
    const ownerId = requireSavedQueryOwnerId(options);
    const queries = await createSavedQueryRepository(ownerId).listSavedQueries();
    return queries.map(deriveSavedQueryRecord);
  }

  async function listSavedViews(
    options: WebAppAuthorityReadOptions,
  ): Promise<readonly SavedViewRecord[]> {
    const ownerId = requireSavedQueryOwnerId(options);
    const repository = createSavedQueryRepository(ownerId);
    const views = await repository.listSavedViews();
    const records = await Promise.all(
      views.map(async (view) => {
        const query = await repository.getSavedQuery(view.queryId);
        return query ? deriveSavedViewRecord({ query, view }) : undefined;
      }),
    );
    return records.filter((record): record is SavedViewRecord => record !== undefined);
  }

  async function getSavedQuery(
    id: string,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedQueryRecord | undefined> {
    const ownerId = requireSavedQueryOwnerId(options);
    const query = await createSavedQueryRepository(ownerId).getSavedQuery(id);
    return query ? deriveSavedQueryRecord(query) : undefined;
  }

  async function getSavedView(
    id: string,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedViewRecord | undefined> {
    const ownerId = requireSavedQueryOwnerId(options);
    const repository = createSavedQueryRepository(ownerId);
    const view = await repository.getSavedView(id);
    if (!view) {
      return undefined;
    }
    const query = await repository.getSavedQuery(view.queryId);
    return query ? deriveSavedViewRecord({ query, view }) : undefined;
  }

  async function deleteSavedQuery(id: string, options: WebAppAuthorityReadOptions): Promise<void> {
    const ownerId = requireSavedQueryOwnerId(options);
    const planned = await planRecordedMutationAsync(
      authority.store.snapshot(),
      graph,
      `delete:saved-query:${id}:${Date.now()}`,
      async (mutationGraph) => {
        await createGraphBackedSavedQueryRepository(mutationGraph, ownerId).deleteSavedQuery(id);
      },
    );
    if (planned.changed) {
      await authority.applyTransaction(planned.transaction, {
        writeScope: "authority-only",
      });
    }
  }

  async function deleteSavedView(id: string, options: WebAppAuthorityReadOptions): Promise<void> {
    const ownerId = requireSavedQueryOwnerId(options);
    const planned = await planRecordedMutationAsync(
      authority.store.snapshot(),
      graph,
      `delete:saved-view:${id}:${Date.now()}`,
      async (mutationGraph) => {
        await createGraphBackedSavedQueryRepository(mutationGraph, ownerId).deleteSavedView(id);
      },
    );
    if (planned.changed) {
      await authority.applyTransaction(planned.transaction, {
        writeScope: "authority-only",
      });
    }
  }

  async function saveSavedQuery(
    input: WebAppAuthoritySavedQueryUpsertInput,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedQueryRecord> {
    const ownerId = requireSavedQueryOwnerId(options);
    const compatibility = validateSavedQueryCompatibility(
      {
        ...input,
        id: input.id ?? "pending",
        updatedAt: new Date(0).toISOString(),
      },
      installedModuleQueryEditorCatalog,
    );
    if (!compatibility.ok) {
      throw createSavedQueryConflict(compatibility.message);
    }
    const installedSurface = getInstalledModuleQuerySurface(
      installedModuleQuerySurfaceRegistry,
      input.surfaceId,
    );
    if (!installedSurface?.moduleId) {
      throw createSavedQueryConflict(
        `Saved query "${input.id ?? (input.name.trim() || "Untitled query")}" references removed query surface "${input.surfaceId}".`,
      );
    }
    try {
      const planned = await planRecordedMutationAsync(
        authority.store.snapshot(),
        graph,
        `save:saved-query:${ownerId}:${Date.now()}`,
        async (mutationGraph) =>
          createGraphBackedSavedQueryRepository(mutationGraph, ownerId).saveSavedQuery({
            ...(input.id ? { id: input.id } : {}),
            ...toSavedQueryDefinitionInput(input, ownerId, installedSurface.moduleId),
          }),
      );
      if (planned.changed) {
        await authority.applyTransaction(planned.transaction, {
          writeScope: "authority-only",
        });
      }
      return deriveSavedQueryRecord(planned.result);
    } catch (error) {
      throw coerceSavedQueryConflict(error) ?? error;
    }
  }

  async function saveSavedView(
    input: WebAppAuthoritySavedViewUpsertInput,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedViewRecord> {
    const ownerId = requireSavedQueryOwnerId(options);
    const repository = createSavedQueryRepository(ownerId);
    const query = await repository.getSavedQuery(input.queryId);
    if (!query) {
      throw new WebAppAuthorityReadError(
        404,
        `Saved view "${input.id ?? (input.name.trim() || "Untitled view")}" references missing saved query "${input.queryId}".`,
      );
    }
    const compatibility = validateSavedViewCompatibility({
      catalog: installedModuleQueryEditorCatalog,
      query: deriveSavedQueryRecord(query),
      resolveSurfaceCompatibility: getInstalledModuleQuerySurfaceRendererCompatibility,
      view: {
        ...input,
        id: input.id ?? "pending",
        updatedAt: new Date(0).toISOString(),
      },
    });
    if (!compatibility.ok) {
      throw createSavedQueryConflict(compatibility.message);
    }
    try {
      const planned = await planRecordedMutationAsync(
        authority.store.snapshot(),
        graph,
        `save:saved-view:${ownerId}:${Date.now()}`,
        async (mutationGraph) =>
          createGraphBackedSavedQueryRepository(mutationGraph, ownerId).saveSavedView({
            ...(input.id ? { id: input.id } : {}),
            ...toSavedViewDefinitionInput(input, ownerId),
          }),
      );
      if (planned.changed) {
        await authority.applyTransaction(planned.transaction, {
          writeScope: "authority-only",
        });
      }
      return deriveSavedViewRecord({
        query,
        view: planned.result,
      });
    } catch (error) {
      throw coerceSavedQueryConflict(error) ?? error;
    }
  }

  async function resolveSavedQuery(
    input: WebAppAuthoritySavedQueryResolutionInput,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedQueryResolution> {
    const ownerId = requireSavedQueryOwnerId(options);
    const query = await createSavedQueryRepository(ownerId).getSavedQuery(input.queryId);
    if (!query) {
      throw new WebAppAuthorityReadError(
        404,
        `Saved query "${input.queryId}" is no longer available.`,
      );
    }
    try {
      return await resolveSavedQueryDefinition({
        catalog: installedModuleQueryEditorCatalog,
        executionContext: createSavedQueryExecutionContext(
          input.executionContext,
          options.authorization,
        ),
        params: input.params,
        query,
      });
    } catch (error) {
      const code =
        typeof (error as { code?: unknown })?.code === "string"
          ? (error as { code: string }).code
          : undefined;
      if (code === "stale-query" || code === "incompatible-query") {
        throw createSavedQueryConflict((error as Error).message);
      }
      throw error;
    }
  }

  async function resolveSavedView(
    input: WebAppAuthoritySavedViewResolutionInput,
    options: WebAppAuthorityReadOptions,
  ): Promise<SavedViewResolution> {
    const ownerId = requireSavedQueryOwnerId(options);
    const repository = createSavedQueryRepository(ownerId);
    const view = await repository.getSavedView(input.viewId);
    if (!view) {
      throw new WebAppAuthorityReadError(
        404,
        `Saved view "${input.viewId}" is no longer available.`,
      );
    }
    const query = await repository.getSavedQuery(view.queryId);
    if (!query) {
      throw new WebAppAuthorityReadError(
        404,
        `Saved view "${view.id}" references missing saved query "${view.queryId}".`,
      );
    }
    try {
      return await resolveSavedViewDefinition({
        catalog: installedModuleQueryEditorCatalog,
        executionContext: createSavedQueryExecutionContext(
          input.executionContext,
          options.authorization,
        ),
        params: input.params,
        query,
        resolveSurfaceCompatibility: getInstalledModuleQuerySurfaceRendererCompatibility,
        view,
      });
    } catch (error) {
      const code =
        typeof (error as { code?: unknown })?.code === "string"
          ? (error as { code: string }).code
          : undefined;
      if (code === "stale-view" || code === "incompatible-view") {
        throw createSavedQueryConflict((error as Error).message);
      }
      throw error;
    }
  }

  async function executeSerializedQuery(
    request: SerializedQueryRequest,
    options: WebAppAuthorityReadOptions,
  ): Promise<SerializedQueryResponse> {
    try {
      const normalizedRequest = await normalizeSerializedQueryRequest(request, {
        executionContext: {
          ...(options.authorization.principalId
            ? { principalId: options.authorization.principalId }
            : {}),
          policyFilterVersion: createPolicyFilterVersion(authorityPolicyVersion),
        },
      });

      return {
        ok: true,
        result: executeNormalizedSerializedQuery(normalizedRequest, options),
      };
    } catch (error) {
      if (error instanceof SerializedQueryValidationError) {
        return createSerializedQueryErrorResponse(error.message, "invalid-query");
      }
      if (error instanceof UnsupportedSerializedQueryPlanError) {
        return createSerializedQueryErrorResponse(error.message, "unsupported-query");
      }
      if (error instanceof StaleSerializedQueryCursorError) {
        return createSerializedQueryErrorResponse(error.message, "projection-stale");
      }
      if (error instanceof WebAppAuthorityWorkflowReadError) {
        return createSerializedQueryErrorResponse(error.message, error.code);
      }
      if (error instanceof WebAppAuthorityReadError) {
        return createSerializedQueryErrorResponse(error.message, "policy-denied");
      }
      throw error;
    }
  }

  function createAuthorizedWorkflowProjection(authorization: AuthorizationContext) {
    assertWorkflowProjectionReadable(
      authority.store,
      authorization,
      compiledFieldIndex,
      authorityPolicyVersion,
    );
    if (retainedWorkflowProjectionRef.current) {
      try {
        return createWorkflowProjectionIndexFromRetainedState(
          retainedWorkflowProjectionRef.current,
        );
      } catch {
        retainedWorkflowProjectionRef.current = null;
      }
    }

    const projection = buildRetainedWorkflowProjectionState(
      authority.store.snapshot(),
      authority.createTotalSyncPayload().cursor,
    );
    retainedWorkflowProjectionRef.current = clonePersistedValue(projection);
    void replaceRetainedWorkflowProjection(projection).catch(() => {});
    return createWorkflowProjectionIndexFromRetainedState(projection);
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

  function readWorkflowSessionFeed(
    query: WorkflowSessionFeedReadQuery,
    options: WebAppAuthorityReadOptions,
  ): WorkflowSessionFeedReadResult {
    const store = createReadableQueryStore(options);
    const graph = createGraphClient(store, webAppGraph);

    try {
      return readWorkflowSessionFeedResult(graph, store, query);
    } catch (error) {
      if (
        error instanceof WorkflowMutationError &&
        error.code === "subject-not-found" &&
        error.message.includes("project")
      ) {
        throw new WebAppAuthorityWorkflowReadError(404, "project-not-found", error.message);
      }
      if (
        error instanceof WorkflowMutationError &&
        error.code === "subject-not-found" &&
        error.message.includes("branch")
      ) {
        throw new WebAppAuthorityWorkflowReadError(404, "branch-not-found", error.message);
      }
      throw error;
    }
  }

  function planWorkflowReviewLiveRegistration(
    cursor: string,
    options: WebAppAuthorityReadOptions,
  ): WorkflowReviewLiveRegistrationTarget {
    const staleContextError = assertCurrentAuthorizationVersion(
      authority.store,
      options.authorization,
      authorityPolicyVersion,
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

    const plannedScope = planSyncScope(workflowReviewModuleReadScope, authorityPolicyVersion);
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

  function createTotalSyncPayload(options: WebAppAuthoritySyncOptions) {
    const authorizeRead = createReadableReplicationAuthorizer(
      authority.store,
      options.authorization,
      compiledFieldIndex,
      authorityPolicyVersion,
    );
    const plannedScope = planSyncScope(options.scope, authorityPolicyVersion);
    const payload = authority.createTotalSyncPayload({
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
      authorityPolicyVersion,
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
      authorityPolicyVersion,
    );
    const plannedScope = planSyncScope(options.scope, authorityPolicyVersion);
    if (after && plannedScope) {
      const currentPayload = authority.createTotalSyncPayload({
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
    if ("fallbackReason" in result) {
      return createIncrementalSyncFallback(result.fallbackReason, {
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

  function getPolicyVersion(): number {
    return authorityPolicyVersion;
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
        authorityPolicyVersion,
      );
      if (resolved) {
        return resolved;
      }
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

    if (authUserPrincipalIds.length === 0) {
      resolveAdmissionRoleKeys(authority.store, input);
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
      const snapshot = authority.store.snapshot();
      await authority.applyTransaction(
        planCapabilityVersionInvalidationTransaction(snapshot, repaired.transaction),
        {
          writeScope: "authority-only",
        },
      );
    }

    const resolved = readProjectionSessionPrincipalProjection(
      authority.store,
      repaired.result.projectionId,
      input.graphId,
      authorityPolicyVersion,
    );
    if (resolved) return resolved;

    createMissingSessionPrincipalLookupError(input);
  }

  async function activateSessionPrincipalRoleBindings(
    input: SessionPrincipalLookupInput,
  ): Promise<SessionPrincipalProjection> {
    const resolved = await lookupSessionPrincipal(input);
    const missingRoleKeys = resolveInitialRoleBindingRoleKeys(
      authority.store,
      input,
      resolved.principalId,
    );

    if (missingRoleKeys.length === 0) {
      return resolved;
    }

    const planned = planAuthorityMutation(
      authority.store.snapshot(),
      `activate-session-principal-roles:${resolved.principalId}:${Date.now()}`,
      (mutationGraph, mutationStore) => {
        ensurePrincipalRoleBindings(
          mutationGraph,
          mutationStore,
          resolved.principalId,
          missingRoleKeys,
        );
        return resolved.principalId;
      },
    );

    if (planned.changed) {
      const snapshot = authority.store.snapshot();
      await authority.applyTransaction(
        planCapabilityVersionInvalidationTransaction(snapshot, planned.transaction),
        {
          writeScope: "authority-only",
        },
      );
    }

    return (
      readSessionPrincipalProjection(
        authority.store,
        resolved.principalId,
        input.graphId,
        authorityPolicyVersion,
      ) ?? resolved
    );
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
      authorityPolicyVersion,
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

  async function runBootstrapOperatorAccessCommand(
    input: BootstrapOperatorAccessInput,
  ): Promise<BootstrapOperatorAccessResult> {
    const graphId = input.graphId?.trim() || webAppGraphId;
    const email = normalizeAdmissionEmail(input.email);
    const roleKeys = normalizeRoleKeys(input.roleKeys, {
      fallback: defaultBootstrapOperatorRoleKeys,
      requireNonEmpty: true,
    });

    if (!roleKeys.includes(authorityRoleKey)) {
      throw new WebAppAuthorityMutationError(
        400,
        `Bootstrap operator access must include "${authorityRoleKey}".`,
      );
    }
    if (countActiveAuthorityPrincipals(authority.store, graphId) > 0) {
      throw new WebAppAuthorityMutationError(
        409,
        `Bootstrap operator access is unavailable because graph "${graphId}" already has an active operator.`,
      );
    }

    const planned = planAuthorityMutation(
      authority.store.snapshot(),
      `bootstrap-operator-access:${email}:${Date.now()}`,
      (mutationGraph, mutationStore) => {
        const existingPolicyIds = listAdmissionPolicyIds(mutationStore, graphId);
        if (existingPolicyIds.length > 1) {
          throw new WebAppAuthorityMutationError(
            409,
            `Multiple admission policies exist for graph "${graphId}".`,
          );
        }

        const policyId = existingPolicyIds[0]
          ? (mutationGraph.admissionPolicy.update(existingPolicyIds[0], {
              bootstrapMode: manualAdmissionBootstrapModeId,
              signupPolicy: closedAdmissionSignupPolicyId,
              firstUserRoleKey: [],
              signupRoleKey: [],
            }),
            existingPolicyIds[0])
          : mutationGraph.admissionPolicy.create({
              bootstrapMode: manualAdmissionBootstrapModeId,
              firstUserRoleKey: [],
              graphId,
              name: `Admission policy for ${graphId}`,
              signupPolicy: closedAdmissionSignupPolicyId,
              signupRoleKey: [],
            });

        const existingApprovalIds = listAdmissionApprovalIds(mutationStore, graphId, email);
        if (existingApprovalIds.length > 1) {
          throw new WebAppAuthorityMutationError(
            409,
            `Multiple admission approvals exist for email "${email}" in graph "${graphId}".`,
          );
        }

        const approvalId = existingApprovalIds[0]
          ? (mutationGraph.admissionApproval.update(existingApprovalIds[0], {
              email,
              graphId,
              name: `Admission approval for ${email}`,
              roleKey: [...roleKeys],
              status: activeAdmissionApprovalStatusId,
            }),
            existingApprovalIds[0])
          : mutationGraph.admissionApproval.create({
              email,
              graphId,
              name: `Admission approval for ${email}`,
              roleKey: [...roleKeys],
              status: activeAdmissionApprovalStatusId,
            });

        return {
          approvalId,
          created: existingApprovalIds.length === 0,
          email,
          graphId,
          policyId,
          roleKeys,
        } satisfies BootstrapOperatorAccessResult;
      },
    );

    return applyStagedWebAuthorityMutation({
      changed: planned.changed,
      result: planned.result,
      writeScope: "authority-only",
      async commit(writeScope) {
        const snapshot = authority.store.snapshot();
        const plannedTransaction = planCapabilityVersionInvalidationTransaction(
          snapshot,
          planned.transaction,
        );
        await authority.applyTransaction(plannedTransaction, {
          writeScope,
        });
      },
    });
  }

  async function runSetAdmissionApprovalCommand(
    input: SetAdmissionApprovalInput,
    options: WebAppAuthorityCommandOptions,
  ): Promise<SetAdmissionApprovalResult> {
    const graphId = input.graphId?.trim() || webAppGraphId;
    const email = normalizeAdmissionEmail(input.email);
    const status = input.status ?? "active";
    const roleKeys =
      status === "active"
        ? normalizeRoleKeys(input.roleKeys, { requireNonEmpty: true })
        : normalizeRoleKeys([], {});

    const planned = planAuthorityMutation(
      authority.store.snapshot(),
      `set-admission-approval:${email}:${Date.now()}`,
      (mutationGraph, mutationStore) => {
        const existingApprovalIds = listAdmissionApprovalIds(mutationStore, graphId, email);
        if (existingApprovalIds.length > 1) {
          throw new WebAppAuthorityMutationError(
            409,
            `Multiple admission approvals exist for email "${email}" in graph "${graphId}".`,
          );
        }

        const nextStatusId =
          status === "active" ? activeAdmissionApprovalStatusId : revokedAdmissionApprovalStatusId;
        const approvalId = existingApprovalIds[0]
          ? (mutationGraph.admissionApproval.update(existingApprovalIds[0], {
              email,
              graphId,
              name: `Admission approval for ${email}`,
              roleKey: [...roleKeys],
              status: nextStatusId,
            }),
            existingApprovalIds[0])
          : mutationGraph.admissionApproval.create({
              email,
              graphId,
              name: `Admission approval for ${email}`,
              roleKey: [...roleKeys],
              status: nextStatusId,
            });

        return {
          approvalId,
          created: existingApprovalIds.length === 0,
          email,
          graphId,
          roleKeys,
          status,
        } satisfies SetAdmissionApprovalResult;
      },
    );

    assertCommandAuthorized({
      authorization: options.authorization,
      authorityPolicyVersion,
      store: authority.store,
      commandKey: setAdmissionApprovalCommandKey,
      commandPolicy: createAdmissionApprovalCommandPolicy(),
      touchedPredicates: buildAdmissionApprovalCommandTargets(
        planned.result.approvalId,
        compiledFieldIndex,
      ),
      writeScope: "authority-only",
    });

    return applyStagedWebAuthorityMutation({
      changed: planned.changed,
      result: planned.result,
      writeScope: "authority-only",
      async commit(writeScope) {
        await applyTransaction(planned.transaction, {
          authorization: options.authorization,
          writeScope,
        });
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
    if (command.kind === "agent-session-append") {
      return runAgentSessionAppendCommand(
        command.input,
        {
          store: authority.store,
          applyTransaction,
        },
        options,
      ) as Promise<WebAppAuthorityCommandResult<Command["kind"]>>;
    }
    if (command.kind === "artifact-write") {
      return runWorkflowArtifactWriteCommand(
        command.input,
        {
          store: authority.store,
          applyTransaction,
        },
        options,
      ) as Promise<WebAppAuthorityCommandResult<Command["kind"]>>;
    }
    if (command.kind === "decision-write") {
      return runWorkflowDecisionWriteCommand(
        command.input,
        {
          store: authority.store,
          applyTransaction,
        },
        options,
      ) as Promise<WebAppAuthorityCommandResult<Command["kind"]>>;
    }
    if (command.kind === "bootstrap-operator-access") {
      return runBootstrapOperatorAccessCommand(command.input) as Promise<
        WebAppAuthorityCommandResult<Command["kind"]>
      >;
    }
    if (command.kind === "set-admission-approval") {
      return runSetAdmissionApprovalCommand(command.input, options) as Promise<
        WebAppAuthorityCommandResult<Command["kind"]>
      >;
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
    activateSessionPrincipalRoleBindings,
    executeCommand,
    executeSerializedQuery,
    applyTransaction,
    createTotalSyncPayload,
    deleteSavedQuery,
    deleteSavedView,
    getSavedQuery,
    getSavedView,
    getIncrementalSyncResult,
    getPolicyVersion,
    listSavedQueries,
    listSavedViews,
    lookupBearerShare,
    lookupSessionPrincipal,
    planWorkflowReviewLiveRegistration,
    readCommitQueueScope,
    readPredicateValue,
    readProjectBranchScope,
    readWorkflowSessionFeed,
    readSnapshot,
    rebuildRetainedWorkflowProjection,
    resolveSavedQuery,
    resolveSavedView,
    saveSavedQuery,
    saveSavedView,
    writeSecretField,
  };
}
