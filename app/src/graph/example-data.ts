import type { NamespaceClient } from "@io/graph";

import { app } from "./app.js";

export type ExampleGraphIds = {
  readonly acme: string;
  readonly alice: string;
  readonly atlas: string;
  readonly estii: string;
  readonly rootBlock: string;
};

export function seedExampleGraph(graph: NamespaceClient<typeof app>): ExampleGraphIds {
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
  });

  const estii = graph.company.create({
    name: "Estii",
    status: app.status.values.paused.id,
    website: new URL("https://estii.com"),
  });

  const atlas = graph.company.create({
    name: "Atlas Labs",
    status: app.status.values.active.id,
    foundedYear: 2015,
    website: new URL("https://atlas.io"),
  });

  const alice = graph.person.create({
    name: "Alice",
    worksAt: [acme],
  });

  const rootBlock = graph.block.create({
    name: "Untitled",
    text: "Untitled",
    order: 0,
  });

  graph.company.node(acme).update({
    tags: ["enterprise", "ai"],
  });

  return {
    acme,
    alice,
    atlas,
    estii,
    rootBlock,
  };
}
