import { describe, expect, it } from "bun:test";

import { bootstrap, createStore } from "@io/core/graph";
import { createGraphClient } from "@io/graph-client";

import { core } from "../../core.js";
import { ops } from "../../ops.js";
import { pkm } from "../../pkm.js";
import {
  createRetainedWorkflowProjectionState,
  createWorkflowProjectionIndex,
  createWorkflowProjectionIndexFromRetainedState,
  WorkflowProjectionQueryError,
  workflowProjectionMetadata,
} from "./schema.js";

const productGraph = { ...core, ...pkm, ...ops } as const;

function date(value: string): Date {
  return new Date(value);
}

type WorkflowQueryFixtureOptions = {
  readonly activeRepositoryBranchLatestReconciledAt?: string | null;
  readonly backlogRepositoryBranchLatestReconciledAt?: string | null;
  readonly includeRepository?: boolean;
  readonly includeRepositoryBranches?: boolean;
  readonly includeRepositoryCommits?: boolean;
  readonly includeUnmanagedRepositoryBranch?: boolean;
  readonly unmanagedRepositoryBranchLatestReconciledAt?: string | null;
};

function createWorkflowQueryFixture(options: WorkflowQueryFixtureOptions = {}) {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, pkm);
  bootstrap(store, ops);
  const graph = createGraphClient(store, productGraph);
  const includeRepository = options.includeRepository ?? true;
  const includeRepositoryBranches = options.includeRepositoryBranches ?? includeRepository;
  const includeRepositoryCommits = options.includeRepositoryCommits ?? includeRepositoryBranches;
  const includeUnmanagedRepositoryBranch =
    options.includeUnmanagedRepositoryBranch ?? includeRepositoryBranches;

  const projectId = graph.workflowProject.create({
    name: "IO",
    projectKey: "project:io",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-01T00:00:00.000Z"),
  });
  const repositoryId = includeRepository
    ? graph.workflowRepository.create({
        name: "io",
        project: projectId,
        repositoryKey: "repo:io",
        repoRoot: "/tmp/io",
        defaultBaseBranch: "main",
        createdAt: date("2026-01-01T00:00:00.000Z"),
        updatedAt: date("2026-01-02T00:00:00.000Z"),
      })
    : undefined;
  const branchGoalDocumentId = graph.document.create({
    name: "Workflow runtime contract goal",
    description: "Define the canonical branch board and commit queue contract.",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });
  const branchContextDocumentId = graph.document.create({
    name: "Workflow runtime contract context",
    description: "Primary branch startup memory.",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });
  const commitContextDocumentId = graph.document.create({
    name: "Commit queue scope context",
    description: "Primary commit execution memory.",
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-05T12:00:00.000Z"),
  });
  const activeBranchId = graph.workflowBranch.create({
    name: "Workflow runtime contract",
    project: projectId,
    branchKey: "branch:workflow-runtime-contract",
    state: ops.workflowBranchState.values.active.id,
    queueRank: 1,
    goalDocument: branchGoalDocumentId,
    contextDocument: branchContextDocumentId,
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-05T00:00:00.000Z"),
  });
  const backlogBranchId = graph.workflowBranch.create({
    name: "Backlog docs",
    project: projectId,
    branchKey: "branch:backlog-docs",
    state: ops.workflowBranchState.values.backlog.id,
    queueRank: 3,
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-03T00:00:00.000Z"),
  });
  const noRankBranchId = graph.workflowBranch.create({
    name: "Unranked polish",
    project: projectId,
    branchKey: "branch:unranked-polish",
    state: ops.workflowBranchState.values.ready.id,
    createdAt: date("2026-01-03T00:00:00.000Z"),
    updatedAt: date("2026-01-07T00:00:00.000Z"),
  });

  const commit1Id = graph.workflowCommit.create({
    name: "Define branch board scope",
    branch: activeBranchId,
    commitKey: "commit:define-branch-board-scope",
    state: ops.workflowCommitState.values.committed.id,
    order: 1,
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-02T00:00:00.000Z"),
  });
  const commit2Id = graph.workflowCommit.create({
    name: "Document commit queue scope",
    branch: activeBranchId,
    commitKey: "commit:document-commit-queue-scope",
    state: ops.workflowCommitState.values.active.id,
    order: 2,
    contextDocument: commitContextDocumentId,
    createdAt: date("2026-01-02T00:00:00.000Z"),
    updatedAt: date("2026-01-05T12:00:00.000Z"),
  });
  const commit3Id = graph.workflowCommit.create({
    name: "Surface session summaries",
    branch: activeBranchId,
    commitKey: "commit:surface-session-summaries",
    state: ops.workflowCommitState.values.ready.id,
    order: 3,
    createdAt: date("2026-01-03T00:00:00.000Z"),
    updatedAt: date("2026-01-06T00:00:00.000Z"),
  });

  graph.workflowBranch.update(activeBranchId, {
    activeCommit: commit2Id,
    updatedAt: date("2026-01-06T00:00:00.000Z"),
  });

  const activeRepositoryBranchLatestReconciledAt =
    options.activeRepositoryBranchLatestReconciledAt === undefined
      ? "2026-01-05T12:00:00.000Z"
      : options.activeRepositoryBranchLatestReconciledAt;
  const backlogRepositoryBranchLatestReconciledAt =
    options.backlogRepositoryBranchLatestReconciledAt === undefined
      ? null
      : options.backlogRepositoryBranchLatestReconciledAt;
  const unmanagedRepositoryBranchLatestReconciledAt =
    options.unmanagedRepositoryBranchLatestReconciledAt === undefined
      ? "2026-01-06T00:00:00.000Z"
      : options.unmanagedRepositoryBranchLatestReconciledAt;

  let activeRepositoryBranchId: string | undefined;
  if (repositoryId && includeRepositoryBranches) {
    activeRepositoryBranchId = graph.repositoryBranch.create({
      name: "workflow/runtime-contract",
      project: projectId,
      repository: repositoryId,
      workflowBranch: activeBranchId,
      managed: true,
      branchName: "workflow/runtime-contract",
      baseBranchName: "main",
      ...(activeRepositoryBranchLatestReconciledAt
        ? { latestReconciledAt: date(activeRepositoryBranchLatestReconciledAt) }
        : {}),
      createdAt: date("2026-01-01T00:00:00.000Z"),
      updatedAt: date("2026-01-05T12:00:00.000Z"),
    });
    graph.repositoryBranch.create({
      name: "backlog/docs",
      project: projectId,
      repository: repositoryId,
      workflowBranch: backlogBranchId,
      managed: true,
      branchName: "backlog/docs",
      baseBranchName: "main",
      ...(backlogRepositoryBranchLatestReconciledAt
        ? { latestReconciledAt: date(backlogRepositoryBranchLatestReconciledAt) }
        : {}),
      createdAt: date("2026-01-02T00:00:00.000Z"),
      updatedAt: date("2026-01-03T00:00:00.000Z"),
    });
    if (includeUnmanagedRepositoryBranch) {
      graph.repositoryBranch.create({
        name: "observed/fixup",
        project: projectId,
        repository: repositoryId,
        managed: false,
        branchName: "observed/fixup",
        baseBranchName: "main",
        ...(unmanagedRepositoryBranchLatestReconciledAt
          ? { latestReconciledAt: date(unmanagedRepositoryBranchLatestReconciledAt) }
          : {}),
        createdAt: date("2026-01-04T00:00:00.000Z"),
        updatedAt: date("2026-01-06T00:00:00.000Z"),
      });
    }
  }

  if (repositoryId && activeRepositoryBranchId && includeRepositoryCommits) {
    graph.repositoryCommit.create({
      name: "Define branch board scope",
      repository: repositoryId,
      repositoryBranch: activeRepositoryBranchId,
      workflowCommit: commit1Id,
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
      repositoryBranch: activeRepositoryBranchId,
      workflowCommit: commit2Id,
      state: ops.repositoryCommitState.values.attached.id,
      worktree: {
        path: "/tmp/io-worktree",
        branchName: "workflow/runtime-contract",
        leaseState: ops.repositoryCommitLeaseState.values.attached.id,
      },
      createdAt: date("2026-01-02T00:00:00.000Z"),
      updatedAt: date("2026-01-05T12:00:00.000Z"),
    });
  }

  graph.agentSession.create({
    name: "Plan workflow runtime contract",
    project: projectId,
    ...(repositoryId ? { repository: repositoryId } : {}),
    subjectKind: ops.agentSessionSubjectKind.values.branch.id,
    branch: activeBranchId,
    sessionKey: "session:workflow-runtime-contract-plan-01",
    kind: ops.agentSessionKind.values.planning.id,
    workerId: "worker-1",
    runtimeState: ops.agentSessionRuntimeState.values.completed.id,
    startedAt: date("2026-01-04T00:00:00.000Z"),
    endedAt: date("2026-01-04T01:00:00.000Z"),
    createdAt: date("2026-01-04T00:00:00.000Z"),
    updatedAt: date("2026-01-04T01:00:00.000Z"),
  });
  const branchCommitSessionId = graph.agentSession.create({
    name: "Execute commit queue projection",
    project: projectId,
    ...(repositoryId ? { repository: repositoryId } : {}),
    subjectKind: ops.agentSessionSubjectKind.values.commit.id,
    branch: activeBranchId,
    commit: commit2Id,
    sessionKey: "session:workflow-runtime-contract-execution-01",
    kind: ops.agentSessionKind.values.execution.id,
    workerId: "worker-2",
    runtimeState: ops.agentSessionRuntimeState.values.running.id,
    startedAt: date("2026-01-05T12:30:00.000Z"),
    createdAt: date("2026-01-05T12:30:00.000Z"),
    updatedAt: date("2026-01-05T12:30:00.000Z"),
  });

  return {
    graph,
    ids: {
      activeBranchId,
      backlogBranchId,
      branchCommitSessionId,
      commit1Id,
      commit2Id,
      commit3Id,
      branchContextDocumentId,
      branchGoalDocumentId,
      commitContextDocumentId,
      noRankBranchId,
      projectId,
    },
  };
}

