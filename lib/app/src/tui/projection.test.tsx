/** @jsxImportSource @opentui/react */

import { expect, test } from "bun:test";

import { bootstrap } from "@io/graph-bootstrap";
import { createSyncedGraphClient, createGraphClient } from "@io/graph-client";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";
import {
  GraphRuntimeProvider,
  useGraphQuery,
  useGraphRuntime,
  useGraphSyncState,
} from "@io/graph-react";
import { createTotalSyncPayload } from "@io/graph-sync";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { act } from "react";

import { createStore } from "../graph/index.js";
import { useCommitQueueScope, useProjectBranchScope, useWorkflowProjectionIndex } from "./index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const productGraph = { ...core, ...workflow } as const;

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
    state: workflow.branchState.values.active.id,
    queueRank: 1,
    goalDocument: goalDocumentId,
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });
  const commitId = graph.commit.create({
    name: "Define branch board scope",
    branch: branchId,
    commitKey: "commit:define-branch-board-scope",
    state: workflow.commitState.values.active.id,
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
    ids: { branchId, projectId },
    runtime,
  };
}

function WorkflowProjectionProbe({ branchId, projectId }: { branchId: string; projectId: string }) {
  const runtime = useGraphRuntime<typeof productGraph>();
  const syncState = useGraphSyncState<typeof productGraph>();
  const projection = useWorkflowProjectionIndex();
  const branchScope = useProjectBranchScope({ projectId });
  const commitQueue = useCommitQueueScope({ branchId });
  const projectCount = useGraphQuery(
    (resolvedRuntime: typeof runtime) => resolvedRuntime.graph.project.list().length,
  );

  return (
    <box flexDirection="column">
      <text content={`projects:${projectCount}`} />
      <text content={`runtime:${runtime.graph.branch.list().length}`} />
      <text content={`pending:${syncState.pendingCount}`} />
      <text
        content={`projection:${projection.readProjectBranchScope({ projectId }).rows.length}`}
      />
      <text content={`branches:${branchScope.rows.map((row) => row.branch.title).join(" | ")}`} />
      <text content={`commits:${commitQueue.rows.map((row) => row.commit.title).join(" | ")}`} />
    </box>
  );
}

test(
  "workflow-owned projection hooks read synced workflow scopes",
  async () => {
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
              <WorkflowProjectionProbe branchId={ids.branchId} projectId={ids.projectId} />
            </GraphRuntimeProvider>,
          );
        });
        await renderOnce();
      });

      let frame = captureCharFrame();
      expect(frame).toContain("projects:1");
      expect(frame).toContain("runtime:1");
      expect(frame).toContain("pending:0");
      expect(frame).toContain("projection:1");
      expect(frame).toContain("Workflow runtime contract");
      expect(frame).toContain("Define branch board scope");

      await act(async () => {
        graph.commit.create({
          name: "Bind workflow queries",
          branch: ids.branchId,
          commitKey: "commit:bind-workflow-queries",
          state: workflow.commitState.values.ready.id,
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
  },
  { timeout: 10_000 },
);
