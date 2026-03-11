import { describe, expect, it } from "bun:test";

import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { edgeId, type EdgeOutput, typeId } from "./schema";
import { createStore } from "./store";

function setupGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);
  const graph = createTypeClient(store, app);

  const acmeId = graph.company.create({
    name: "Acme",
    website: new URL("https://acme.com"),
    status: app.status.values.active.id,
    foundedYear: 1987,
    address: {
      locality: "Sydney",
      postal_code: "2000",
    },
  });
  const estiiId = graph.company.create({
    name: "Estii",
    website: new URL("https://estii.com"),
    status: app.status.values.paused.id,
  });
  const aliceId = graph.person.create({
    name: "Alice",
    worksAt: [acmeId, estiiId],
  });
  const rootBlockId = graph.block.create({
    name: "Root",
    text: "Root",
    order: 1,
  });
  const childBlockId = graph.block.create({
    name: "Child",
    text: "Child",
    order: 2,
    parent: rootBlockId,
  });

  return {
    store,
    graph,
    ids: {
      acmeId,
      estiiId,
      aliceId,
      childBlockId,
      rootBlockId,
    },
  };
}

describe("typed query client", () => {
  it("projects the exact selected shape across scalar, field-group, many-ref, and optional-ref paths", async () => {
    const { graph, ids } = setupGraph();

    const person = await graph.person.query({
      where: { id: ids.aliceId },
      select: {
        id: true,
        name: true,
        worksAt: {
          select: {
            id: true,
            name: true,
            foundedYear: true,
            address: {
              locality: true,
            },
          },
        },
      },
    });
    const child = await graph.block.query({
      where: { id: ids.childBlockId },
      select: {
        id: true,
        text: true,
        parent: {
          select: {
            id: true,
            text: true,
          },
        },
      },
    });
    const root = await graph.block.query({
      where: { id: ids.rootBlockId },
      select: {
        id: true,
        parent: {
          select: {
            id: true,
          },
        },
      },
    });
    const peopleWithRawIds = await graph.person.query({
      select: {
        name: true,
        worksAt: true,
      },
    });

    expect(person).toEqual({
      id: ids.aliceId,
      name: "Alice",
      worksAt: [
        {
          id: ids.acmeId,
          name: "Acme",
          foundedYear: 1987,
          address: {
            locality: "Sydney",
          },
        },
        {
          id: ids.estiiId,
          name: "Estii",
          foundedYear: undefined,
          address: {
            locality: undefined,
          },
        },
      ],
    });
    expect(child).toEqual({
      id: ids.childBlockId,
      text: "Child",
      parent: {
        id: ids.rootBlockId,
        text: "Root",
      },
    });
    expect(root).toEqual({
      id: ids.rootBlockId,
      parent: undefined,
    });
    expect(peopleWithRawIds).toEqual([
      {
        name: "Alice",
        worksAt: [ids.acmeId, ids.estiiId],
      },
    ]);
  });

  it("returns undefined for a missing single id and preserves input order for id lists", async () => {
    const { graph, ids } = setupGraph();

    const missing = await graph.company.query({
      where: { id: "missing-company" },
      select: {
        id: true,
        name: true,
      },
    });
    const ordered = await graph.company.query({
      where: { ids: [ids.estiiId, "missing-company", ids.acmeId] },
      select: {
        id: true,
        name: true,
      },
    });

    expect(missing).toBeUndefined();
    expect(ordered).toEqual([
      {
        id: ids.estiiId,
        name: "Estii",
      },
      {
        id: ids.acmeId,
        name: "Acme",
      },
    ]);
  });

  it("rejects when a selected required predicate is missing from local data", async () => {
    const { store, graph } = setupGraph();
    const brokenCompanyId = store.newNode();

    store.assert(brokenCompanyId, edgeId(core.node.fields.type as EdgeOutput), typeId(app.company));
    store.assert(brokenCompanyId, edgeId(app.company.fields.name), "Broken Co");

    await expect(
      graph.company.query({
        where: { id: brokenCompanyId },
        select: {
          id: true,
          website: true,
        },
      }),
    ).rejects.toThrow(`Missing required predicate "${app.company.fields.website.key}"`);
  });

  it("rejects nested entity selections when a referenced entity is missing", async () => {
    const { store, graph } = setupGraph();
    const missingCompanyId = "missing-company";
    const danglingPersonId = store.newNode();
    store.assert(danglingPersonId, edgeId(core.node.fields.type as EdgeOutput), typeId(app.person));
    store.assert(danglingPersonId, edgeId(app.person.fields.name), "Dangling");
    store.assert(danglingPersonId, edgeId(app.person.fields.worksAt as EdgeOutput), missingCompanyId);

    await expect(
      graph.person.query({
        where: { id: danglingPersonId },
        select: {
          id: true,
          worksAt: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ).rejects.toThrow(`Missing entity "${missingCompanyId}" for type "${app.company.values.key}"`);
  });
});
