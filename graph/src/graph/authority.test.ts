import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { bootstrap } from "./bootstrap"
import {
  createJsonPersistedAuthoritativeGraphStorage,
  createPersistedAuthoritativeGraph,
  type LoadedPersistedAuthoritativeGraphState,
  type PersistedAuthoritativeGraphState,
  type PersistedAuthoritativeGraphStorage,
} from "./authority"
import { createTypeClient } from "./client"
import { core } from "./core"
import { createIdMap, defineNamespace } from "./identity"
import { defineType, edgeId } from "./schema"
import { createStore } from "./store"
import type { AuthoritativeGraphWriteResult, GraphWriteTransaction } from "./sync"

const tempDirs: string[] = []
let testCursorEpoch = 0

const item = defineType({
  values: { key: "test:item", name: "Item" },
  fields: {
    ...core.node.fields,
  },
})

const testGraph = defineNamespace(createIdMap({ item }).map, { item })

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createTestCursorPrefix(): string {
  testCursorEpoch += 1
  return `persisted:test:${testCursorEpoch}:`
}

async function createTempSnapshotPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "io-graph-authority-"))
  tempDirs.push(dir)
  return join(dir, "graph.snapshot.json")
}

async function readPersistedAuthorityState(
  snapshotPath: string,
): Promise<PersistedAuthoritativeGraphState> {
  return JSON.parse(await readFile(snapshotPath, "utf8")) as PersistedAuthoritativeGraphState
}

function createItemNameWriteTransaction(
  store: ReturnType<typeof createStore>,
  itemId: string,
  name: string,
  txId: string,
): GraphWriteTransaction {
  return {
    id: txId,
    ops: [
      ...store.facts(itemId, edgeId(testGraph.item.fields.name)).map((edge) => ({
        op: "retract" as const,
        edgeId: edge.id,
      })),
      {
        op: "assert" as const,
        edge: {
          id: store.newNode(),
          s: itemId,
          p: edgeId(testGraph.item.fields.name),
          o: name,
        },
      },
    ],
  }
}

async function createJsonAuthority(
  snapshotPath: string,
  options: {
    seedName?: string
  } = {},
) {
  const store = createStore()
  bootstrap(store, core)
  bootstrap(store, testGraph)

  return createPersistedAuthoritativeGraph(store, testGraph, {
    storage: createJsonPersistedAuthoritativeGraphStorage(snapshotPath, testGraph),
    seed(graph) {
      if (!options.seedName) return
      graph.item.create({ name: options.seedName })
    },
    createCursorPrefix: createTestCursorPrefix,
  })
}

function createMemoryStorage() {
  let current: PersistedAuthoritativeGraphState | null = null
  let failNextSave = false

  const storage: PersistedAuthoritativeGraphStorage = {
    async load(): Promise<LoadedPersistedAuthoritativeGraphState | null> {
      if (!current) return null
      return {
        snapshot: cloneJson(current.snapshot),
        writeHistory: cloneJson(current.writeHistory),
        needsRewrite: false,
      }
    },
    async save(state: PersistedAuthoritativeGraphState): Promise<void> {
      if (failNextSave) {
        failNextSave = false
        throw new Error("persist failed")
      }
      current = cloneJson(state)
    },
  }

  return {
    storage,
    getCurrent() {
      return current ? cloneJson(current) : null
    },
    failOnNextSave() {
      failNextSave = true
    },
  }
}

