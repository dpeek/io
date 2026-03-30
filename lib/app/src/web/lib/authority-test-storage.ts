import {
  persistedAuthoritativeGraphStateVersion,
  type PersistedAuthoritativeGraphState,
  type PersistedAuthoritativeGraphStorageLoadResult,
  type PersistedAuthoritativeGraphStoragePersistInput,
} from "@io/graph-authority";
import type { RetainedWorkflowProjectionState } from "@io/graph-module-workflow";

import type {
  WebAppAuthoritySecretInventoryRecord,
  WebAppAuthoritySecretLoadOptions,
  WebAppAuthoritySecretRecord,
  WebAppAuthoritySecretRepairInput,
  WebAppAuthoritySecretWrite,
  WebAppAuthorityStorage,
} from "./authority.js";
import { collectLiveSecretIds } from "./authority.js";
import type { LoadedRetainedDocumentState, RetainedDocumentState } from "./retained-documents.js";
import type { SavedQueryRecord, SavedViewRecord } from "./saved-query.js";

export type PersistedTestWebAppAuthorityState = PersistedAuthoritativeGraphState & {
  readonly retainedDocuments?: RetainedDocumentState;
  readonly secrets?: Record<string, WebAppAuthoritySecretRecord>;
  readonly savedQueries?: Record<string, readonly SavedQueryRecord[]>;
  readonly savedViews?: Record<string, readonly SavedViewRecord[]>;
  readonly projection?: RetainedWorkflowProjectionState;
};

function clonePersistedValue<T>(value: T): T {
  return structuredClone(value);
}

function cloneSecretRecord(secret: WebAppAuthoritySecretRecord): WebAppAuthoritySecretRecord {
  return clonePersistedValue(secret);
}

function serializeSecretRecords(
  secretRecords: ReadonlyMap<string, WebAppAuthoritySecretRecord>,
  secretIds?: readonly string[],
): Record<string, WebAppAuthoritySecretRecord> {
  const allowedSecretIds = secretIds ? new Set(secretIds) : null;

  return Object.fromEntries(
    [...secretRecords.entries()]
      .filter(([secretId]) => allowedSecretIds?.has(secretId) ?? true)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([secretId, secret]) => [secretId, cloneSecretRecord(secret)]),
  );
}

function serializeSecretInventory(
  secretRecords: ReadonlyMap<string, WebAppAuthoritySecretRecord>,
): Record<string, WebAppAuthoritySecretInventoryRecord> {
  return Object.fromEntries(
    [...secretRecords.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([secretId, secret]) => [
        secretId,
        {
          version: secret.version,
        },
      ]),
  );
}

function createSecretRecordMap(
  secrets: Record<string, WebAppAuthoritySecretRecord> | undefined,
): Map<string, WebAppAuthoritySecretRecord> {
  return new Map(
    Object.entries(secrets ?? {}).map(([secretId, secret]) => [
      secretId,
      cloneSecretRecord(secret),
    ]),
  );
}

function toSecretRecord(secretWrite: WebAppAuthoritySecretWrite): WebAppAuthoritySecretRecord {
  const { secretId, ...secret } = secretWrite;
  void secretId;
  return clonePersistedValue(secret);
}

function createSavedQueryOwnerMap(
  input: Record<string, readonly SavedQueryRecord[]> | undefined,
): Map<string, Map<string, SavedQueryRecord>> {
  return new Map(
    Object.entries(input ?? {}).map(([ownerId, queries]) => [
      ownerId,
      new Map(queries.map((query) => [query.id, clonePersistedValue(query)])),
    ]),
  );
}

function createSavedViewOwnerMap(
  input: Record<string, readonly SavedViewRecord[]> | undefined,
): Map<string, Map<string, SavedViewRecord>> {
  return new Map(
    Object.entries(input ?? {}).map(([ownerId, views]) => [
      ownerId,
      new Map(views.map((view) => [view.id, clonePersistedValue(view)])),
    ]),
  );
}

function serializeSavedQueryOwnerMap(
  input: ReadonlyMap<string, ReadonlyMap<string, SavedQueryRecord>>,
): Record<string, readonly SavedQueryRecord[]> {
  return Object.fromEntries(
    [...input.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([ownerId, queries]) => [
        ownerId,
        [...queries.values()]
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map((query) => clonePersistedValue(query)),
      ]),
  );
}

