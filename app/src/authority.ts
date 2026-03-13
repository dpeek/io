import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bootstrap,
  createPersistedAuthoritativeGraph,
  createStore,
  createTypeClient,
  core,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type NamespaceClient,
  type PersistedAuthoritativeGraph,
  type PersistedAuthoritativeGraphState,
  type PersistedAuthoritativeGraphStorage,
  type PersistedAuthoritativeGraphStorageLoadResult,
  type StoreSnapshot,
  type TotalSyncPayload,
  validateAuthoritativeTotalSyncPayload,
} from "@io/graph";

import {
  buildSecretReferenceName,
  envVarNameInvalidMessage,
  envVarNamePattern,
  envVarNameRequiredMessage,
  newEnvVarSecretRequiredMessage,
  type SaveEnvVarInput,
  type SaveEnvVarResult,
} from "./env-vars.js";
import { app } from "./graph/app.js";
import { seedExampleGraph } from "./graph/example-data.js";

export type { SaveEnvVarInput, SaveEnvVarResult } from "./env-vars.js";

export type AppAuthority = PersistedAuthoritativeGraph<typeof app> & {
  readonly snapshotPath: string;
  saveEnvVar(input: SaveEnvVarInput): Promise<SaveEnvVarResult>;
};

type PersistedAuthorityState = PersistedAuthoritativeGraphState & {
  readonly secretValues?: Record<string, string>;
};

type LoadedAuthorityState = PersistedAuthoritativeGraphStorageLoadResult & {
  readonly secretValues: Record<string, string>;
};

const defaultAuthoritySnapshotPath = fileURLToPath(
  new URL("../tmp/app-graph.snapshot.json", import.meta.url),
);
let authorityCursorEpoch = 0;

function resolveAuthoritySnapshotPath(configuredSnapshotPath?: string): string {
  const rawPath = configuredSnapshotPath?.trim() ?? Bun.env.IO_APP_SNAPSHOT_PATH?.trim();
  if (!rawPath) return defaultAuthoritySnapshotPath;
  return isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function createAuthorityCursorPrefix(): string {
  authorityCursorEpoch = Math.max(authorityCursorEpoch + 1, Date.now());
  return `authority:${authorityCursorEpoch}:`;
}

function createAuthoritySnapshotPayload(snapshot: StoreSnapshot): TotalSyncPayload {
  return {
    mode: "total",
    scope: { kind: "graph" },
    snapshot,
    cursor: "authority:snapshot",
    completeness: "complete",
    freshness: "current",
  };
}

function validateAuthoritySnapshot(snapshot: StoreSnapshot, snapshotPath: string): StoreSnapshot {
  const validation = validateAuthoritativeTotalSyncPayload(
    createAuthoritySnapshotPayload(snapshot),
    app,
  );
  if (validation.ok) return snapshot;

  const messages = validation.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "snapshot";
    return `${path}: ${issue.message}`;
  });
  throw new Error(`Invalid authority snapshot in "${snapshotPath}": ${messages.join(" | ")}`);
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

