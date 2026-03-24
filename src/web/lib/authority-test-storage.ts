import {
  persistedAuthoritativeGraphStateVersion,
  type PersistedAuthoritativeGraphState,
  type PersistedAuthoritativeGraphStorageLoadResult,
  type PersistedAuthoritativeGraphStoragePersistInput,
} from "@io/core/graph";
import type { RetainedWorkflowProjectionState } from "@io/core/graph/modules/ops/workflow";

import type {
  WebAppAuthoritySecretInventoryRecord,
  WebAppAuthoritySecretLoadOptions,
  WebAppAuthoritySecretRecord,
  WebAppAuthoritySecretRepairInput,
  WebAppAuthoritySecretWrite,
  WebAppAuthorityStorage,
} from "./authority.js";
import { collectLiveSecretIds } from "./authority.js";

export type PersistedTestWebAppAuthorityState = PersistedAuthoritativeGraphState & {
  readonly secrets?: Record<string, WebAppAuthoritySecretRecord>;
  readonly workflowProjection?: RetainedWorkflowProjectionState;
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
  let persistedWorkflowProjection = initialState?.workflowProjection
    ? clonePersistedValue(initialState.workflowProjection)
    : null;

  function writeState(input: PersistedAuthoritativeGraphStoragePersistInput): void {
    persistedState = clonePersistedValue({
      version: persistedAuthoritativeGraphStateVersion,
      snapshot: input.snapshot,
      writeHistory: input.writeHistory,
    });
  }

  return {
    storage: {
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
      async loadWorkflowProjection(): Promise<RetainedWorkflowProjectionState | null> {
        return persistedWorkflowProjection
          ? clonePersistedValue(persistedWorkflowProjection)
          : null;
      },
      async replaceWorkflowProjection(
        workflowProjection: RetainedWorkflowProjectionState | null,
      ): Promise<void> {
        persistedWorkflowProjection = workflowProjection
          ? clonePersistedValue(workflowProjection)
          : null;
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
        persistedWorkflowProjection = options?.workflowProjection
          ? clonePersistedValue(options.workflowProjection)
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
        persistedWorkflowProjection = options?.workflowProjection
          ? clonePersistedValue(options.workflowProjection)
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
        ...(persistedWorkflowProjection
          ? { workflowProjection: clonePersistedValue(persistedWorkflowProjection) }
          : {}),
      });
    },
  };
}