function serializeSavedViewOwnerMap(
  input: ReadonlyMap<string, ReadonlyMap<string, SavedViewRecord>>,
): Record<string, readonly SavedViewRecord[]> {
  return Object.fromEntries(
    [...input.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([ownerId, views]) => [
        ownerId,
        [...views.values()]
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map((view) => clonePersistedValue(view)),
      ]),
  );
}

function getSavedQueryBucket(
  queriesByOwner: Map<string, Map<string, SavedQueryRecord>>,
  ownerId: string,
): Map<string, SavedQueryRecord> {
  const existing = queriesByOwner.get(ownerId);
  if (existing) {
    return existing;
  }
  const created = new Map<string, SavedQueryRecord>();
  queriesByOwner.set(ownerId, created);
  return created;
}

function getSavedViewBucket(
  viewsByOwner: Map<string, Map<string, SavedViewRecord>>,
  ownerId: string,
): Map<string, SavedViewRecord> {
  const existing = viewsByOwner.get(ownerId);
  if (existing) {
    return existing;
  }
  const created = new Map<string, SavedViewRecord>();
  viewsByOwner.set(ownerId, created);
  return created;
}

function pruneSecretRecordMap(
  secrets: Map<string, WebAppAuthoritySecretRecord>,
  input: WebAppAuthoritySecretRepairInput,
): Map<string, WebAppAuthoritySecretRecord> {
  const liveSecretIds = new Set(input.liveSecretIds);
  return new Map([...secrets.entries()].filter(([secretId]) => liveSecretIds.has(secretId)));
}

