import { app } from "./app"
import { bootstrap } from "./bootstrap"
import { createTypeClient } from "./client"
import { core } from "./core"
import { createStore } from "./store"
import { createSyncedTypeClient, createTotalSyncPayload } from "./sync"

function createExampleAuthorityGraph() {
  const store = createStore()
  bootstrap(store, core)
  bootstrap(store, app)

  const graph = createTypeClient(store, app)

  const acme = graph.company.create({
    name: "Acme Corp",
    status: app.status.values.active.id,
    foundedYear: 1987,
    createdAt: new Date(),
    website: new URL("https://acme.com"),
    tags: ["enterprise", "saas"],
    address: {
      address_line1: "200 George St",
      locality: "Sydney",
      postal_code: "2000",
    },
  })

  const estii = graph.company.create({
    name: "Estii",
    status: app.status.values.paused.id,
    website: new URL("https://estii.com"),
  })

  const alice = graph.person.create({
    name: "Alice",
    worksAt: [acme],
  })

  graph.company.node(acme).update({
    tags: ["enterprise", "ai"],
  })

  return {
    store,
    ids: { acme, estii, alice },
  }
}

export function createExampleRuntime() {
  const authority = createExampleAuthorityGraph()
  const runtime = createSyncedTypeClient(app, {
    pull: () => createTotalSyncPayload(authority.store, { cursor: "example:initial" }),
  })

  runtime.sync.apply(createTotalSyncPayload(authority.store, { cursor: "example:initial" }))

  return {
    ...runtime,
    app,
    ids: authority.ids,
  }
}