function expectWorkflowProjectionError(
  callback: () => unknown,
  code: WorkflowProjectionQueryError["code"],
) {
  try {
    callback();
    throw new Error(`Expected a workflow projection error with code "${code}".`);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowProjectionQueryError);
    expect(error).toMatchObject({ code });
  }
}

describe("workflow projection query helpers", () => {
  it("reads the project branch board with ordering, freshness, unmanaged joins, and pagination", () => {
    const { graph, ids } = createWorkflowQueryFixture();
    const projection = createWorkflowProjectionIndex(graph, {
      projectedAt: "2026-01-10T00:00:00.000Z",
    });

    expect(projection.projections).toEqual(workflowProjectionMetadata);

    const firstPage = projection.readProjectBranchScope({
      projectId: ids.projectId,
      filter: {
        showUnmanagedRepositoryBranches: true,
      },
      limit: 2,
    });

    expect(firstPage.project.projectKey).toBe("project:io");
    expect(firstPage.repository?.repositoryKey).toBe("repo:io");
    expect(firstPage.rows.map((row) => row.workflowBranch.branchKey)).toEqual([
      "branch:workflow-runtime-contract",
      "branch:backlog-docs",
    ]);
    expect(firstPage.rows[0]?.repositoryBranch).toMatchObject({
      freshness: "fresh",
      repositoryBranch: {
        branchName: "workflow/runtime-contract",
      },
    });
    expect(firstPage.rows[1]?.repositoryBranch).toMatchObject({
      freshness: "stale",
      repositoryBranch: {
        branchName: "backlog/docs",
      },
    });
    expect(firstPage.unmanagedRepositoryBranches).toMatchObject([
      {
        freshness: "fresh",
        repositoryBranch: {
          branchName: "observed/fixup",
        },
      },
    ]);
    expect(firstPage.freshness).toMatchObject({
      projectedAt: "2026-01-10T00:00:00.000Z",
      repositoryFreshness: "stale",
      repositoryReconciledAt: "2026-01-06T00:00:00.000Z",
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = projection.readProjectBranchScope({
      projectId: ids.projectId,
      cursor: firstPage.nextCursor,
      limit: 2,
    });

    expect(secondPage.rows.map((row) => row.workflowBranch.branchKey)).toEqual([
      "branch:unranked-polish",
    ]);
    expect(secondPage.unmanagedRepositoryBranches).toEqual([]);
    expect(secondPage.nextCursor).toBeUndefined();

    const activeOnly = projection.readProjectBranchScope({
      projectId: ids.projectId,
      filter: {
        hasActiveCommit: true,
      },
    });

    expect(activeOnly.rows.map((row) => row.workflowBranch.id)).toEqual([ids.activeBranchId]);
  });

  it("reads one branch commit queue with active commit, repository commit joins, and latest session", () => {
    const { graph, ids } = createWorkflowQueryFixture();
    const projection = createWorkflowProjectionIndex(graph, {
      projectedAt: "2026-01-10T00:00:00.000Z",
    });

    const firstPage = projection.readCommitQueueScope({
      branchId: ids.activeBranchId,
      limit: 2,
    });

    expect(firstPage.branch.workflowBranch.activeCommitId).toBe(ids.commit2Id);
    expect(firstPage.branch.workflowBranch.goalDocumentId).toBe(ids.branchGoalDocumentId);
    expect(firstPage.branch.workflowBranch.contextDocumentId).toBe(ids.branchContextDocumentId);
    expect(firstPage.branch.activeCommit).toMatchObject({
      workflowCommit: {
        id: ids.commit2Id,
        commitKey: "commit:document-commit-queue-scope",
        contextDocumentId: ids.commitContextDocumentId,
      },
      repositoryCommit: {
        state: "attached",
        worktree: {
          branchName: "workflow/runtime-contract",
          leaseState: "attached",
          path: "/tmp/io-worktree",
        },
      },
    });
    expect(firstPage.branch.latestSession).toMatchObject({
      id: ids.branchCommitSessionId,
      sessionKey: "session:workflow-runtime-contract-execution-01",
      kind: "execution",
      runtimeState: "running",
      subject: {
        kind: "commit",
        commitId: ids.commit2Id,
      },
    });
    expect(firstPage.rows.map((row) => row.workflowCommit.id)).toEqual([
      ids.commit1Id,
      ids.commit2Id,
    ]);
    expect(firstPage.rows[0]?.repositoryCommit?.state).toBe("committed");
    expect(firstPage.rows[1]?.repositoryCommit?.state).toBe("attached");
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = projection.readCommitQueueScope({
      branchId: ids.activeBranchId,
      cursor: firstPage.nextCursor,
      limit: 2,
    });

    expect(secondPage.rows.map((row) => row.workflowCommit.id)).toEqual([ids.commit3Id]);
    expect(secondPage.rows[0]?.repositoryCommit).toBeUndefined();
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("keeps workflow rows readable when repository observations are missing", () => {
    const { graph, ids } = createWorkflowQueryFixture({
      includeRepositoryBranches: false,
    });
    const projection = createWorkflowProjectionIndex(graph, {
      projectedAt: "2026-01-10T00:00:00.000Z",
    });

    const branchBoard = projection.readProjectBranchScope({
      projectId: ids.projectId,
      filter: {
        showUnmanagedRepositoryBranches: true,
      },
    });

    expect(branchBoard.repository?.repositoryKey).toBe("repo:io");
    expect(branchBoard.rows.map((row) => row.workflowBranch.branchKey)).toEqual([
      "branch:workflow-runtime-contract",
      "branch:backlog-docs",
      "branch:unranked-polish",
    ]);
    expect(branchBoard.rows.every((row) => row.repositoryBranch === undefined)).toBe(true);
    expect(branchBoard.unmanagedRepositoryBranches).toEqual([]);
    expect(branchBoard.freshness.repositoryFreshness).toBe("missing");
    expect(branchBoard.freshness.repositoryReconciledAt).toBeUndefined();

    const commitQueue = projection.readCommitQueueScope({
      branchId: ids.activeBranchId,
    });

    expect(commitQueue.branch.repositoryBranch).toBeUndefined();
    expect(commitQueue.branch.activeCommit?.workflowCommit.id).toBe(ids.commit2Id);
    expect(commitQueue.rows.map((row) => row.workflowCommit.id)).toEqual([
      ids.commit1Id,
      ids.commit2Id,
      ids.commit3Id,
    ]);
    expect(commitQueue.rows.every((row) => row.repositoryCommit === undefined)).toBe(true);
    expect(commitQueue.freshness.repositoryFreshness).toBe("missing");
    expect(commitQueue.freshness.repositoryReconciledAt).toBeUndefined();
  });

  it("surfaces stale repository observations without hiding workflow or retained commit state", () => {
    const { graph, ids } = createWorkflowQueryFixture({
      activeRepositoryBranchLatestReconciledAt: null,
    });
    const projection = createWorkflowProjectionIndex(graph, {
      projectedAt: "2026-01-10T00:00:00.000Z",
    });

    const branchBoard = projection.readProjectBranchScope({
      projectId: ids.projectId,
      limit: 1,
    });

    expect(branchBoard.rows[0]?.repositoryBranch).toMatchObject({
      freshness: "stale",
      repositoryBranch: {
        branchName: "workflow/runtime-contract",
      },
    });
    expect(branchBoard.freshness).toMatchObject({
      repositoryFreshness: "stale",
      repositoryReconciledAt: "2026-01-06T00:00:00.000Z",
    });

    const commitQueue = projection.readCommitQueueScope({
      branchId: ids.activeBranchId,
      limit: 2,
    });

    expect(commitQueue.branch.repositoryBranch).toMatchObject({
      freshness: "stale",
      repositoryBranch: {
        branchName: "workflow/runtime-contract",
      },
    });
    expect(commitQueue.branch.activeCommit).toMatchObject({
      workflowCommit: {
        id: ids.commit2Id,
      },
      repositoryCommit: {
        state: "attached",
      },
    });
    expect(commitQueue.freshness).toMatchObject({
      repositoryFreshness: "stale",
      repositoryReconciledAt: "2026-01-06T00:00:00.000Z",
    });
  });

  it("rejects missing subjects and stale cursors with stable query failure codes", () => {
    const { graph, ids } = createWorkflowQueryFixture();
    const projection = createWorkflowProjectionIndex(graph, {
      projectedAt: "2026-01-10T00:00:00.000Z",
    });

    expectWorkflowProjectionError(
      () => projection.readProjectBranchScope({ projectId: "missing-project" }),
      "project-not-found",
    );
    expectWorkflowProjectionError(
      () => projection.readCommitQueueScope({ branchId: "missing-branch" }),
      "branch-not-found",
    );

    const branchPage = projection.readProjectBranchScope({
      projectId: ids.projectId,
      limit: 1,
    });

    expectWorkflowProjectionError(
      () =>
        projection.readCommitQueueScope({
          branchId: ids.activeBranchId,
          cursor: branchPage.nextCursor,
        }),
      "projection-stale",
    );
  });

  it("invalidates pagination cursors after rebuilding the workflow projection", () => {
    const { graph, ids } = createWorkflowQueryFixture();
    const projection = createWorkflowProjectionIndex(graph, {
      projectedAt: "2026-01-10T00:00:00.000Z",
    });

    const branchPage = projection.readProjectBranchScope({
      projectId: ids.projectId,
      limit: 1,
    });
    const commitPage = projection.readCommitQueueScope({
      branchId: ids.activeBranchId,
      limit: 1,
    });

    expect(branchPage.nextCursor).toEqual(expect.any(String));
    expect(commitPage.nextCursor).toEqual(expect.any(String));

    const rebuiltProjection = createWorkflowProjectionIndex(graph, {
      projectedAt: "2026-02-01T00:00:00.000Z",
      projectionCursor: "workflow-projection:rebuilt-02",
    });

    expectWorkflowProjectionError(
      () =>
        rebuiltProjection.readProjectBranchScope({
          projectId: ids.projectId,
          cursor: branchPage.nextCursor,
        }),
      "projection-stale",
    );
    expectWorkflowProjectionError(
      () =>
        rebuiltProjection.readCommitQueueScope({
          branchId: ids.activeBranchId,
          cursor: commitPage.nextCursor,
        }),
      "projection-stale",
    );

    const refreshedBranchPage = rebuiltProjection.readProjectBranchScope({
      projectId: ids.projectId,
      limit: 1,
    });

    expect(refreshedBranchPage.rows[0]?.workflowBranch.id).toBe(ids.activeBranchId);
  });

  it("round-trips retained workflow projection rows and checkpoints", () => {
    const { graph, ids } = createWorkflowQueryFixture();
    const retained = createRetainedWorkflowProjectionState(graph, {
      sourceCursor: "web-authority:42",
      projectedAt: "2026-01-10T00:00:00.000Z",
      projectionCursor: "workflow-projection:retained-01",
    });
    const hydrated = createWorkflowProjectionIndexFromRetainedState(retained);

    expect(retained.checkpoints).toEqual([
      expect.objectContaining({
        projectionId: workflowProjectionMetadata.projectBranchBoard.projectionId,
        definitionHash: workflowProjectionMetadata.projectBranchBoard.definitionHash,
        sourceCursor: "web-authority:42",
        projectedAt: "2026-01-10T00:00:00.000Z",
        projectionCursor: "workflow-projection:retained-01",
      }),
      expect.objectContaining({
        projectionId: workflowProjectionMetadata.branchCommitQueue.projectionId,
        definitionHash: workflowProjectionMetadata.branchCommitQueue.definitionHash,
        sourceCursor: "web-authority:42",
        projectedAt: "2026-01-10T00:00:00.000Z",
        projectionCursor: "workflow-projection:retained-01",
      }),
    ]);

    const branchBoard = hydrated.readProjectBranchScope({
      projectId: ids.projectId,
      filter: {
        showUnmanagedRepositoryBranches: true,
      },
      limit: 2,
    });
    const commitQueue = hydrated.readCommitQueueScope({
      branchId: ids.activeBranchId,
      limit: 2,
    });

    expect(branchBoard.rows.map((row) => row.workflowBranch.id)).toEqual([
      ids.activeBranchId,
      ids.backlogBranchId,
    ]);
    expect(branchBoard.freshness.projectionCursor).toBe("workflow-projection:retained-01");
    expect(commitQueue.rows.map((row) => row.workflowCommit.id)).toEqual([
      ids.commit1Id,
      ids.commit2Id,
    ]);
    expect(commitQueue.branch.latestSession?.id).toBe(ids.branchCommitSessionId);
  });

  it("fails explicitly when retained projection metadata has an incompatible definitionHash", () => {
    const { graph } = createWorkflowQueryFixture();
    const retained = createRetainedWorkflowProjectionState(graph, {
      sourceCursor: "web-authority:42",
      projectedAt: "2026-01-10T00:00:00.000Z",
      projectionCursor: "workflow-projection:retained-01",
    });

    expect(() =>
      createWorkflowProjectionIndexFromRetainedState({
        ...retained,
        checkpoints: retained.checkpoints.map((checkpoint) =>
          checkpoint.projectionId === workflowProjectionMetadata.branchCommitQueue.projectionId
            ? {
                ...checkpoint,
                definitionHash: "projection-def:ops/workflow:branch-commit-queue:v999",
              }
            : checkpoint,
        ),
      }),
    ).toThrow(
      'Retained workflow projection checkpoint for "ops/workflow:branch-commit-queue" is incompatible. Expected definitionHash "projection-def:ops/workflow:branch-commit-queue:v1" but found projection-def:ops/workflow:branch-commit-queue:v999.',
    );
  });
});
