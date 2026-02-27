import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { createStore } from "./store";

export function createExampleRuntime() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);

  const graph = createTypeClient(store, app);

  const acme = graph.company.create({
    name: "Acme Corp",
    status: app.status.values.active.id,
    foundedYear: 1987,
    createdAt: new Date(),
    website: new URL("https://acme.com"),
    tags: ["enterprise", "saas"],
  });

  const estii = graph.company.create({
    name: "Estii",
    status: app.status.values.paused.id,
    website: new URL("https://estii.com"),
  });

  const alice = graph.person.create({
    name: "Alice",
    worksAt: [acme, estii],
  });

  graph.company.node(acme).update({
    tags: ["enterprise", "ai"],
  });

  return {
    store,
    graph,
    app,
    ids: { acme, estii, alice },
  };
}
