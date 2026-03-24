/** @jsxImportSource @opentui/react */

import { expect, test } from "bun:test";

import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { act } from "react";

import {
  bootstrap,
  createStore,
  createSyncedTypeClient,
  createTotalSyncPayload,
  createTypeClient,
} from "../../index.js";
import { core, ops } from "../../modules/index.js";
import { useOptionalMutationRuntime } from "../../runtime/react/index.js";
import {
  GraphRuntimeProvider,
  useCommitQueueScope,
  useGraphQuery,
  useGraphRuntime,
  useGraphSyncState,
  useProjectBranchScope,
} from "./index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const productGraph = { ...core, ...ops } as const;

function date(value: string): Date {
  return new Date(value);
}

function createWorkflowRuntimeFixture() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, ops);
  const graph = createTypeClient(store, productGraph);

  const projectId = graph.workflowProject.create({
    name: "IO",
    projectKey: "project:io",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-01T00:00:00.000Z"),
  });
  const branchId = graph.workflowBranch.create({
    name: "Workflow runtime contract",
    project: projectId,
    branchKey: "branch:workflow-runtime-contract",
    state: ops.workflowBranchState.values.active.id,
    queueRank: 1,
    goalSummary: "Define the graph-backed branch board contract.",
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });
  const commitId = graph.workflowCommit.create({
    name: "Define branch board scope",
    branch: branchId,
    commitKey: "commit:define-branch-board-scope",
    state: ops.workflowCommitState.values.active.id,
    order: 1,
    createdAt: date("2026-01-03T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });

  graph.workflowBranch.update(branchId, {
    activeCommit: commitId,
    updatedAt: date("2026-01-05T01:00:00.000Z"),
  });

  const runtime = createSyncedTypeClient(ops, {
    pull: () => createTotalSyncPayload(store, { cursor: "server:workflow:1" }),
  });

  return {
    ids: { branchId, projectId },
    runtime,
  };
}

function WorkflowScopeProbe({ branchId, projectId }: { branchId: string; projectId: string }) {
  const runtime = useGraphRuntime<typeof ops>();
  const syncState = useGraphSyncState<typeof ops>();
  const branchScope = useProjectBranchScope({ projectId });
  const commitQueue = useCommitQueueScope({ branchId });
  const projectCount = useGraphQuery(
    (resolvedRuntime: typeof runtime) => resolvedRuntime.graph.workflowProject.list().length,
  );
  const mutationRuntime = useOptionalMutationRuntime();

  return (
    <box flexDirection="column">
      <text content={`projects:${projectCount}`} />
      <text content={`runtime:${runtime.graph.workflowBranch.list().length}`} />
      <text content={`mutation:${mutationRuntime ? "ready" : "missing"}`} />
      <text content={`pending:${syncState.pendingCount}`} />
      <text
        content={`branches:${branchScope.rows.map((row) => row.workflowBranch.title).join(" | ")}`}
      />
      <text
        content={`commits:${commitQueue.rows.map((row) => row.workflowCommit.title).join(" | ")}`}
      />
    </box>
  );
}

test("react-opentui provider exposes synced workflow scope hooks and query selectors", async () => {
  const { ids, runtime } = createWorkflowRuntimeFixture();
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
            <WorkflowScopeProbe branchId={ids.branchId} projectId={ids.projectId} />
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
      runtime.graph.workflowCommit.create({
        name: "Bind workflow queries",
        branch: ids.branchId,
        commitKey: "commit:bind-workflow-queries",
        state: ops.workflowCommitState.values.ready.id,
        order: 2,
        createdAt: date("2026-01-06T00:00:00.000Z"),
        updatedAt: date("2026-01-06T00:00:00.000Z"),
      });
      await Promise.resolve();
      renderer.requestRender();
      await renderOnce();
    });

    frame = captureCharFrame();
    expect(frame).toContain("pending:1");
    expect(frame).toContain("Bind workflow queries");
  } finally {
    await act(async () => {
      root.unmount();
    });
    renderer.destroy();
  }
});
