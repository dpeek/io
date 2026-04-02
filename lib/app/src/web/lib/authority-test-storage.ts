import {
  type PersistedAuthoritativeGraphRetainedRecord,
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
import {
  createPersistedRetainedDocumentRecords,
  loadRetainedDocumentStateFromPersistedRecords,
  retainedDocumentRecordKinds,
  type RetainedDocumentState,
} from "./retained-documents.js";

export type PersistedTestWebAppAuthorityState = PersistedAuthoritativeGraphState & {
  readonly retainedDocuments?: RetainedDocumentState;
  readonly secrets?: Record<string, WebAppAuthoritySecretRecord>;
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
const retainedDocumentRecordKindSet = new Set<string>(retainedDocumentRecordKinds);

function filterNonDocumentRetainedRecords(
  retainedRecords: readonly PersistedAuthoritativeGraphRetainedRecord[] | undefined,
): readonly PersistedAuthoritativeGraphRetainedRecord[] {
  if (!retainedRecords || retainedRecords.length === 0) {
    return [];
  }

  return retainedRecords.filter((record) => !retainedDocumentRecordKindSet.has(record.recordKind));
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
  const initialRetainedRecords =
    initialState?.retainedRecords ??
    (initialState?.retainedDocuments
      ? createPersistedRetainedDocumentRecords(initialState.retainedDocuments)
      : undefined);

  let persistedState = initialState
    ? clonePersistedValue({
        version: initialState.version,
        snapshot: initialState.snapshot,
        writeHistory: initialState.writeHistory,
        retainedRecords: initialRetainedRecords,
      })
    : null;
  let persistedSecrets = createSecretRecordMap(initialState?.secrets);
  let persistedRetainedDocuments = initialState?.retainedDocuments
    ? clonePersistedValue(initialState.retainedDocuments)
    : readRetainedDocuments(initialRetainedRecords);
  let persistedWorkflowProjection = initialState?.projection
    ? clonePersistedValue(initialState.projection)
    : null;

  function readRetainedDocuments(
    retainedRecords: readonly PersistedAuthoritativeGraphRetainedRecord[] | undefined,
  ): RetainedDocumentState | null {
    const loaded = retainedRecords
      ? loadRetainedDocumentStateFromPersistedRecords(retainedRecords)
      : null;
    return loaded ? clonePersistedValue(loaded.state) : null;
  }

  function writeState(input: PersistedAuthoritativeGraphStoragePersistInput): void {
    persistedState = clonePersistedValue({
      version: persistedAuthoritativeGraphStateVersion,
      snapshot: input.snapshot,
      writeHistory: input.writeHistory,
      retainedRecords: input.retainedRecords,
    });
    persistedRetainedDocuments = readRetainedDocuments(input.retainedRecords);
  }

  return {
    storage: {
      async load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null> {
        if (!persistedState) return null;
        return {
          snapshot: clonePersistedValue(persistedState.snapshot),
          writeHistory: clonePersistedValue(persistedState.writeHistory),
          retainedRecords: persistedState.retainedRecords
            ? clonePersistedValue(persistedState.retainedRecords)
            : undefined,
          recovery: "none",
          startupDiagnostics: {
            recovery: "none",
            repairReasons: [],
            resetReasons: [],
          },
        };
      },
      async loadRetainedProjection(): Promise<RetainedWorkflowProjectionState | null> {
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
        const retainedRecords = [
          ...filterNonDocumentRetainedRecords(persistedState?.retainedRecords),
          ...(retainedDocuments ? createPersistedRetainedDocumentRecords(retainedDocuments) : []),
        ];
        if (persistedState) {
          persistedState = clonePersistedValue({
            ...persistedState,
            retainedRecords: retainedRecords.length > 0 ? retainedRecords : undefined,
          });
        }
      },
      async replaceRetainedProjection(
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
      async commit(input, options): Promise<void> {
        writeState(input);
        persistedWorkflowProjection = options?.retainedProjection
          ? clonePersistedValue(options.retainedProjection)
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
        persistedWorkflowProjection = options?.retainedProjection
          ? clonePersistedValue(options.retainedProjection)
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
        ...(persistedWorkflowProjection
          ? { projection: clonePersistedValue(persistedWorkflowProjection) }
          : {}),
      });
    },
  };
}
