import { expect, test } from "bun:test";

import { createStore } from "@io/core/graph";
import { core, coreGraphBootstrapOptions } from "@io/core/graph/modules";
import { workflow } from "@io/core/graph/modules/workflow";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";

import { seedExampleGraph } from "./example-data.js";

const productGraph = { ...core, ...workflow } as const;

test("seedExampleGraph backfills workflow data without duplicating older example documents", () => {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, workflow, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, productGraph);

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
  const graphExplorer = graph.document.create({
    description: "Shared explorer surface for the canonical product graph.",
    name: "Graph Explorer",
    isArchived: false,
    slug: "graph-explorer",
    tags: [graphTag, docsTag],
  });
  graph.document.create({
    description: "Total snapshots bootstrap clients before ordered incremental updates.",
    name: "Runtime Sync",
    isArchived: false,
    slug: "runtime-sync",
    tags: [graphTag],
  });
  graph.document.create({
    description: "Rotate env-var secrets through authority-only commands.",
    name: "Secret Rotation",
    isArchived: false,
    slug: "secret-rotation",
    tags: [docsTag],
  });

  const first = seedExampleGraph(graph);
  const second = seedExampleGraph(graph);

  expect(first).toEqual(second);
  expect(first.graphTag).toBe(graphTag);
  expect(first.docsTag).toBe(docsTag);
  expect(first.graphExplorer).toBe(graphExplorer);
  expect(graph.tag.list()).toHaveLength(2);
  expect(graph.document.list()).toHaveLength(4);
  expect(graph.document.list().some((document) => document.slug === "workflow-shell-goal")).toBe(
    true,
  );
  expect(graph.documentPlacement.list()).toHaveLength(3);
  expect(graph.documentBlock.list()).toHaveLength(3);
  expect(graph.project.list()).toHaveLength(1);
  expect(graph.repository.list()).toHaveLength(1);
  expect(graph.branch.list()).toHaveLength(1);
  expect(graph.commit.list()).toHaveLength(1);
  expect(graph.repositoryBranch.list()).toHaveLength(1);
  expect(graph.repositoryCommit.list()).toHaveLength(1);
  expect(graph.agentSession.list()).toHaveLength(1);
});
