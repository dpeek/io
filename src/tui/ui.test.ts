import { expect, test } from "bun:test";

import { bootstrap, createStore, createTypeClient } from "@io/core/graph";
import { createTestRenderer } from "@opentui/core/testing";
import { act } from "react";

import { core } from "../graph/modules/core.js";
import { ops } from "../graph/modules/ops.js";
import { createWorkflowProjectionIndex } from "../graph/modules/ops/workflow/query.js";
import { buildWorkflowTuiRootComponentModel } from "./layout.js";
import {
  createWorkflowTuiStartupFailureModel,
  createWorkflowTuiStartupLoadingModel,
  createWorkflowTuiWorkflowModelFromProjection,
} from "./model.js";
import { createWorkflowTui } from "./tui.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const productGraph = { ...core, ...ops } as const;

function date(value: string): Date {
  return new Date(value);
}

function createWorkflowProjectionFixture() {
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
  const repositoryId = graph.workflowRepository.create({
    name: "io",
    project: projectId,
    repositoryKey: "repo:io",
    repoRoot: "/tmp/io",
    defaultBaseBranch: "main",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-02T00:00:00.000Z"),
  });
  const branch1Id = graph.workflowBranch.create({
    name: "Workflow runtime contract",
    project: projectId,
    branchKey: "branch:workflow-runtime-contract",
    state: ops.workflowBranchState.values.active.id,
    queueRank: 1,
    goalSummary: "Define the canonical branch board and commit queue contract.",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });
  const branch2Id = graph.workflowBranch.create({
    name: "Workflow shell polish",
    project: projectId,
    branchKey: "branch:workflow-shell-polish",
    state: ops.workflowBranchState.values.ready.id,
    queueRank: 2,
    goalSummary: "Tighten the first read-only workflow shell.",
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-04T00:00:00.000Z"),
  });

  const branch1Commit1Id = graph.workflowCommit.create({
    name: "Define branch board scope",
    branch: branch1Id,
    commitKey: "commit:define-branch-board-scope",
    state: ops.workflowCommitState.values.committed.id,
    order: 1,
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-02T00:00:00.000Z"),
  });
  const branch1Commit2Id = graph.workflowCommit.create({
    name: "Document commit queue scope",
    branch: branch1Id,
    commitKey: "commit:document-commit-queue-scope",
    state: ops.workflowCommitState.values.active.id,
    order: 2,
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-05T12:00:00.000Z"),
  });
  const branch2Commit1Id = graph.workflowCommit.create({
    name: "Render first workflow screens",
    branch: branch2Id,
    commitKey: "commit:render-first-workflow-screens",
    state: ops.workflowCommitState.values.ready.id,
    order: 1,
    createdAt: date("2026-01-03T00:00:00.000Z"),
    updatedAt: date("2026-01-04T12:00:00.000Z"),
  });
  graph.workflowCommit.create({
    name: "Queue selection rules",
    branch: branch2Id,
    commitKey: "commit:queue-selection-rules",
    state: ops.workflowCommitState.values.planned.id,
    order: 2,
    createdAt: date("2026-01-04T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });

  graph.workflowBranch.update(branch1Id, {
    activeCommit: branch1Commit2Id,
    updatedAt: date("2026-01-06T00:00:00.000Z"),
  });

  const branch1RepositoryBranchId = graph.repositoryBranch.create({
    name: "workflow/runtime-contract",
    project: projectId,
    repository: repositoryId,
    workflowBranch: branch1Id,
    managed: true,
    branchName: "workflow/runtime-contract",
    baseBranchName: "main",
    latestReconciledAt: date("2026-01-05T12:00:00.000Z"),
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-05T12:00:00.000Z"),
  });
  const branch2RepositoryBranchId = graph.repositoryBranch.create({
    name: "workflow/shell-polish",
    project: projectId,
    repository: repositoryId,
    workflowBranch: branch2Id,
    managed: true,
    branchName: "workflow/shell-polish",
    baseBranchName: "main",
    latestReconciledAt: date("2026-01-05T18:00:00.000Z"),
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-05T18:00:00.000Z"),
  });
  graph.repositoryBranch.create({
    name: "observed/fixup",
    project: projectId,
    repository: repositoryId,
    managed: false,
    branchName: "observed/fixup",
    baseBranchName: "main",
    latestReconciledAt: date("2026-01-06T00:00:00.000Z"),
    createdAt: date("2026-01-04T00:00:00.000Z"),
    updatedAt: date("2026-01-06T00:00:00.000Z"),
  });

  graph.repositoryCommit.create({
    name: "Define branch board scope",
    repository: repositoryId,
    repositoryBranch: branch1RepositoryBranchId,
    workflowCommit: branch1Commit1Id,
    state: ops.repositoryCommitState.values.committed.id,
    sha: "abcdef1234567",
    committedAt: date("2026-01-02T12:00:00.000Z"),
    worktree: {
      leaseState: ops.repositoryCommitLeaseState.values.released.id,
    },
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-02T12:00:00.000Z"),
  });
  graph.repositoryCommit.create({
    name: "Document commit queue scope",
    repository: repositoryId,
    repositoryBranch: branch1RepositoryBranchId,
    workflowCommit: branch1Commit2Id,
    state: ops.repositoryCommitState.values.attached.id,
    worktree: {
      path: "/tmp/io-worktree-runtime",
      branchName: "workflow/runtime-contract",
      leaseState: ops.repositoryCommitLeaseState.values.attached.id,
    },
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-05T12:00:00.000Z"),
  });
  graph.repositoryCommit.create({
    name: "Render first workflow screens",
    repository: repositoryId,
    repositoryBranch: branch2RepositoryBranchId,
    workflowCommit: branch2Commit1Id,
    state: ops.repositoryCommitState.values.reserved.id,
    worktree: {
      path: "/tmp/io-worktree-shell",
      branchName: "workflow/shell-polish",
      leaseState: ops.repositoryCommitLeaseState.values.reserved.id,
    },
    createdAt: date("2026-01-03T00:00:00.000Z"),
    updatedAt: date("2026-01-04T12:00:00.000Z"),
  });

  graph.agentSession.create({
    name: "Plan workflow runtime contract",
    project: projectId,
    repository: repositoryId,
    subjectKind: ops.agentSessionSubjectKind.values.branch.id,
    branch: branch1Id,
    sessionKey: "session:workflow-runtime-contract-plan-01",
    kind: ops.agentSessionKind.values.planning.id,
    workerId: "worker-1",
    runtimeState: ops.agentSessionRuntimeState.values.completed.id,
    startedAt: date("2026-01-04T00:00:00.000Z"),
    endedAt: date("2026-01-04T01:00:00.000Z"),
    createdAt: date("2026-01-04T00:00:00.000Z"),
    updatedAt: date("2026-01-04T01:00:00.000Z"),
  });
  graph.agentSession.create({
    name: "Polish workflow shell",
    project: projectId,
    repository: repositoryId,
    subjectKind: ops.agentSessionSubjectKind.values.commit.id,
    branch: branch2Id,
    commit: branch2Commit1Id,
    sessionKey: "session:workflow-shell-polish-execution-01",
    kind: ops.agentSessionKind.values.execution.id,
    workerId: "worker-2",
    runtimeState: ops.agentSessionRuntimeState.values.running.id,
    startedAt: date("2026-01-05T09:30:00.000Z"),
    createdAt: date("2026-01-05T09:30:00.000Z"),
    updatedAt: date("2026-01-05T09:30:00.000Z"),
  });

  return {
    branch1Id,
    branch2Id,
    projectId,
    projection: createWorkflowProjectionIndex(graph, {
      projectedAt: "2026-01-10T00:00:00.000Z",
    }),
  };
}

test("buildWorkflowTuiRootComponentModel renders the startup loading shell", () => {
  const model = createWorkflowTuiStartupLoadingModel({
    entrypointPath: "/Users/dpeek/code/io/io.ts",
    workspaceRoot: "/Users/dpeek/code/io/tmp/workspace",
  });

  const layout = buildWorkflowTuiRootComponentModel(model);
  expect(layout.summaryLines).toEqual([
    "IO Workflow TUI",
    "Loading the graph-backed workflow shell.",
  ]);
  expect(layout.panels.map((panel) => panel.title)).toEqual(["Surface", "Startup", "Boundaries"]);
  expect(layout.panels.find((panel) => panel.id === "surface")?.body).toContain(
    "/Users/dpeek/code/io/tmp/workspace",
  );
  expect(layout.panels.find((panel) => panel.id === "surface")?.body).toContain(
    "http://io.localhost:1355/",
  );
  expect(layout.panels.find((panel) => panel.id === "startup")?.body).toContain(
    "infer the one visible WorkflowProject",
  );
  expect(layout.panels.find((panel) => panel.id === "surface")?.body).toContain(
    "Hydration reads the first project branch board and commit queues",
  );
  expect(layout.panels.find((panel) => panel.id === "boundaries")?.body).toContain(
    "src/graph/adapters/react-opentui",
  );
  expect(layout.panels.find((panel) => panel.id === "boundaries")?.body).toContain(
    "does not launch sessions",
  );
  expect(layout.footerLines).toContain("Legacy session monitor: io agent tui");
});

test("buildWorkflowTuiRootComponentModel renders the startup failure shell", () => {
  const layout = buildWorkflowTuiRootComponentModel(
    createWorkflowTuiStartupFailureModel({
      entrypointPath: "/Users/dpeek/code/io/io.ts",
      error: new Error("Sync request failed with 503 Service Unavailable."),
      workspaceRoot: "/Users/dpeek/code/io/tmp/workspace",
    }),
  );

  expect(layout.summaryLines).toEqual([
    "IO Workflow TUI",
    "Unable to load the graph-backed workflow shell.",
  ]);
  expect(layout.panels.map((panel) => panel.title)).toEqual(["Surface", "Startup", "Failure"]);
  expect(layout.panels.find((panel) => panel.id === "failure")?.body).toContain(
    "Sync request failed with 503 Service Unavailable.",
  );
  expect(layout.panels.find((panel) => panel.id === "failure")?.body).toContain(
    "presented in the TUI",
  );
  expect(layout.footerLines.some((line) => line.includes("Status: startup failed."))).toBe(true);
});

test("buildWorkflowTuiRootComponentModel renders workflow branch board, detail, and commit queue panels", () => {
  const { projectId, projection } = createWorkflowProjectionFixture();
  const model = createWorkflowTuiWorkflowModelFromProjection({
    projection,
    projectId,
  });

  const layout = buildWorkflowTuiRootComponentModel(model);
  expect(layout.summaryLines).toEqual([
    "IO Workflow TUI",
    "Project: IO (project:io) | Repository: io -> main | Focus: Branch board",
    "Selected branch: Workflow runtime contract [active] | Selected commit: Document commit queue scope [active]",
  ]);
  expect(layout.panels.map((panel) => panel.title)).toEqual([
    "Branches [focused]",
    "Branch Detail",
    "Commit Queue",
  ]);
  expect(layout.panels.find((panel) => panel.id === "branch-board")?.body).toContain(
    "observed/fixup [fresh]",
  );
  expect(layout.panels.find((panel) => panel.id === "branch-detail")?.body).toContain(
    "Goal: Define the canonical branch board and commit queue contract.",
  );
  expect(layout.panels.find((panel) => panel.id === "commit-queue")?.body).toContain(
    "Document commit queue scope",
  );
});

test("buildWorkflowTuiRootComponentModel renders selected branch detail metadata", () => {
  const { branch1Id, projectId, projection } = createWorkflowProjectionFixture();
  const model = createWorkflowTuiWorkflowModelFromProjection({
    projection,
    projectId,
    selectedBranchId: branch1Id,
  });

  const layout = buildWorkflowTuiRootComponentModel(model);
  const branchDetailBody = layout.panels.find((panel) => panel.id === "branch-detail")?.body;

  expect(branchDetailBody).toContain("Repository: io (repo:io) -> main");
  expect(branchDetailBody).toContain(
    "Latest session: planning / completed / session:workflow-runtime-contract-plan-01",
  );
  expect(branchDetailBody).toContain("Projected at: 2026-01-10T00:00:00.000Z");
  expect(branchDetailBody).toContain("Repository freshness: fresh");
  expect(branchDetailBody).toContain("Repository reconciled at: 2026-01-06T00:00:00.000Z");
});

test("buildWorkflowTuiRootComponentModel renders commit queue repository summaries", () => {
  const { projectId, projection } = createWorkflowProjectionFixture();
  const model = createWorkflowTuiWorkflowModelFromProjection({
    projection,
    projectId,
  });

  const layout = buildWorkflowTuiRootComponentModel(model);
  const commitQueueBody = layout.panels.find((panel) => panel.id === "commit-queue")?.body;

  expect(commitQueueBody).toContain(">* 2. [active] Document commit queue scope");
  expect(commitQueueBody).toContain("state committed | sha abcdef1234567 | lease released");
  expect(commitQueueBody).toContain(
    "state attached | branch workflow/runtime-contract | worktree /tmp/io-worktree-runtime | lease attached",
  );
});

test("createWorkflowTui hydrates from loading state into the graph-backed workflow shell", async () => {
  const { projectId, projection } = createWorkflowProjectionFixture();
  const { captureCharFrame, mockInput, renderOnce, renderer } = await createTestRenderer({
    height: 24,
    width: 140,
  });
  let exitRequested = 0;
  const tui = createWorkflowTui({
    onExitRequest: () => {
      exitRequested += 1;
    },
    renderer,
    requireTty: false,
    startup: {
      entrypointPath: "/Users/dpeek/code/io/io.ts",
      hydrate: async () =>
        createWorkflowTuiWorkflowModelFromProjection({
          projection,
          projectId,
        }),
      workspaceRoot: "/Users/dpeek/code/io/tmp/workspace",
    },
  });

  try {
    await act(async () => {
      await tui.start();
      await renderOnce();
    });

    const frame = captureCharFrame();
    expect(frame).toContain("Project: IO (project:io)");
    expect(frame).toContain("Selected branch: Workflow runtime contract [active]");
    expect(frame).toContain("Document commit queue scope");

    await act(async () => {
      await mockInput.typeText("q");
      await Promise.resolve();
    });
    expect(exitRequested).toBe(1);
  } finally {
    await act(async () => {
      await tui.stop();
    });
    renderer.destroy();
  }
});

test("createWorkflowTui renders startup failure presentation when hydration fails", async () => {
  const { captureCharFrame, renderOnce, renderer } = await createTestRenderer({
    height: 24,
    width: 140,
  });
  const tui = createWorkflowTui({
    renderer,
    requireTty: false,
    startup: {
      entrypointPath: "/Users/dpeek/code/io/io.ts",
      hydrate: async () => {
        throw new Error("Sync request failed with 503 Service Unavailable.");
      },
      workspaceRoot: "/Users/dpeek/code/io/tmp/workspace",
    },
  });

  try {
    await act(async () => {
      await tui.start();
      await renderOnce();
    });

    const frame = captureCharFrame();
    expect(frame).toContain("Unable to load the graph-backed workflow shell.");
    expect(frame).toContain("Sync request failed with 503");
    expect(frame).toContain("Service Unavailable.");
    expect(frame).toContain("Status: startup failed.");
  } finally {
    await act(async () => {
      await tui.stop();
    });
    renderer.destroy();
  }
});

test("createWorkflowTui supports workflow focus and selection across branch and commit panels", async () => {
  const { projectId, projection } = createWorkflowProjectionFixture();
  const { captureCharFrame, mockInput, renderOnce, renderer } = await createTestRenderer({
    height: 28,
    width: 160,
  });
  const tui = createWorkflowTui({
    renderer,
    requireTty: false,
    surfaceModel: createWorkflowTuiWorkflowModelFromProjection({
      projection,
      projectId,
    }),
  });

  try {
    await act(async () => {
      await tui.start();
      await renderOnce();
    });

    let frame = captureCharFrame();
    expect(frame).toContain("Selected branch: Workflow runtime contract [active]");
    expect(frame).toContain("Selected commit: Document commit queue scope [active]");

    await act(async () => {
      mockInput.pressArrow("down");
      await renderOnce();
    });
    frame = captureCharFrame();
    expect(frame).toContain("Selected branch: Workflow shell polish [ready]");
    expect(frame).toContain("Goal: Tighten the first read-only workflow");
    expect(frame).toContain("Render first workflow screens");

    await act(async () => {
      mockInput.pressArrow("right");
      mockInput.pressArrow("right");
      await renderOnce();
    });
    frame = captureCharFrame();
    expect(frame).toContain("Commit Queue [focused]");

    await act(async () => {
      mockInput.pressArrow("down");
      await renderOnce();
    });
    frame = captureCharFrame();
    expect(frame).toContain("Selected commit: Queue selection rules [planned]");
  } finally {
    await act(async () => {
      await tui.stop();
    });
    renderer.destroy();
  }
});

test("createWorkflowTui resets commit selection when branch selection changes from branch detail", async () => {
  const { projectId, projection } = createWorkflowProjectionFixture();
  const { captureCharFrame, mockInput, renderOnce, renderer } = await createTestRenderer({
    height: 28,
    width: 160,
  });
  const tui = createWorkflowTui({
    renderer,
    requireTty: false,
    surfaceModel: createWorkflowTuiWorkflowModelFromProjection({
      projection,
      projectId,
    }),
  });

  try {
    await act(async () => {
      await tui.start();
      await renderOnce();
    });

    await act(async () => {
      mockInput.pressArrow("right");
      await renderOnce();
    });

    let frame = captureCharFrame();
    expect(frame).toContain("Branch Detail [focused]");

    await act(async () => {
      mockInput.pressArrow("down");
      await renderOnce();
    });

    frame = captureCharFrame();
    expect(frame).toContain("Selected branch: Workflow shell polish [ready]");
    expect(frame).toContain("Selected commit: Render first workflow screens [ready]");
    expect(frame).toContain("Latest session: execution / running / session:");
    expect(frame).toContain("workflow-shell-polish-execution-01");

    await act(async () => {
      mockInput.pressArrow("right");
      mockInput.pressArrow("down");
      await renderOnce();
    });

    frame = captureCharFrame();
    expect(frame).toContain("Commit Queue [focused]");
    expect(frame).toContain("Selected commit: Queue selection rules [planned]");

    await act(async () => {
      mockInput.pressArrow("left");
      mockInput.pressArrow("up");
      await renderOnce();
    });

    frame = captureCharFrame();
    expect(frame).toContain("Branch Detail [focused]");
    expect(frame).toContain("Selected branch: Workflow runtime contract [active]");
    expect(frame).toContain("Selected commit: Document commit queue scope [active]");
  } finally {
    await act(async () => {
      await tui.stop();
    });
    renderer.destroy();
  }
});