afterEach(async () => {
  testCursorEpoch = 0
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe("persisted authoritative graph", () => {
  it("seeds and persists the snapshot with empty write history when no file exists", async () => {
    const snapshotPath = await createTempSnapshotPath()

    const authority = await createJsonAuthority(snapshotPath, { seedName: "Seeded Item" })
    const persistedState = await readPersistedAuthorityState(snapshotPath)
    const persistedFiles = await readdir(dirname(snapshotPath))
    const payload = authority.createSyncPayload()

    expect(authority.graph.item.list().map((entity) => entity.name)).toEqual(["Seeded Item"])
    expect(persistedState.version).toBe(1)
    expect(persistedState.snapshot.edges.length).toBeGreaterThan(0)
    expect(persistedState.snapshot.retracted.length).toBeGreaterThanOrEqual(0)
    expect(persistedState.writeHistory.baseSequence).toBe(0)
    expect(persistedState.writeHistory.results).toEqual([])
    expect(payload.cursor).toBe(`${persistedState.writeHistory.cursorPrefix}0`)
    expect(persistedFiles).toEqual(["graph.snapshot.json"])
  })

  it("loads a legacy snapshot file, rewrites the persisted format, and preserves snapshot data", async () => {
    const snapshotPath = await createTempSnapshotPath()
    const store = createStore()
    bootstrap(store, core)
    bootstrap(store, testGraph)
    const graph = createTypeClient(store, testGraph)

    graph.item.create({ name: "Persisted Only Item" })
    await writeFile(snapshotPath, JSON.stringify(store.snapshot(), null, 2) + "\n", "utf8")

    const authority = await createJsonAuthority(snapshotPath)
    const persistedState = await readPersistedAuthorityState(snapshotPath)
    const restarted = await createJsonAuthority(snapshotPath)

    expect(authority.graph.item.list().map((entity) => entity.name)).toEqual(["Persisted Only Item"])
    expect(persistedState.version).toBe(1)
    expect(persistedState.writeHistory.results).toEqual([])
    expect(restarted.createSyncPayload().cursor).toBe(authority.createSyncPayload().cursor)
  })

  it("persists accepted transactions in order and resumes cursor progression after restart", async () => {
    const snapshotPath = await createTempSnapshotPath()
    const authority = await createJsonAuthority(snapshotPath, { seedName: "Durable Item" })
    const itemId = authority.graph.item.list()[0]?.id
    if (!itemId) throw new Error("Expected seeded item.")

    const initialCursor = authority.createSyncPayload().cursor
    const first = await authority.applyTransaction(
      createItemNameWriteTransaction(authority.store, itemId, "Durable Item One", "tx:1"),
    )
    const persistedState = await readPersistedAuthorityState(snapshotPath)
    const restarted = await createJsonAuthority(snapshotPath)
    const restartedCursor = restarted.createSyncPayload().cursor
    const second = await restarted.applyTransaction(
      createItemNameWriteTransaction(restarted.store, itemId, "Durable Item Two", "tx:2"),
    )

    expect(first).toMatchObject({
      txId: "tx:1",
      replayed: false,
      cursor: `${persistedState.writeHistory.cursorPrefix}1`,
    })
    expect(authority.getChangesAfter(initialCursor)).toEqual({
      kind: "changes",
      cursor: first.cursor,
      changes: [first],
    })
    expect(persistedState.writeHistory.results).toEqual([first])
    expect(restartedCursor).toBe(first.cursor)
    expect(restarted.getChangesAfter(initialCursor)).toEqual({
      kind: "changes",
      cursor: second.cursor,
      changes: [first, second],
    })
    expect(restarted.getIncrementalSyncResult(initialCursor)).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: initialCursor,
      transactions: [first, second],
      cursor: second.cursor,
      completeness: "complete",
      freshness: "current",
    })
    expect(second).toMatchObject({
      txId: "tx:2",
      replayed: false,
      cursor: `${persistedState.writeHistory.cursorPrefix}2`,
    })
    expect(restarted.getChangesAfter(first.cursor)).toEqual({
      kind: "changes",
      cursor: second.cursor,
      changes: [second],
    })
    expect(restarted.graph.item.get(itemId).name).toBe("Durable Item Two")
  })

  it("falls back to a reset when persisted write history cannot be replayed", async () => {
    const snapshotPath = await createTempSnapshotPath()
    const store = createStore()
    bootstrap(store, core)
    bootstrap(store, testGraph)
    const graph = createTypeClient(store, testGraph)

    const itemId = graph.item.create({ name: "Broken History Item" })
    const brokenResult: AuthoritativeGraphWriteResult = {
      txId: "tx:1",
      cursor: "persisted:broken:2",
      replayed: false,
      transaction: createItemNameWriteTransaction(store, itemId, "Broken History Item Two", "tx:1"),
    }

    await writeFile(
      snapshotPath,
      JSON.stringify(
        {
          version: 1,
          snapshot: store.snapshot(),
          writeHistory: {
            cursorPrefix: "persisted:broken:",
            baseSequence: 0,
            results: [brokenResult],
          },
        } satisfies PersistedAuthoritativeGraphState,
        null,
        2,
      ) + "\n",
      "utf8",
    )

    const authority = await createJsonAuthority(snapshotPath)
    const rewrittenState = await readPersistedAuthorityState(snapshotPath)
    const payload = authority.createSyncPayload()

    expect(authority.graph.item.list().map((entity) => entity.name)).toEqual(["Broken History Item"])
    expect(payload.cursor).toBe(`${rewrittenState.writeHistory.cursorPrefix}0`)
    expect(payload.cursor).not.toBe("persisted:broken:0")
    expect(authority.getChangesAfter("persisted:broken:2")).toEqual({
      kind: "reset",
      cursor: payload.cursor,
      changes: [],
    })
    expect(rewrittenState.writeHistory.results).toEqual([])
  })

  it("rolls back the in-memory authority when persisting an accepted transaction fails", async () => {
    const storage = createMemoryStorage()
    const store = createStore()
    bootstrap(store, core)
    bootstrap(store, testGraph)
    const authority = await createPersistedAuthoritativeGraph(store, testGraph, {
      storage: storage.storage,
      seed(graph) {
        graph.item.create({ name: "Rollback Item" })
      },
      createCursorPrefix: createTestCursorPrefix,
    })
    const itemId = authority.graph.item.list()[0]?.id
    if (!itemId) throw new Error("Expected seeded item.")

    const previousPersistedState = storage.getCurrent()
    const previousCursor = authority.createSyncPayload().cursor
    storage.failOnNextSave()

    await expect(
      authority.applyTransaction(
        createItemNameWriteTransaction(authority.store, itemId, "Rollback Failed", "tx:1"),
      ),
    ).rejects.toThrow("persist failed")

    expect(storage.getCurrent()).toEqual(previousPersistedState)
    expect(authority.createSyncPayload().cursor).toBe(previousCursor)
    expect(authority.graph.item.get(itemId).name).toBe("Rollback Item")
    expect(authority.getChangesAfter(previousCursor)).toEqual({
      kind: "changes",
      cursor: previousCursor,
      changes: [],
    })
  })

  it("rolls back the reset cursor change when snapshot persistence fails", async () => {
    const storage = createMemoryStorage()
    const store = createStore()
    bootstrap(store, core)
    bootstrap(store, testGraph)
    const authority = await createPersistedAuthoritativeGraph(store, testGraph, {
      storage: storage.storage,
      seed(graph) {
        graph.item.create({ name: "Reset Item" })
      },
      createCursorPrefix: createTestCursorPrefix,
    })
    const itemId = authority.graph.item.list()[0]?.id
    if (!itemId) throw new Error("Expected seeded item.")

    authority.graph.item.update(itemId, { name: "Reset Item Updated" })
    const previousPersistedState = storage.getCurrent()
    const previousCursor = authority.createSyncPayload().cursor
    storage.failOnNextSave()

    await expect(authority.persist()).rejects.toThrow("persist failed")

    expect(storage.getCurrent()).toEqual(previousPersistedState)
    expect(authority.createSyncPayload().cursor).toBe(previousCursor)
    expect(authority.graph.item.get(itemId).name).toBe("Reset Item Updated")
    expect(authority.getChangesAfter(previousCursor)).toEqual({
      kind: "changes",
      cursor: previousCursor,
      changes: [],
    })
  })
})
