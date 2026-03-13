import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { createTypeClient, type NamespaceClient } from "./client"
import type { AnyTypeOutput } from "./schema"
import type { Store, StoreSnapshot } from "./store"
import {
  createAuthoritativeGraphWriteSession,
  createTotalSyncPayload,
  graphSyncScope,
  type AuthoritativeGraphChangesAfterResult,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type IncrementalSyncResult,
  type SyncFreshness,
  type TotalSyncPayload,
  validateAuthoritativeTotalSyncPayload,
} from "./sync"

export type PersistedAuthoritativeGraphState = {
  readonly version: 1
  readonly snapshot: StoreSnapshot
  readonly writeHistory: AuthoritativeGraphWriteHistory
}

export type LoadedPersistedAuthoritativeGraphState = {
  readonly snapshot: StoreSnapshot
  readonly writeHistory?: AuthoritativeGraphWriteHistory
  readonly needsRewrite: boolean
}

export interface PersistedAuthoritativeGraphStorage {
  load(): Promise<LoadedPersistedAuthoritativeGraphState | null>
  save(state: PersistedAuthoritativeGraphState): Promise<void>
}

export type PersistedAuthoritativeGraph<
  T extends Record<string, AnyTypeOutput>,
> = {
  readonly store: Store
  readonly graph: NamespaceClient<T>
  createSyncPayload(
    options?: {
      freshness?: SyncFreshness
    },
  ): ReturnType<typeof createTotalSyncPayload>
  applyTransaction(transaction: GraphWriteTransaction): Promise<AuthoritativeGraphWriteResult>
  getChangesAfter(cursor?: string): AuthoritativeGraphChangesAfterResult
  getIncrementalSyncResult(
    after?: string,
    options?: {
      freshness?: SyncFreshness
    },
  ): IncrementalSyncResult
  persist(): Promise<void>
}

let persistedAuthoritativeGraphCursorEpoch = 0

function createPersistedAuthoritativeGraphCursorPrefix(): string {
  persistedAuthoritativeGraphCursorEpoch = Math.max(
    persistedAuthoritativeGraphCursorEpoch + 1,
    Date.now(),
  )
  return `tx:${persistedAuthoritativeGraphCursorEpoch}:`
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
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
  )
  if (validation.ok) return snapshot

  const messages = validation.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "snapshot"
    return `${path}: ${issue.message}`
  })
  throw new Error(`Invalid persisted authority snapshot in "${source}": ${messages.join(" | ")}`)
}

function readPersistedWriteHistory(rawHistory: unknown): AuthoritativeGraphWriteHistory | undefined {
  if (!isObjectRecord(rawHistory)) return undefined
  const cursorPrefix = rawHistory.cursorPrefix
  const baseSequence = rawHistory.baseSequence
  const results = rawHistory.results
  if (typeof cursorPrefix !== "string") return undefined
  if (typeof baseSequence !== "number" || !Number.isInteger(baseSequence) || baseSequence < 0) {
    return undefined
  }
  if (!Array.isArray(results)) return undefined
  return {
    cursorPrefix,
    baseSequence,
    results: results as AuthoritativeGraphWriteResult[],
  }
}

export function createJsonPersistedAuthoritativeGraphStorage<
  const T extends Record<string, AnyTypeOutput>,
>(
  path: string,
  namespace: T,
): PersistedAuthoritativeGraphStorage {
  async function load(): Promise<LoadedPersistedAuthoritativeGraphState | null> {
    try {
      const rawSnapshot = await readFile(path, "utf8")
      const parsed = JSON.parse(rawSnapshot) as unknown

      if (isObjectRecord(parsed) && parsed.version === 1 && "snapshot" in parsed) {
        const snapshot = validatePersistedSnapshot(parsed.snapshot as StoreSnapshot, path, namespace)
        const writeHistory = readPersistedWriteHistory(parsed.writeHistory)
        return {
          snapshot,
          writeHistory,
          needsRewrite: writeHistory === undefined,
        }
      }

      return {
        snapshot: validatePersistedSnapshot(parsed as StoreSnapshot, path, namespace),
        needsRewrite: true,
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null
      throw error
    }
  }

  async function save(state: PersistedAuthoritativeGraphState): Promise<void> {
    await mkdir(dirname(path), { recursive: true })

    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`

    try {
      await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8")
      await rename(tempPath, path)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  return {
    load,
    save,
  }
}

export async function createPersistedAuthoritativeGraph<
  const T extends Record<string, AnyTypeOutput>,
>(
  store: Store,
  namespace: T,
  options: {
    storage: PersistedAuthoritativeGraphStorage
    seed?: (graph: NamespaceClient<T>) => void | Promise<void>
    createCursorPrefix?: () => string
  },
): Promise<PersistedAuthoritativeGraph<T>> {
  const graph = createTypeClient(store, namespace)
  const createCursorPrefix =
    options.createCursorPrefix ?? createPersistedAuthoritativeGraphCursorPrefix
  const createFreshWriteSession = () =>
    createAuthoritativeGraphWriteSession(store, namespace, {
      cursorPrefix: createCursorPrefix(),
    })
  const createWriteSession = (writeHistory: AuthoritativeGraphWriteHistory) =>
    createAuthoritativeGraphWriteSession(store, namespace, {
      cursorPrefix: writeHistory.cursorPrefix,
      initialSequence: writeHistory.baseSequence,
      history: writeHistory.results,
    })

  let writes = createFreshWriteSession()

  async function saveCurrentState(): Promise<void> {
    await options.storage.save({
      version: 1,
      snapshot: store.snapshot(),
      writeHistory: writes.getHistory(),
    })
  }

  async function persist(): Promise<void> {
    const previousHistory = writes.getHistory()
    writes = createFreshWriteSession()
    try {
      await saveCurrentState()
    } catch (error) {
      writes = createWriteSession(previousHistory)
      throw error
    }
  }

  async function applyTransaction(
    transaction: GraphWriteTransaction,
  ): Promise<AuthoritativeGraphWriteResult> {
    const previousSnapshot = store.snapshot()
    const previousHistory = writes.getHistory()
    const result = writes.apply(transaction)

    try {
      await saveCurrentState()
    } catch (error) {
      store.replace(previousSnapshot)
      writes = createWriteSession(previousHistory)
      throw error
    }

    return result
  }

  const persistedState = await options.storage.load()
  if (persistedState) {
    store.replace(persistedState.snapshot)
    if (persistedState.writeHistory) {
      try {
        writes = createWriteSession(persistedState.writeHistory)
        if (persistedState.needsRewrite) await saveCurrentState()
      } catch {
        writes = createFreshWriteSession()
        await saveCurrentState()
      }
    } else {
      writes = createFreshWriteSession()
      await saveCurrentState()
    }
  } else {
    if (options.seed) await options.seed(graph)
    writes = createFreshWriteSession()
    await saveCurrentState()
  }

  return {
    store,
    graph,
    createSyncPayload(syncOptions = {}) {
      return createTotalSyncPayload(store, {
        cursor: writes.getCursor() ?? writes.getBaseCursor(),
        freshness: syncOptions.freshness ?? "current",
      })
    },
    applyTransaction,
    getChangesAfter(cursor) {
      return writes.getChangesAfter(cursor)
    },
    getIncrementalSyncResult(after, syncOptions) {
      return writes.getIncrementalSyncResult(after, syncOptions)
    },
    persist,
  }
}
