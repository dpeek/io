import {
  type AuthorizationContext,
  type AuthoritativeWriteScope,
  authorizeCommand,
  authorizeWrite,
  bootstrap,
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
  type Store,
  type StoreSnapshot,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import type {
  WorkflowMutationAction,
  WorkflowMutationResult,
} from "@io/core/graph/modules/ops/workflow";
import { pkm } from "@io/core/graph/modules/pkm";

import { seedExampleGraph } from "./example-data.js";
import {
  buildSecretHandleName,
  secretFieldEntityIdRequiredMessage,
  secretFieldPlaintextRequiredMessage,
  secretFieldPredicateIdRequiredMessage,
  type WriteSecretFieldInput,
  type WriteSecretFieldResult,
} from "./secret-fields.js";
import { runWorkflowMutationCommand } from "./workflow-authority.js";

const webAppGraph = { ...core, ...pkm, ...ops } as const;

type WebAppGraph = typeof webAppGraph;
type PersistedWebAppAuthority = PersistedAuthoritativeGraph<WebAppGraph>;
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

export type WriteSecretFieldWebAppAuthorityCommand = {
  readonly kind: "write-secret-field";
  readonly input: WriteSecretFieldInput;
};

export type WorkflowMutationWebAppAuthorityCommand = {
  readonly kind: "workflow-mutation";
  readonly input: WorkflowMutationAction;
};

export type WebAppAuthorityCommand =
  | WriteSecretFieldWebAppAuthorityCommand
  | WorkflowMutationWebAppAuthorityCommand;

type WebAppAuthorityCommandResultMap = {
  "write-secret-field": WriteSecretFieldResult;
  "workflow-mutation": WorkflowMutationResult;
};

export type WebAppAuthorityCommandResult<
  Kind extends WebAppAuthorityCommand["kind"] = WebAppAuthorityCommand["kind"],
> = WebAppAuthorityCommandResultMap[Kind];

type WebAppAuthorityCommandRollback = () => void;
type WebAppAuthorityCommandStageContext = {
  addRollback(rollback: WebAppAuthorityCommandRollback): void;
};

/**
 * Web authority storage adds secret side-storage to the shared graph/runtime
 * persisted-authority boundary. Only the adapted graph state contract should be
 * treated as stable across branches.
 */
export interface WebAppAuthorityStorage {
  load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null>;
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
  "applyTransaction" | "createSyncPayload" | "getIncrementalSyncResult"
> & {
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
  readonly maxRetainedTransactions?: number;
};

const typePredicateId = edgeId(core.node.fields.type);
const namePredicateId = edgeId(core.node.fields.name);
const labelPredicateId = edgeId(core.node.fields.label);
const createdAtPredicateId = edgeId(core.node.fields.createdAt);
const updatedAtPredicateId = edgeId(core.node.fields.updatedAt);
const secretHandleVersionPredicateId = edgeId(core.secretHandle.fields.version);
const secretHandleLastRotatedAtPredicateId = edgeId(core.secretHandle.fields.lastRotatedAt);
const graphWriteTransactionValidationKey = "$sync:tx";
const webAppAuthorityPolicyVersion = 0;
const webAppAuthorityCapabilityKeys: readonly string[] = [];
const writeSecretFieldCommandKey = "write-secret-field";
const writeSecretFieldCommandPolicy = {
  touchesPredicates: [
    { predicateId: typePredicateId },
    { predicateId: createdAtPredicateId },
    { predicateId: namePredicateId },
    { predicateId: updatedAtPredicateId },
    { predicateId: secretHandleVersionPredicateId },
    { predicateId: secretHandleLastRotatedAtPredicateId },
    { predicateId: edgeId(ops.envVar.fields.secret) },
  ],
} satisfies GraphCommandPolicy;

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

function buildCompiledFieldIndex(): ReadonlyMap<string, CompiledFieldDefinition> {
  const entries = new Map<string, CompiledFieldDefinition>();

  for (const typeDef of Object.values(webAppGraph)) {
    if (!isEntityType(typeDef)) continue;
    flattenSecretFieldDefinitions(
      typeDef.fields,
      typeDef.values.id ?? typeDef.values.key,
      [],
      entries,
    );
  }

  return entries;
}

const compiledFieldIndex = buildCompiledFieldIndex();

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

function getFirstObject(store: Store, subjectId: string, predicateId: string): string | undefined {
  return store.facts(subjectId, predicateId)[0]?.o;
}

function getEntityLabel(store: Store, id: string): string {
  return (
    getFirstObject(store, id, namePredicateId) ?? getFirstObject(store, id, labelPredicateId) ?? id
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
  const mutationStore = createStore();
  bootstrap(mutationStore, core);
  bootstrap(mutationStore, pkm);
  bootstrap(mutationStore, ops);
  mutationStore.replace(snapshot);

  const mutationGraph = createTypeClient(mutationStore, webAppGraph);
  const before = mutationStore.snapshot();
  const result = mutate(mutationGraph, mutationStore);
  const after = mutationStore.snapshot();
  const previousEdgeIds = new Set(before.edges.map((edge) => edge.id));
  const previousRetractedIds = new Set(before.retracted);
  const writeOps: GraphWriteTransaction["ops"] = [
    ...after.retracted
      .filter((edgeId) => !previousRetractedIds.has(edgeId))
      .map((edgeId) => ({ op: "retract" as const, edgeId })),
    ...after.edges
      .filter((edge) => !previousEdgeIds.has(edge.id))
      .map((edge) => ({
        op: "assert" as const,
        edge: { ...edge },
      })),
  ];

  return {
    changed: writeOps.length > 0,
    result,
    transaction: {
      id: txId,
      ops: writeOps,
    },
  };
}

function createTransactionEdgeIndex(
  snapshot: StoreSnapshot,
): ReadonlyMap<string, StoreSnapshot["edges"][number]> {
  return new Map(snapshot.edges.map((edge) => [edge.id, edge]));
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
    if (operation.op === "assert") {
      targets.push({
        path: [`ops[${index}]`],
        subjectId: operation.edge.s,
        predicateId: operation.edge.p,
      });
      continue;
    }

    const edge = edgeById.get(operation.edgeId);
    if (!edge) continue;
    targets.push({
      path: [`ops[${index}]`],
      subjectId: edge.s,
      predicateId: edge.p,
    });
  }

  return targets;
}

function createAuthorizationTarget(subjectId: string, predicateId: string) {
  return {
    subjectId,
    predicateId,
    policy: compiledFieldIndex.get(predicateId)?.policy,
  };
}

function assertTransactionAuthorized(
  transaction: GraphWriteTransaction,
  snapshot: StoreSnapshot,
  authorization: AuthorizationContext,
  writeScope: AuthoritativeWriteScope,
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
        target: createAuthorizationTarget(target.subjectId, target.predicateId),
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

function buildWriteSecretFieldCommandTargets(input: {
  readonly entityId: string;
  readonly predicateId: string;
  readonly secretId: string;
}) {
  return [
    createAuthorizationTarget(input.secretId, typePredicateId),
    createAuthorizationTarget(input.secretId, createdAtPredicateId),
    createAuthorizationTarget(input.secretId, namePredicateId),
    createAuthorizationTarget(input.secretId, updatedAtPredicateId),
    createAuthorizationTarget(input.secretId, secretHandleVersionPredicateId),
    createAuthorizationTarget(input.secretId, secretHandleLastRotatedAtPredicateId),
    createAuthorizationTarget(input.entityId, input.predicateId),
  ];
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

function runAuthorityCommandRollbacks(rollbacks: readonly WebAppAuthorityCommandRollback[]): void {
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
    throw new AggregateError(rollbackErrors, "Authority command rollback failed.");
  }
}

export async function executeAuthorityCommand<TResult>(input: {
  readonly changed: boolean;
  readonly result: TResult;
  readonly writeScope: AuthoritativeWriteScope;
  readonly commit: (writeScope: AuthoritativeWriteScope) => Promise<void>;
  readonly stage?: (result: TResult, context: WebAppAuthorityCommandStageContext) => void;
}): Promise<TResult> {
  if (!input.changed) return input.result;

  const rollbacks: WebAppAuthorityCommandRollback[] = [];
  try {
    input.stage?.(input.result, {
      addRollback(rollback) {
        rollbacks.push(rollback);
      },
    });
    await input.commit(input.writeScope);
  } catch (error) {
    try {
      runAuthorityCommandRollbacks(rollbacks);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Authority command failed and rollback did not complete.",
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
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, pkm);
  bootstrap(store, ops);

  const persistedSecrets = await storage.loadSecrets();
  const secretValuesRef = {
    current: new Map(
      Object.entries(persistedSecrets).map(([secretId, secret]) => [secretId, secret.value]),
    ),
  };
  const pendingSecretWriteRef = {
    current: null as WebAppAuthoritySecretWrite | null,
  };
  const authority = await createPersistedAuthoritativeGraph(store, webAppGraph, {
    storage: createAuthorityStorage(storage, pendingSecretWriteRef),
    seed() {
      seedExampleGraph(createTypeClient(store, webAppGraph));
    },
    createCursorPrefix: createAuthorityCursorPrefix,
    maxRetainedTransactions: options.maxRetainedTransactions,
  });

  function createSyncPayload(options: WebAppAuthoritySyncOptions) {
    void options.authorization;
    return authority.createSyncPayload({
      freshness: options.freshness,
    });
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
    );
    return authority.applyTransaction(transaction, {
      writeScope,
    });
  }

  function getIncrementalSyncResult(
    after: string | undefined,
    options: WebAppAuthoritySyncOptions,
  ) {
    void options.authorization;
    return authority.getIncrementalSyncResult(after, {
      freshness: options.freshness,
    });
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
      commandPolicy: writeSecretFieldCommandPolicy,
      touchedPredicates: buildWriteSecretFieldCommandTargets({
        entityId,
        predicateId,
        secretId: planned.result.secretId,
      }),
      writeScope: "server-command",
    });
    return executeAuthorityCommand({
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
    return executeCommand(
      {
        kind: "write-secret-field",
        input,
      },
      options,
    );
  }

  return {
    ...authority,
    executeCommand,
    applyTransaction,
    createSyncPayload,
    getIncrementalSyncResult,
    writeSecretField,
  };
}
