/** @jsxImportSource @opentui/react */

import { expect, test } from "vitest";

import { bootstrap } from "@io/graph-bootstrap";
import { createSyncedGraphClient, createGraphClient } from "@io/graph-client";
import {
  applyGraphIdMap as applyIdMap,
  createGraphIdMap as createIdMap,
  createGraphStore as createStore,
} from "@io/graph-kernel";
import type { AnyTypeOutput } from "@io/graph-kernel";
import { defineEnum, defineType } from "@io/graph-module";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";
import { createTotalSyncPayload } from "@io/graph-sync";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { act } from "react";

import { useOptionalMutationRuntime } from "./index.js";
import {
  GraphRuntimeProvider,
  useGraphQuery,
  useGraphRuntime,
  useGraphSyncState,
} from "./index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const branchState = defineEnum({
  values: { key: "test:branch-state", name: "Branch State" },
  options: {
    active: { name: "Active" },
    backlog: { name: "Backlog" },
  },
});

const commitState = defineEnum({
  values: { key: "test:commit-state", name: "Commit State" },
  options: {
    active: { name: "Active" },
    ready: { name: "Ready" },
  },
});

const project = defineType({
  values: { key: "test:project", name: "Project" },
  fields: {
    ...core.node.fields,
    projectKey: {
      range: core.string,
      cardinality: "one",
    },
  },
});

const document = defineType({
  values: { key: "test:document", name: "Document" },
  fields: {
    ...core.node.fields,
  },
});

const branch = defineType({
  values: { key: "test:branch", name: "Branch" },
  fields: {
    ...core.node.fields,
    project: {
      range: "test:project",
      cardinality: "one",
    },
    branchKey: {
      range: core.string,
      cardinality: "one",
    },
    state: {
      range: "test:branch-state",
      cardinality: "one",
    },
    queueRank: {
      range: core.number,
      cardinality: "one",
    },
    goalDocument: {
      range: "test:document",
      cardinality: "one?",
    },
    activeCommit: {
      range: "test:commit",
      cardinality: "one?",
    },
  },
});

const commit = defineType({
  values: { key: "test:commit", name: "Commit" },
  fields: {
    ...core.node.fields,
    branch: {
      range: "test:branch",
      cardinality: "one",
    },
    commitKey: {
      range: core.string,
      cardinality: "one",
    },
    state: {
      range: "test:commit-state",
      cardinality: "one",
    },
    order: {
      range: core.number,
      cardinality: "one",
    },
  },
});

const runtimeSchema = {
  branch,
  branchState,
  commit,
  commitState,
  document,
  project,
} as const satisfies Record<string, AnyTypeOutput>;

const runtimeNamespace = applyIdMap(createIdMap(runtimeSchema).map, runtimeSchema);
const productGraph = { ...core, ...runtimeNamespace } as const;

function date(value: string): Date {
  return new Date(value);
}

function createWorkflowRuntimeFixture() {
  const store = createStore();
  bootstrap(store, productGraph, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, productGraph);

  const projectId = graph.project.create({
    name: "IO",
    projectKey: "project:io",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-01T00:00:00.000Z"),
  });
  const goalDocumentId = graph.document.create({
    name: "Workflow runtime contract goal",
    description: "Define the graph-backed branch board contract.",
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });
  const branchId = graph.branch.create({
    name: "Workflow runtime contract",
    project: projectId,
    branchKey: "branch:workflow-runtime-contract",
    state: runtimeNamespace.branchState.values.active.id,
    queueRank: 1,
    goalDocument: goalDocumentId,
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });
  const commitId = graph.commit.create({
    name: "Define branch board scope",
    branch: branchId,
    commitKey: "commit:define-branch-board-scope",
    state: runtimeNamespace.commitState.values.active.id,
    order: 1,
    createdAt: date("2026-01-03T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });

  graph.branch.update(branchId, {
    activeCommit: commitId,
    updatedAt: date("2026-01-05T01:00:00.000Z"),
  });

  const runtime = createSyncedGraphClient(productGraph, {
    bootstrap: coreGraphBootstrapOptions,
    pull: () => createTotalSyncPayload(store, { cursor: "server:workflow:1" }),
  });

  return {
    graph,
    ids: { branchId },
    runtime,
  };
}

function GraphRuntimeProbe() {
  const runtime = useGraphRuntime<typeof productGraph>();
  const syncState = useGraphSyncState<typeof productGraph>();
  const projectCount = useGraphQuery(
    (resolvedRuntime: typeof runtime) => resolvedRuntime.graph.project.list().length,
  );
  const branchTitles = useGraphQuery((resolvedRuntime: typeof runtime) =>
    resolvedRuntime.graph.branch
      .list()
      .map((branch) => branch.name)
      .join(" | "),
  );
  const commitTitles = useGraphQuery((resolvedRuntime: typeof runtime) =>
    resolvedRuntime.graph.commit
      .list()
      .map((commit) => commit.name)
      .join(" | "),
  );
  const mutationRuntime = useOptionalMutationRuntime();

  return (
    <box flexDirection="column">
      <text content={`projects:${projectCount}`} />
      <text content={`runtime:${runtime.graph.branch.list().length}`} />
      <text content={`mutation:${mutationRuntime ? "ready" : "missing"}`} />
      <text content={`pending:${syncState.pendingCount}`} />
      <text content={`branches:${branchTitles}`} />
      <text content={`commits:${commitTitles}`} />
    </box>
  );
}

test("graph-react provider exposes synced graph query selectors across renderers", async () => {
  const { graph, ids, runtime } = createWorkflowRuntimeFixture();
  await runtime.sync.sync();

  const { captureCharFrame, renderOnce, renderer } = await createTestRenderer({
    height: 24,
    width: 120,
  });
  const root = createRoot(renderer);

  try {
    await act(async () => {
      flushSync(() => {
        root.render(
          <GraphRuntimeProvider runtime={runtime}>
            <GraphRuntimeProbe />
          </GraphRuntimeProvider>,
        );
      });
      await renderOnce();
    });

    let frame = captureCharFrame();
    expect(frame).toContain("projects:1");
    expect(frame).toContain("runtime:1");
    expect(frame).toContain("mutation:ready");
    expect(frame).toContain("pending:0");
    expect(frame).toContain("Workflow runtime contract");
    expect(frame).toContain("Define branch board scope");

    await act(async () => {
      graph.commit.create({
        name: "Bind workflow queries",
        branch: ids.branchId,
        commitKey: "commit:bind-workflow-queries",
        state: runtimeNamespace.commitState.values.ready.id,
        order: 2,
        createdAt: date("2026-01-06T00:00:00.000Z"),
        updatedAt: date("2026-01-06T00:00:00.000Z"),
      });
      await runtime.sync.sync();
      renderer.requestRender();
      await renderOnce();
    });

    frame = captureCharFrame();
    expect(frame).toContain("pending:0");
    expect(frame).toContain("Bind workflow queries");
  } finally {
    await act(async () => {
      root.unmount();
    });
    renderer.destroy();
  }
});
