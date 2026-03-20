import {
  persistedAuthoritativeGraphStateVersion,
  type PersistedAuthoritativeGraphState,
  type PersistedAuthoritativeGraphStorageLoadResult,
  type PersistedAuthoritativeGraphStoragePersistInput,
} from "@io/core/graph";

import type {
  WebAppAuthoritySecretRecord,
  WebAppAuthoritySecretWrite,
  WebAppAuthorityStorage,
} from "./authority.js";

export type PersistedTestWebAppAuthorityState = PersistedAuthoritativeGraphState & {
  readonly secrets?: Record<string, WebAppAuthoritySecretRecord>;
};

function clonePersistedValue<T>(value: T): T {
  return structuredClone(value);
}

function cloneSecretRecord(secret: WebAppAuthoritySecretRecord): WebAppAuthoritySecretRecord {
  return clonePersistedValue(secret);
}

function serializeSecretRecords(
  secretRecords: ReadonlyMap<string, WebAppAuthoritySecretRecord>,
): Record<string, WebAppAuthoritySecretRecord> {
  return Object.fromEntries(
    [...secretRecords.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([secretId, secret]) => [secretId, cloneSecretRecord(secret)]),
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
          needsPersistence: false,
        };
      },
      async loadSecrets(): Promise<Record<string, WebAppAuthoritySecretRecord>> {
        return serializeSecretRecords(persistedSecrets);
      },
      async commit(input, options): Promise<void> {
        writeState(input);
        if (options?.secretWrite) {
          persistedSecrets.set(options.secretWrite.secretId, toSecretRecord(options.secretWrite));
        }
      },
      async persist(input): Promise<void> {
        writeState(input);
      },
    },
    read() {
      if (!persistedState) return null;
      return clonePersistedValue({
        ...persistedState,
        secrets: serializeSecretRecords(persistedSecrets),
      });
    },
  };
}
