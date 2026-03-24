import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  createPersistedAuthoritativeGraph,
  persistedAuthoritativeGraphStateVersion,
  type JsonPersistedAuthoritativeGraphOptions,
  type PersistedAuthoritativeGraph,
  type PersistedAuthoritativeGraphStartupDiagnostics,
  type PersistedAuthoritativeGraphStorageCommitInput,
  type PersistedAuthoritativeGraphStoragePersistInput,
  type PersistedAuthoritativeGraphState,
  type PersistedAuthoritativeGraphStorage,
  type PersistedAuthoritativeGraphStorageLoadResult,
} from "./persisted-authority";
import type { AnyTypeOutput } from "./schema";
import type { Store, StoreSnapshot } from "./store";
import {
  graphSyncScope,
  isAuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type TotalSyncPayload,
  unboundedAuthoritativeGraphRetainedHistoryPolicy,
  validateAuthoritativeTotalSyncPayload,
} from "./sync";

export * from "./persisted-authority";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function validatePersistedSnapshot(
  snapshot: StoreSnapshot,
  source: string,
  namespace: Record<string, AnyTypeOutput>,
): StoreSnapshot {
  const validation = validateAuthoritativeTotalSyncPayload(
    {
      mode: "total",
      scope: graphSyncScope,
      snapshot,
      cursor: "persisted:snapshot",
      completeness: "complete",
      freshness: "current",
    } satisfies TotalSyncPayload,
    namespace,
  );
  if (validation.ok) return snapshot;

  const messages = validation.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "snapshot";
    return `${path}: ${issue.message}`;
  });
  throw new Error(`Invalid persisted authority snapshot in "${source}": ${messages.join(" | ")}`);
}

function readPersistedWriteHistory(rawHistory: unknown): {
  readonly writeHistory?: AuthoritativeGraphWriteHistory;
  readonly recovery: "none" | "repair";
  readonly startupDiagnostics: PersistedAuthoritativeGraphStartupDiagnostics;
} {
  if (!isObjectRecord(rawHistory)) {
    return {
      recovery: "none",
      startupDiagnostics: {
        recovery: "none",
        repairReasons: [],
        resetReasons: [],
      },
    };
  }
  const cursorPrefix = rawHistory.cursorPrefix;
  const baseSequence = rawHistory.baseSequence;
  const results = rawHistory.results;
  if (typeof cursorPrefix !== "string") {
    return {
      recovery: "none",
      startupDiagnostics: {
        recovery: "none",
        repairReasons: [],
        resetReasons: [],
      },
    };
  }
  if (typeof baseSequence !== "number" || !Number.isInteger(baseSequence) || baseSequence < 0) {
    return {
      recovery: "none",
      startupDiagnostics: {
        recovery: "none",
        repairReasons: [],
        resetReasons: [],
      },
    };
  }
  if (!Array.isArray(results)) {
    return {
      recovery: "none",
      startupDiagnostics: {
        recovery: "none",
        repairReasons: [],
        resetReasons: [],
      },
    };
  }
  const retainedHistoryPolicy = rawHistory.retainedHistoryPolicy;
  const normalizedRetainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy =
    isAuthoritativeGraphRetainedHistoryPolicy(retainedHistoryPolicy)
      ? retainedHistoryPolicy
      : unboundedAuthoritativeGraphRetainedHistoryPolicy;
  const repairReasons = [
    ...(retainedHistoryPolicy === undefined ||
    !isAuthoritativeGraphRetainedHistoryPolicy(retainedHistoryPolicy)
      ? (["retained-history-policy-normalized"] as const)
      : []),
    ...(results.some((result) => isObjectRecord(result) && !("writeScope" in result))
      ? (["write-history-write-scope-normalized"] as const)
      : []),
  ];

  // Legacy entries predate durable writeScope storage. They are intentionally
  // normalized to client-tx on load and then rewritten, rather than treated as
  // exact historical authority-origin audit data.
  return {
    writeHistory: {
      cursorPrefix,
      retainedHistoryPolicy: normalizedRetainedHistoryPolicy,
      baseSequence,
      results: results as AuthoritativeGraphWriteResult[],
    },
    recovery: repairReasons.length > 0 ? "repair" : "none",
    startupDiagnostics: {
      recovery: repairReasons.length > 0 ? "repair" : "none",
      repairReasons,
      resetReasons: [],
    },
  };
}

export function createJsonPersistedAuthoritativeGraphStorage<
  const T extends Record<string, AnyTypeOutput>,
>(path: string, namespace: T): PersistedAuthoritativeGraphStorage {
  async function load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null> {
    try {
      const rawSnapshot = await readFile(path, "utf8");
      const parsed = JSON.parse(rawSnapshot) as unknown;

      if (
        isObjectRecord(parsed) &&
        parsed.version === persistedAuthoritativeGraphStateVersion &&
        "snapshot" in parsed
      ) {
        const snapshot = validatePersistedSnapshot(
          parsed.snapshot as StoreSnapshot,
          path,
          namespace,
        );
        const persistedWriteHistory = readPersistedWriteHistory(parsed.writeHistory);
        return {
          snapshot,
          writeHistory: persistedWriteHistory.writeHistory,
          recovery:
            persistedWriteHistory.writeHistory === undefined
              ? "reset-baseline"
              : persistedWriteHistory.recovery,
          startupDiagnostics:
            persistedWriteHistory.writeHistory === undefined
              ? {
                  recovery: "reset-baseline",
                  repairReasons: [],
                  resetReasons: ["missing-write-history"],
                }
              : persistedWriteHistory.startupDiagnostics,
        };
      }

      return {
        snapshot: validatePersistedSnapshot(parsed as StoreSnapshot, path, namespace),
        recovery: "reset-baseline",
        startupDiagnostics: {
          recovery: "reset-baseline",
          repairReasons: [],
          resetReasons: ["missing-write-history"],
        },
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeState({
    snapshot,
    writeHistory,
  }: PersistedAuthoritativeGraphStoragePersistInput): Promise<void> {
    await mkdir(dirname(path), { recursive: true });

    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    const state: PersistedAuthoritativeGraphState = {
      version: persistedAuthoritativeGraphStateVersion,
      snapshot,
      writeHistory,
    };

    try {
      await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    load,
    async commit(input: PersistedAuthoritativeGraphStorageCommitInput): Promise<void> {
      await writeState(input);
    },
    persist: writeState,
  };
}

export async function createJsonPersistedAuthoritativeGraph<
  const T extends Record<string, AnyTypeOutput>,
>(
  store: Store,
  namespace: T,
  options: JsonPersistedAuthoritativeGraphOptions<T>,
): Promise<PersistedAuthoritativeGraph<T>> {
  return createPersistedAuthoritativeGraph(store, namespace, {
    storage: createJsonPersistedAuthoritativeGraphStorage(options.path, namespace),
    seed: options.seed,
    createCursorPrefix: options.createCursorPrefix,
    retainedHistoryPolicy: options.retainedHistoryPolicy,
  });
}
