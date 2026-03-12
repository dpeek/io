import { app } from "./app"
import { bootstrap } from "./bootstrap"
import { createTypeClient } from "./client"
import { core } from "./core"
import { seedExampleGraph } from "./example-data"
import { createStore } from "./store"
import {
  createAuthoritativeGraphWriteSession,
  createSyncedTypeClient,
  createTotalSyncPayload,
  type GraphWriteTransaction,
  type IncrementalSyncResult,
  type AuthoritativeGraphWriteResult,
  type SyncedTypeClient,
  type SyncFreshness,
  type TotalSyncPayload,
} from "./sync"

function createExampleAuthorityGraph() {
  const store = createStore()
  bootstrap(store, core)
  bootstrap(store, app)

  const graph = createTypeClient(store, app)
  const ids = seedExampleGraph(graph)

  return {
    store,
    graph,
    ids,
  }
}

export type ExampleSyncedClient = SyncedTypeClient<typeof app>

export function createExampleRuntime() {
  const authority = createExampleAuthorityGraph()
  let writes = createAuthoritativeGraphWriteSession(authority.store, app, {
    cursorPrefix: "example:",
  })
  const clients = new Set<ExampleSyncedClient>()
  const pendingTxIds = new WeakMap<ExampleSyncedClient, string[]>()
  let syncPayloadCount = 0

  function createSyncPayload(): TotalSyncPayload {
    syncPayloadCount += 1
    return createTotalSyncPayload(authority.store, {
      cursor: writes.getCursor() ?? writes.getBaseCursor(),
    })
  }

  function getIncrementalSyncResult(
    after?: string,
    options?: {
      freshness?: SyncFreshness
    },
  ): IncrementalSyncResult {
    return writes.getIncrementalSyncResult(after, options)
  }

  function applyTransaction(
    transaction: GraphWriteTransaction,
  ): AuthoritativeGraphWriteResult {
    return writes.apply(transaction)
  }

  function resetAuthorityStream(cursorPrefix = "reset:"): string {
    writes = createAuthoritativeGraphWriteSession(authority.store, app, {
      cursorPrefix,
    })
    return writes.getBaseCursor()
  }

  function createClient(): ExampleSyncedClient {
    let client: ExampleSyncedClient
    const queuedTxIds: string[] = []
    client = createSyncedTypeClient(app, {
      pull: (state) =>
        state.cursor
          ? getIncrementalSyncResult(state.cursor)
          : createSyncPayload(),
      createTxId() {
        return queuedTxIds.shift() ?? "example:local"
      },
      push: applyTransaction,
    })
    client.sync.apply(createSyncPayload())
    pendingTxIds.set(client, queuedTxIds)
    clients.add(client)
    return client
  }

  function applyAuthoritativeWrite(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult {
    for (const client of clients) {
      client.sync.applyWriteResult(result)
    }
    return result
  }

  function commitLocalMutation(
    client: ExampleSyncedClient,
    txId: string,
    mutate: (graph: ExampleSyncedClient["graph"]) => void,
  ): Promise<AuthoritativeGraphWriteResult> {
    pendingTxIds.get(client)?.push(txId)
    mutate(client.graph)
    if (client.sync.getPendingTransactions().length === 0) {
      throw new Error(`Local mutation for "${txId}" did not change the graph.`)
    }

    return client.sync.flush().then((results) => {
      const result = results[results.length - 1]
      if (!result) throw new Error('Expected synced flush to return an authoritative write result.')
      return result
    })
  }

  function createPeer(): ExampleSyncedClient {
    return createClient()
  }

  const runtime = createClient()
  return Object.assign(runtime, {
    app,
    ids: authority.ids,
    createPeer,
    commitLocalMutation,
    applyAuthoritativeWrite,
    authority: {
      ...authority,
      applyTransaction,
      createSyncPayload,
      getIncrementalSyncResult,
      resetAuthorityStream,
      getBaseCursor() {
        return writes.getBaseCursor()
      },
      getSyncPayloadCount() {
        return syncPayloadCount
      },
    },
  })
}