function readPersistedSecretValues(rawValues: unknown): Record<string, string> {
  if (!isObjectRecord(rawValues)) return {};
  return Object.fromEntries(
    Object.entries(rawValues).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

async function readAuthorityState(snapshotPath: string): Promise<LoadedAuthorityState | null> {
  try {
    const rawSnapshot = await readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(rawSnapshot) as unknown;

    if (isObjectRecord(parsed) && parsed.version === 1 && "snapshot" in parsed) {
      const snapshot = validateAuthoritySnapshot(parsed.snapshot as StoreSnapshot, snapshotPath);
      const writeHistory = readPersistedWriteHistory(parsed.writeHistory);
      return {
        snapshot,
        writeHistory,
        secretValues: readPersistedSecretValues(parsed.secretValues),
        needsRewrite: writeHistory === undefined,
      };
    }

    return {
      snapshot: validateAuthoritySnapshot(parsed as StoreSnapshot, snapshotPath),
      secretValues: {},
      needsRewrite: true,
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAuthorityState(
  snapshotPath: string,
  state: PersistedAuthorityState,
): Promise<void> {
  await mkdir(dirname(snapshotPath), { recursive: true });

  const tempPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
    await rename(tempPath, snapshotPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function serializeSecretValues(secretValues: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(
    [...secretValues.entries()].sort((left, right) => left[0].localeCompare(right[0])),
  );
}

class AppAuthorityMutationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AppAuthorityMutationError";
    this.status = status;
  }
}

function planAuthorityMutation<TResult>(
  snapshot: StoreSnapshot,
  txId: string,
  mutate: (graph: NamespaceClient<typeof app>) => TResult,
): {
  readonly changed: boolean;
  readonly result: TResult;
  readonly transaction: GraphWriteTransaction;
} {
  const mutationStore = createStore();
  bootstrap(mutationStore, core);
  bootstrap(mutationStore, app);
  mutationStore.replace(snapshot);

  const mutationGraph = createTypeClient(mutationStore, app);
  const before = mutationStore.snapshot();
  const result = mutate(mutationGraph);
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
  snapshotPath: string,
  secretValuesRef: { current: Map<string, string> },
): PersistedAuthoritativeGraphStorage {
  return {
    async load() {
      const state = await readAuthorityState(snapshotPath);
      secretValuesRef.current = new Map(Object.entries(state?.secretValues ?? {}));
      if (!state) return null;
      return {
        snapshot: state.snapshot,
        writeHistory: state.writeHistory,
        needsRewrite: state.needsRewrite,
      };
    },
    async save(state) {
      await writeAuthorityState(snapshotPath, {
        ...state,
        secretValues: serializeSecretValues(secretValuesRef.current),
      });
    },
  };
}

export async function createAppAuthority(
  options: {
    snapshotPath?: string;
  } = {},
): Promise<AppAuthority> {
  const snapshotPath = resolveAuthoritySnapshotPath(options.snapshotPath);
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);

  const secretValuesRef = {
    current: new Map<string, string>(),
  };
  const authority = await createPersistedAuthoritativeGraph(store, app, {
    storage: createAuthorityStorage(snapshotPath, secretValuesRef),
    seed(graph) {
      seedExampleGraph(graph);
    },
    createCursorPrefix: createAuthorityCursorPrefix,
  });
  const graph = authority.graph;

  async function saveEnvVar(input: SaveEnvVarInput): Promise<SaveEnvVarResult> {
    const name = input.name.trim();
    const description = trimOptionalString(input.description);
    const secretValue = trimOptionalString(input.secretValue);

    if (!name) {
      throw new AppAuthorityMutationError(400, envVarNameRequiredMessage);
    }
    if (!envVarNamePattern.test(name)) {
      throw new AppAuthorityMutationError(400, envVarNameInvalidMessage);
    }

    const existing = input.id ? graph.envVar.get(input.id) : undefined;
    if (input.id && !existing) {
      throw new AppAuthorityMutationError(404, `Environment variable "${input.id}" was not found.`);
    }
    if (!input.id && !secretValue) {
      throw new AppAuthorityMutationError(400, newEnvVarSecretRequiredMessage);
    }

    const duplicate = graph.envVar
      .list()
      .find((envVar) => envVar.name === name && envVar.id !== input.id);
    if (duplicate) {
      throw new AppAuthorityMutationError(
        409,
        `Environment variable "${name}" already exists.`,
      );
    }

    const existingSecretId = existing?.secret;
    const shouldRotateSecret =
      secretValue !== undefined &&
      (!existingSecretId || secretValuesRef.current.get(existingSecretId) !== secretValue);

    const planned = planAuthorityMutation(
      store.snapshot(),
      `env-var:${input.id ?? "new"}:${Date.now()}`,
      (mutationGraph) => {
        let envVarId = input.id;
        let secretId = existingSecretId;
        let secretVersion =
          existingSecretId === undefined
            ? undefined
            : mutationGraph.secretRef.get(existingSecretId)?.version;

        if (!envVarId) {
          secretId = mutationGraph.secretRef.create({
            name: buildSecretReferenceName(name),
            version: 1,
            lastRotatedAt: new Date(),
          });
          envVarId = mutationGraph.envVar.create({
            name,
            description,
            secret: secretId,
          });
          return {
            created: true,
            envVarId,
            rotated: true,
            secretId,
            secretVersion: 1,
          } satisfies SaveEnvVarResult & { readonly secretId?: string };
        }

        mutationGraph.envVar.update(envVarId, {
          name,
          description,
        });

        if (shouldRotateSecret) {
          if (!secretId) {
            secretId = mutationGraph.secretRef.create({
              name: buildSecretReferenceName(name),
              version: 1,
              lastRotatedAt: new Date(),
            });
            mutationGraph.envVar.update(envVarId, { secret: secretId });
            secretVersion = 1;
          } else {
            const nextVersion = (mutationGraph.secretRef.get(secretId)?.version ?? 0) + 1;
            mutationGraph.secretRef.update(secretId, {
              name: buildSecretReferenceName(name),
              version: nextVersion,
              lastRotatedAt: new Date(),
            });
            secretVersion = nextVersion;
          }
        } else if (secretId) {
          mutationGraph.secretRef.update(secretId, {
            name: buildSecretReferenceName(name),
          });
          secretVersion = mutationGraph.secretRef.get(secretId)?.version;
        }

        return {
          created: false,
          envVarId,
          rotated: shouldRotateSecret,
          secretId,
          secretVersion,
        } satisfies SaveEnvVarResult & { readonly secretId?: string };
      },
    );

    const nextSecretValues = new Map(secretValuesRef.current);
    if (secretValue !== undefined && planned.result.secretId) {
      nextSecretValues.set(planned.result.secretId, secretValue);
    }

    if (planned.changed) {
      const previousSecretValues = secretValuesRef.current;
      secretValuesRef.current = nextSecretValues;
      try {
        await authority.applyTransaction(planned.transaction);
      } catch (error) {
        secretValuesRef.current = previousSecretValues;
        throw error;
      }
    }

    return {
      created: planned.result.created,
      envVarId: planned.result.envVarId,
      rotated: planned.result.rotated,
      secretVersion: planned.result.secretVersion,
    };
  }

  return {
    snapshotPath,
    ...authority,
    saveEnvVar,
  };
}
