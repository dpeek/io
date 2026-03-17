import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  createPersistedAuthoritativeGraph,
  persistedAuthoritativeGraphStateVersion,
  type JsonPersistedAuthoritativeGraphOptions,
  type PersistedAuthoritativeGraph,
  type PersistedAuthoritativeGraphState,
  type PersistedAuthoritativeGraphStorage,
  type PersistedAuthoritativeGraphStorageLoadResult,
} from "./persisted-authority";
import type { AnyTypeOutput } from "./schema";
import type { Store, StoreSnapshot } from "./store";
import {
  graphSyncScope,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type TotalSyncPayload,
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

function readPersistedWriteHistory(
  rawHistory: unknown,
): AuthoritativeGraphWriteHistory | undefined {
  if (!isObjectRecord(rawHistory)) return undefined;
  const cursorPrefix = rawHistory.cursorPrefix;
  const baseSequence = rawHistory.baseSequence;
  const results = rawHistory.results;
  if (typeof cursorPrefix !== "string") return undefined;
  if (typeof baseSequence !== "number" || !Number.isInteger(baseSequence) || baseSequence < 0) {
    return undefined;
  }
  if (!Array.isArray(results)) return undefined;
  return {
    cursorPrefix,
    baseSequence,
    results: results as AuthoritativeGraphWriteResult[],
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
        const writeHistory = readPersistedWriteHistory(parsed.writeHistory);
        return {
          snapshot,
          writeHistory,
          needsRewrite: writeHistory === undefined,
        };
      }

      return {
        snapshot: validatePersistedSnapshot(parsed as StoreSnapshot, path, namespace),
        needsRewrite: true,
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function save(state: PersistedAuthoritativeGraphState): Promise<void> {
    await mkdir(dirname(path), { recursive: true });

    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;

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
    save,
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
  });
}