export function createInMemoryTestWebAppAuthorityStorage(
  initialState: PersistedTestWebAppAuthorityState | null = null,
): {
  readonly storage: WebAppAuthorityStorage;
  read(): PersistedTestWebAppAuthorityState | null;
} {
  let persistedState = initialState
    ? clonePersistedValue({
        version: initialState.version,
        snapshot: initialState.snapshot,
        writeHistory: initialState.writeHistory,
      })
    : null;
  let persistedSecrets = createSecretRecordMap(initialState?.secrets);
  let persistedRetainedDocuments = initialState?.retainedDocuments
    ? clonePersistedValue(initialState.retainedDocuments)
    : null;
  let persistedWorkflowProjection = initialState?.projection
    ? clonePersistedValue(initialState.projection)
    : null;
  let persistedSavedQueries = createSavedQueryOwnerMap(initialState?.savedQueries);
  let persistedSavedViews = createSavedViewOwnerMap(initialState?.savedViews);

  function writeState(input: PersistedAuthoritativeGraphStoragePersistInput): void {
    persistedState = clonePersistedValue({
      version: persistedAuthoritativeGraphStateVersion,
      snapshot: input.snapshot,
      writeHistory: input.writeHistory,
    });
  }

  return {
    storage: {
      async deleteSavedQuery(ownerId, queryId): Promise<void> {
        persistedSavedQueries.get(ownerId)?.delete(queryId);
        for (const [viewId, view] of persistedSavedViews.get(ownerId)?.entries() ?? []) {
          if (view.queryId === queryId) {
            persistedSavedViews.get(ownerId)?.delete(viewId);
          }
        }
      },
      async deleteSavedView(ownerId, viewId): Promise<void> {
        persistedSavedViews.get(ownerId)?.delete(viewId);
      },
      async getSavedQuery(ownerId, queryId): Promise<SavedQueryRecord | undefined> {
        return clonePersistedValue(persistedSavedQueries.get(ownerId)?.get(queryId));
      },
      async getSavedView(ownerId, viewId): Promise<SavedViewRecord | undefined> {
        return clonePersistedValue(persistedSavedViews.get(ownerId)?.get(viewId));
      },
      async listSavedQueries(ownerId): Promise<readonly SavedQueryRecord[]> {
        return [...(persistedSavedQueries.get(ownerId)?.values() ?? [])]
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map((query) => clonePersistedValue(query));
      },
      async listSavedViews(ownerId): Promise<readonly SavedViewRecord[]> {
        return [...(persistedSavedViews.get(ownerId)?.values() ?? [])]
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map((view) => clonePersistedValue(view));
      },
      async load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null> {
        if (!persistedState) return null;
        return {
          snapshot: clonePersistedValue(persistedState.snapshot),
          writeHistory: clonePersistedValue(persistedState.writeHistory),
          recovery: "none",
          startupDiagnostics: {
            recovery: "none",
            repairReasons: [],
            resetReasons: [],
          },
        };
      },
      async loadRetainedDocuments(): Promise<LoadedRetainedDocumentState | null> {
        return persistedRetainedDocuments
          ? {
              repairReasons: [],
              state: clonePersistedValue(persistedRetainedDocuments),
            }
          : null;
      },
      async loadWorkflowProjection(): Promise<RetainedWorkflowProjectionState | null> {
        return persistedWorkflowProjection
          ? clonePersistedValue(persistedWorkflowProjection)
          : null;
      },
      async replaceRetainedDocuments(
        retainedDocuments: RetainedDocumentState | null,
      ): Promise<void> {
        persistedRetainedDocuments = retainedDocuments
          ? clonePersistedValue(retainedDocuments)
          : null;
      },
      async replaceWorkflowProjection(
        projection: RetainedWorkflowProjectionState | null,
      ): Promise<void> {
        persistedWorkflowProjection = projection ? clonePersistedValue(projection) : null;
      },
      async inspectSecrets(): Promise<Record<string, WebAppAuthoritySecretInventoryRecord>> {
        return serializeSecretInventory(persistedSecrets);
      },
      async loadSecrets(
        options?: WebAppAuthoritySecretLoadOptions,
      ): Promise<Record<string, WebAppAuthoritySecretRecord>> {
        return serializeSecretRecords(persistedSecrets, options?.secretIds);
      },
      async repairSecrets(input: WebAppAuthoritySecretRepairInput): Promise<void> {
        persistedSecrets = pruneSecretRecordMap(persistedSecrets, input);
      },
      async saveSavedQuery(ownerId, query): Promise<void> {
        getSavedQueryBucket(persistedSavedQueries, ownerId).set(
          query.id,
          clonePersistedValue(query),
        );
      },
      async saveSavedView(ownerId, view): Promise<void> {
        getSavedViewBucket(persistedSavedViews, ownerId).set(view.id, clonePersistedValue(view));
      },
      async commit(input, options): Promise<void> {
        writeState(input);
        persistedRetainedDocuments = options?.retainedDocuments
          ? clonePersistedValue(options.retainedDocuments)
          : null;
        persistedWorkflowProjection = options?.projection
          ? clonePersistedValue(options.projection)
          : null;
        if (options?.secretWrite) {
          persistedSecrets.set(options.secretWrite.secretId, toSecretRecord(options.secretWrite));
        }
        persistedSecrets = pruneSecretRecordMap(persistedSecrets, {
          liveSecretIds: collectLiveSecretIds(input.snapshot),
        });
      },
      async persist(input, options): Promise<void> {
        writeState(input);
        persistedRetainedDocuments = options?.retainedDocuments
          ? clonePersistedValue(options.retainedDocuments)
          : null;
        persistedWorkflowProjection = options?.projection
          ? clonePersistedValue(options.projection)
          : null;
        persistedSecrets = pruneSecretRecordMap(persistedSecrets, {
          liveSecretIds: collectLiveSecretIds(input.snapshot),
        });
      },
    },
    read() {
      if (!persistedState) return null;
      return clonePersistedValue({
        ...persistedState,
        secrets: serializeSecretRecords(persistedSecrets),
        ...(persistedRetainedDocuments
          ? { retainedDocuments: clonePersistedValue(persistedRetainedDocuments) }
          : {}),
        savedQueries: serializeSavedQueryOwnerMap(persistedSavedQueries),
        savedViews: serializeSavedViewOwnerMap(persistedSavedViews),
        ...(persistedWorkflowProjection
          ? { projection: clonePersistedValue(persistedWorkflowProjection) }
          : {}),
      });
    },
  };
}
