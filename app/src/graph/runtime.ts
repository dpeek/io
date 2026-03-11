import { app } from "./app"
import { bootstrap } from "./bootstrap"
import { createTypeClient } from "./client"
import { core } from "./core"
import { seedExampleGraph } from "./example-data"
import { createStore, type StoreSnapshot } from "./store"
import {
  createAuthoritativeGraphWriteSession,
  createSyncedTypeClient,
  createTotalSyncPayload,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type SyncedTypeClient,
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

function createGraphWriteTransactionFromSnapshots(
  before: StoreSnapshot,
  after: StoreSnapshot,
  txId: string,
): GraphWriteTransaction {
  const beforeEdgeIds = new Set(before.edges.map((edge) => edge.id))
  const beforeRetractedIds = new Set(before.retracted)

  return {
    id: txId,
    ops: [
      ...after.retracted
        .filter((edgeId) => !beforeRetractedIds.has(edgeId))
        .map((edgeId) => ({
          op: "retract" as const,
          edgeId,
        })),
      ...after.edges
        .filter((edge) => !beforeEdgeIds.has(edge.id))
        .map((edge) => ({
          op: "assert" as const,
          edge: { ...edge },
        })),
    ],
  }
}

export type ExampleSyncedClient = SyncedTypeClient<typeof app>

export function createExampleRuntime() {
  const authority = createExampleAuthorityGraph()
  const writes = createAuthoritativeGraphWriteSession(authority.store, app, {
    cursorPrefix: "example:",
  })
  const clients = new Set<ExampleSyncedClient>()
  let syncPayloadCount = 0

  function createSyncPayload(): TotalSyncPayload {
    syncPayloadCount += 1
    return createTotalSyncPayload(authority.store, {
      cursor: writes.getCursor() ?? "example:initial",
    })
  }

  function createClient(): ExampleSyncedClient {
    const client = createSyncedTypeClient(app, {
      pull: () => createSyncPayload(),
    })
    client.sync.apply(createSyncPayload())
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
  ): AuthoritativeGraphWriteResult {
    const before = client.store.snapshot()
    mutate(client.graph)
    const transaction = createGraphWriteTransactionFromSnapshots(before, client.store.snapshot(), txId)

    if (transaction.ops.length === 0) {
      throw new Error(`Local mutation for "${txId}" did not change the graph.`)
    }

    return applyAuthoritativeWrite(writes.apply(transaction))
  }

  function createPeer(): ExampleSyncedClient {
    return createClient()
  }

  const runtime = createClient()

  return {
    ...runtime,
    app,
    ids: authority.ids,
    createPeer,
    commitLocalMutation,
    applyAuthoritativeWrite,
    authority: {
      ...authority,
      createSyncPayload,
      writes,
      getSyncPayloadCount() {
        return syncPayloadCount
      },
    },
  }
}
