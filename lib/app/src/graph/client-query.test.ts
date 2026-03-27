import { describe, expect, it } from "bun:test";

import { edgeId, type EdgeOutput, typeId } from "@io/app/graph";
import { core } from "@io/graph-module-core";

import { createTestGraph, testNamespace } from "./test-graph.js";

function setupGraph() {
  const { store, graph, coreGraph } = createTestGraph();
  const enterpriseTagId = coreGraph.tag.create({
    name: "Enterprise",
    key: "enterprise",
    color: "#6366f1",
  });
  const aiTagId = coreGraph.tag.create({
    name: "AI",
    key: "ai",
    color: "#f59e0b",
  });
  const reviewerAId = graph.person.create({
    name: "Alice",
    email: "alice@example.com",
    status: testNamespace.status.values.inReview.id,
  });
  const reviewerBId = graph.person.create({
    name: "Bob",
    email: "bob@example.com",
    status: testNamespace.status.values.approved.id,
  });
  const rootRecordId = graph.record.create({
    name: "Root",
    headline: "KS-ROOT",
    status: testNamespace.status.values.draft.id,
    score: 10,
    estimate: 180_000,
    contact: {
      email: "root@example.com",
    },
    tags: [enterpriseTagId],
  });
  const childRecordId = graph.record.create({
    name: "Child",
    headline: "KS-CHILD",
    status: testNamespace.status.values.inReview.id,
    score: 20,
    estimate: 300_000,
    parent: rootRecordId,
    reviewers: [reviewerAId, reviewerBId],
    contact: {
      email: "child@example.com",
    },
    tags: [enterpriseTagId, aiTagId],
  });

  return {
    store,
    graph,
    ids: {
      aiTagId,
      childRecordId,
      enterpriseTagId,
      reviewerAId,
      reviewerBId,
      rootRecordId,
    },
  };
}

describe("typed query client", () => {
  it("projects the exact selected shape across scalar, field-group, many-ref, and optional-ref paths", async () => {
    const { graph, ids } = setupGraph();

    const record = await graph.record.query({
      where: { id: ids.childRecordId },
      select: {
        id: true,
        name: true,
        score: true,
        contact: {
          email: true,
        },
        reviewers: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        parent: {
          select: {
            id: true,
            headline: true,
          },
        },
      },
    });
    const root = await graph.record.query({
      where: { id: ids.rootRecordId },
      select: {
        id: true,
        parent: {
          select: {
            id: true,
          },
        },
      },
    });
    const recordsWithRawIds = await graph.record.query({
      select: {
        name: true,
        tags: true,
      },
    });

    expect(record).toEqual({
      id: ids.childRecordId,
      name: "Child",
      score: 20,
      contact: {
        email: "child@example.com",
      },
      reviewers: [
        {
          id: ids.reviewerAId,
          name: "Alice",
          email: "alice@example.com",
        },
        {
          id: ids.reviewerBId,
          name: "Bob",
          email: "bob@example.com",
        },
      ],
      parent: {
        id: ids.rootRecordId,
        headline: "KS-ROOT",
      },
    });
    expect(root).toEqual({
      id: ids.rootRecordId,
      parent: undefined,
    });
    expect(recordsWithRawIds).toEqual([
      {
        name: "Root",
        tags: [ids.enterpriseTagId],
      },
      {
        name: "Child",
        tags: [ids.enterpriseTagId, ids.aiTagId],
      },
    ]);
  });

  it("returns undefined for a missing single id and preserves input order for id lists", async () => {
    const { graph, ids } = setupGraph();

    const missing = await graph.record.query({
      where: { id: "missing-record" },
      select: {
        id: true,
        name: true,
      },
    });
    const ordered = await graph.record.query({
      where: { ids: [ids.childRecordId, "missing-record", ids.rootRecordId] },
      select: {
        id: true,
        name: true,
      },
    });

    expect(missing).toBeUndefined();
    expect(ordered).toEqual([
      {
        id: ids.childRecordId,
        name: "Child",
      },
      {
        id: ids.rootRecordId,
        name: "Root",
      },
    ]);
  });

  it("rejects when a selected required predicate is missing from local data", async () => {
    const { store, graph } = setupGraph();
    const brokenRecordId = store.newId();

    store.assert(
      brokenRecordId,
      edgeId(core.node.fields.type as EdgeOutput),
      typeId(testNamespace.record),
    );
    store.assert(brokenRecordId, edgeId(testNamespace.record.fields.name), "Broken Record");

    await expect(
      graph.record.query({
        where: { id: brokenRecordId },
        select: {
          id: true,
          headline: true,
        },
      }),
    ).rejects.toThrow(`Missing required predicate "${testNamespace.record.fields.headline.key}"`);
  });

  it("rejects nested entity selections when a referenced entity is missing", async () => {
    const { store, graph } = setupGraph();
    const missingPersonId = "missing-person";
    const danglingRecordId = store.newId();
    store.assert(
      danglingRecordId,
      edgeId(core.node.fields.type as EdgeOutput),
      typeId(testNamespace.record),
    );
    store.assert(danglingRecordId, edgeId(testNamespace.record.fields.name), "Dangling");
    store.assert(
      danglingRecordId,
      edgeId(testNamespace.record.fields.owner as EdgeOutput),
      missingPersonId,
    );
    store.assert(danglingRecordId, edgeId(testNamespace.record.fields.headline), "KS-DANGLING");
    store.assert(
      danglingRecordId,
      edgeId(testNamespace.record.fields.status),
      testNamespace.status.values.draft.id,
    );
    store.assert(danglingRecordId, edgeId(testNamespace.record.fields.score), "10");

    await expect(
      graph.record.query({
        where: { id: danglingRecordId },
        select: {
          id: true,
          owner: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ).rejects.toThrow(
      `Missing entity "${missingPersonId}" for type "${testNamespace.person.values.key}"`,
    );
  });
});
