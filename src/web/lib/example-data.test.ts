import { expect, test } from "bun:test";

import { bootstrap, createStore, createTypeClient } from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import { pkm } from "@io/core/graph/modules/pkm";
import { topicKind } from "@io/core/graph/modules/pkm/topic";

import { seedExampleGraph } from "./example-data.js";

const productGraph = { ...core, ...pkm, ...ops } as const;

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? value.key;
}

test("seedExampleGraph backfills workflow data without duplicating older example topics", () => {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, pkm);
  bootstrap(store, ops);
  const graph = createTypeClient(store, productGraph);

  const graphTag = graph.tag.create({
    color: "#0ea5e9",
    key: "graph",
    name: "Graph",
  });
  const docsTag = graph.tag.create({
    color: "#f59e0b",
    key: "docs",
    name: "Docs",
  });
  const graphExplorer = graph.topic.create({
    content: "Shared explorer surface for the canonical product graph.",
    kind: resolvedEnumValue(topicKind.values.module),
    name: "Graph Explorer",
    isArchived: false,
    order: 1,
    slug: "graph-explorer",
    tags: [graphTag, docsTag],
  });
  graph.topic.create({
    content: "Total snapshots bootstrap clients before ordered incremental updates.",
    kind: resolvedEnumValue(topicKind.values.workflow),
    name: "Runtime Sync",
    isArchived: false,
    order: 2,
    parent: graphExplorer,
    references: [graphExplorer],
    tags: [graphTag],
  });
  graph.topic.create({
    content: "Rotate env-var secrets through authority-only commands.",
    kind: resolvedEnumValue(topicKind.values.runbook),
    name: "Secret Rotation",
    isArchived: false,
    order: 3,
    parent: graphExplorer,
    references: [graphExplorer],
    tags: [docsTag],
  });

  const first = seedExampleGraph(graph);
  const second = seedExampleGraph(graph);

  expect(first).toEqual(second);
  expect(first.graphTag).toBe(graphTag);
  expect(first.docsTag).toBe(docsTag);
  expect(first.graphExplorer).toBe(graphExplorer);
  expect(graph.tag.list()).toHaveLength(2);
  expect(graph.topic.list()).toHaveLength(3);
  expect(graph.workflowProject.list()).toHaveLength(1);
  expect(graph.workflowRepository.list()).toHaveLength(1);
  expect(graph.workflowBranch.list()).toHaveLength(1);
  expect(graph.workflowCommit.list()).toHaveLength(1);
  expect(graph.repositoryBranch.list()).toHaveLength(1);
  expect(graph.repositoryCommit.list()).toHaveLength(1);
  expect(graph.agentSession.list()).toHaveLength(1);
});
