import {
  bootstrap,
  createPersistedAuthoritativeGraph,
  createStore,
  createTypeClient,
  core,
  edgeId,
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
  type Store,
  type StoreSnapshot,
} from "@io/core/graph";
import { app } from "@io/core/graph/schema/app";

import { seedExampleGraph } from "./example-data.js";
import {
  buildSecretHandleName,
  secretFieldEntityIdRequiredMessage,
  secretFieldPlaintextRequiredMessage,
  secretFieldPredicateIdRequiredMessage,
  type WriteSecretFieldInput,
  type WriteSecretFieldResult,
} from "./secret-fields.js";

const webAppGraph = { ...core, ...app } as const;

type WebAppGraph = typeof webAppGraph;
type SecretFieldDefinition = {
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

export type WebAppAuthority = PersistedAuthoritativeGraph<WebAppGraph> & {
  writeSecretField(input: WriteSecretFieldInput): Promise<WriteSecretFieldResult>;
};

export type WebAppAuthorityOptions = {
  readonly maxRetainedTransactions?: number;
};

const typePredicateId = edgeId(core.node.fields.type);
const namePredicateId = edgeId(core.node.fields.name);
const labelPredicateId = edgeId(core.node.fields.label);

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

class WebAppAuthorityMutationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WebAppAuthorityMutationError";
    this.status = status;
  }
}

function isDefinitionField(
  value: unknown,
): value is SecretFieldDefinition["field"] & Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SecretFieldDefinition["field"]>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.range === "string" &&
    typeof candidate.cardinality === "string"
  );
}

function getFieldLabel(field: SecretFieldDefinition["field"]): string {
  if (field.meta?.label) return field.meta.label;
  const segments = field.key.split(":");
  return segments.at(-1) ?? field.key;
}

function flattenSecretFieldDefinitions(
  tree: Record<string, unknown>,
  ownerTypeId: string,
  path: string[] = [],
  entries = new Map<string, SecretFieldDefinition>(),
): Map<string, SecretFieldDefinition> {
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

function buildCompiledFieldIndex(): ReadonlyMap<string, SecretFieldDefinition> {
  const entries = new Map<string, SecretFieldDefinition>();

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
  bootstrap(mutationStore, app);
  mutationStore.replace(snapshot);

  const mutationGraph = createTypeClient(mutationStore, webAppGraph);
  const before = mutationStore.snapshot();
  const result = mutate(mutationGraph, mutationStore);
  const after = mutationStore.snapshot();
  const previousEdgeIds = new Set(before.edges.map((edge) => edge.id));
  const previousRetractedIds = new Set(before.retracted);
  const ops: GraphWriteTransaction["ops"] = [
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
    changed: ops.length > 0,
    result,
    transaction: {
      id: txId,
      ops,
    },
  };
}

function createAuthorityStorage(
  storage: WebAppAuthorityStorage,
  pendingSecretWriteRef: { current: WebAppAuthoritySecretWrite | null },
): PersistedAuthoritativeGraphStorage {
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
  bootstrap(store, app);

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

  async function writeSecretField(input: WriteSecretFieldInput): Promise<WriteSecretFieldResult> {
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

    const nextSecretValues = new Map(secretValuesRef.current);
    nextSecretValues.set(planned.result.secretId, plaintext);

    if (planned.changed) {
      const previousSecretValues = secretValuesRef.current;
      secretValuesRef.current = nextSecretValues;
      pendingSecretWriteRef.current = {
        secretId: planned.result.secretId,
        value: plaintext,
        version: planned.result.secretVersion,
      };
      try {
        await authority.applyTransaction(planned.transaction, {
          writeScope: "server-command",
        });
      } catch (error) {
        secretValuesRef.current = previousSecretValues;
        pendingSecretWriteRef.current = null;
        throw error;
      }
    }

    return planned.result;
  }

  return {
    ...authority,
    writeSecretField,
  };
}
