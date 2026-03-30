import { describe, expect, it } from "bun:test";

import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { createGraphIdMap, createGraphStore } from "@io/graph-kernel";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";

import { workflow } from "./index.js";
import {
  agentSessionKeyPattern,
  commitQueueScopeFailureCodes,
  type CommitQueueScopeQuery,
  type CommitQueueScopeResult,
  contextBundleKeyPattern,
  defaultProjectBranchScopeOrder,
  projectBranchScopeFailureCodes,
  projectBranchScopeOrderDirectionValues,
  projectBranchScopeOrderFieldValues,
  projectBranchScopeRepositoryFreshnessValues,
  branchCommitQueueProjection,
  branchKeyPattern,
  commitKeyPattern,
  workflowMutationCommand,
  workflowMutationFailureCodes,
  projectBranchBoardProjection,
  projectionCatalog,
  projectionDefinitionHashes,
  workflowBuiltInQuerySurfaceIds,
  workflowBuiltInQuerySurfaces,
  workflowQuerySurfaceCatalog,
  projectionIds,
  projectionMetadata,
  projectionSchema,
  workflowReviewModuleReadScope,
  workflowReviewSyncScopeRequest,
  projectKeyPattern,
  repositoryKeyPattern,
  workflowSchema,
} from "./schema.js";

const productGraph = { ...core, ...workflow } as const;

const lifecycleContext = {
  event: "create" as const,
  nodeId: "workflow-1",
  now: new Date("2026-01-01T00:00:00.000Z"),
  incoming: undefined,
  previous: undefined,
  changedPredicateKeys: new Set<string>(),
};

describe("workflow schema", () => {
  it("exports the full workflow entity, enum, and mutation contract surface", () => {
    expect(Object.keys(workflowSchema).sort()).toEqual(
      [
        "agentSession",
        "agentSessionEvent",
        "agentSessionEventPhase",
        "agentSessionEventType",
        "agentSessionKind",
        "agentSessionRawLineEncoding",
        "agentSessionRuntimeState",
        "agentSessionStatusCode",
        "agentSessionStatusFormat",
        "agentSessionStream",
        "agentSessionSubjectKind",
        "contextBundle",
        "contextBundleEntry",
        "contextBundleEntrySource",
        "repositoryBranch",
        "repositoryCommit",
        "repositoryCommitLeaseState",
        "repositoryCommitState",
        "artifact",
        "artifactKind",
        "branch",
        "branchState",
        "commit",
        "commitState",
        "decision",
        "decisionKind",
        "project",
        "repository",
      ].sort(),
    );

    expect(workflowMutationCommand.key).toBe("workflow:mutation");
    expect(workflowMutationFailureCodes).toEqual([
      "repository-missing",
      "branch-lock-conflict",
      "commit-lock-conflict",
      "invalid-transition",
      "subject-not-found",
    ]);
    expect(projectBranchScopeFailureCodes).toEqual([
      "project-not-found",
      "policy-denied",
      "projection-stale",
    ]);
    expect(commitQueueScopeFailureCodes).toEqual([
      "branch-not-found",
      "policy-denied",
      "projection-stale",
    ]);
    expect(projectBranchScopeOrderFieldValues).toEqual([
      "queue-rank",
      "updated-at",
      "created-at",
      "title",
      "state",
    ]);
    expect(projectBranchScopeOrderDirectionValues).toEqual(["asc", "desc"]);
    expect(projectBranchScopeRepositoryFreshnessValues).toEqual(["fresh", "stale", "missing"]);
    expect(defaultProjectBranchScopeOrder).toEqual([
      { field: "queue-rank", direction: "asc" },
      { field: "updated-at", direction: "desc" },
      { field: "title", direction: "asc" },
    ]);
    expect(workflowMutationCommand.policy.touchesPredicates).toEqual(
      expect.arrayContaining([
        { predicateId: workflow.project.fields.projectKey.key },
        { predicateId: workflow.repository.fields.repositoryKey.key },
        { predicateId: workflow.branch.fields.state.key },
        { predicateId: workflow.branch.fields.activeCommit.key },
        { predicateId: workflow.commit.fields.state.key },
      ]),
    );
  });

  it("defines the canonical branch-detail and commit-queue query shape", () => {
    const query = {
      branchId: "workflow-branch-1",
      cursor: "cursor:branch-1",
      limit: 25,
    } satisfies CommitQueueScopeQuery;

    const result = {
      branch: {
        branch: {
          entity: "branch",
          id: "workflow-branch-1",
          title: "Workflow runtime contract",
          projectId: "workflow-project-1",
          branchKey: "branch:workflow-runtime-contract",
          state: "active",
          goalSummary: "Define the canonical branch detail and commit queue contract.",
          activeCommitId: "workflow-commit-2",
          queueRank: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        repositoryBranch: {
          freshness: "fresh",
          repositoryBranch: {
            entity: "repository-branch",
            id: "repository-branch-1",
            title: "workflow/runtime-contract",
            projectId: "workflow-project-1",
            repositoryId: "workflow-repository-1",
            branchId: "workflow-branch-1",
            managed: true,
            branchName: "workflow/runtime-contract",
            baseBranchName: "main",
            latestReconciledAt: "2026-01-02T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        },
        activeCommit: {
          commit: {
            entity: "commit",
            id: "workflow-commit-2",
            title: "Document commit queue shape",
            branchId: "workflow-branch-1",
            commitKey: "commit:document-commit-queue-shape",
            state: "active",
            order: 2,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
          repositoryCommit: {
            entity: "repository-commit",
            id: "repository-commit-1",
            title: "Document commit queue shape",
            repositoryId: "workflow-repository-1",
            repositoryBranchId: "repository-branch-1",
            commitId: "workflow-commit-2",
            state: "attached",
            worktree: {
              branchName: "workflow/runtime-contract",
              leaseState: "attached",
              path: "/tmp/worktree-1",
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        },
        latestSession: {
          id: "agent-session-1",
          sessionKey: "session:workflow-runtime-contract-execution-01",
          kind: "execution",
          runtimeState: "running",
          subject: {
            kind: "commit",
            commitId: "workflow-commit-2",
          },
          startedAt: "2026-01-02T00:00:00.000Z",
        },
      },
      rows: [
        {
          commit: {
            entity: "commit",
            id: "workflow-commit-1",
            title: "Define branch scope",
            branchId: "workflow-branch-1",
            commitKey: "commit:define-branch-scope",
            state: "committed",
            order: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
          repositoryCommit: {
            entity: "repository-commit",
            id: "repository-commit-0",
            title: "Define branch scope",
            repositoryId: "workflow-repository-1",
            repositoryBranchId: "repository-branch-1",
            commitId: "workflow-commit-1",
            state: "committed",
            sha: "abcdef1234567",
            committedAt: "2026-01-02T00:00:00.000Z",
            worktree: {
              leaseState: "released",
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        },
        {
          commit: {
            entity: "commit",
            id: "workflow-commit-2",
            title: "Document commit queue shape",
            branchId: "workflow-branch-1",
            commitKey: "commit:document-commit-queue-shape",
            state: "active",
            order: 2,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
          repositoryCommit: {
            entity: "repository-commit",
            id: "repository-commit-1",
            title: "Document commit queue shape",
            repositoryId: "workflow-repository-1",
            repositoryBranchId: "repository-branch-1",
            commitId: "workflow-commit-2",
            state: "attached",
            worktree: {
              branchName: "workflow/runtime-contract",
              leaseState: "attached",
              path: "/tmp/worktree-1",
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        },
      ],
      freshness: {
        projectedAt: "2026-01-02T00:00:00.000Z",
        projectionCursor: "cursor:branch-1",
        repositoryFreshness: "fresh",
        repositoryReconciledAt: "2026-01-02T00:00:00.000Z",
      },
      nextCursor: "cursor:branch-2",
    } satisfies CommitQueueScopeResult;

    expect(query.branchId).toBe("workflow-branch-1");
    expect(result.branch.branch.goalSummary).toBe(
      "Define the canonical branch detail and commit queue contract.",
    );
    expect(result.branch.activeCommit?.commit.id).toBe("workflow-commit-2");
    expect(result.branch.latestSession?.subject.kind).toBe("commit");
    expect(result.rows[1]?.repositoryCommit?.state).toBe("attached");
  });

  it("exports the canonical workflow read scope and projection metadata", () => {
    expect(workflowReviewModuleReadScope).toEqual({
      kind: "module",
      moduleId: "workflow",
      scopeId: "scope:workflow:review",
      definitionHash: "scope-def:workflow:review:v1",
    });
    expect(workflowReviewSyncScopeRequest).toEqual({
      kind: "module",
      moduleId: workflowReviewModuleReadScope.moduleId,
      scopeId: workflowReviewModuleReadScope.scopeId,
    });
    expect(projectBranchBoardProjection).toMatchObject({
      projectionId: "workflow:project-branch-board",
      kind: "collection-index",
      definitionHash: "projection-def:workflow:project-branch-board:v1",
      sourceScopeKinds: ["module"],
      dependencyKeys: ["projection:workflow:project-branch-board", "scope:workflow:review"],
      rebuildStrategy: "full",
      visibilityMode: "policy-filtered",
    });
    expect(branchCommitQueueProjection).toMatchObject({
      projectionId: "workflow:branch-commit-queue",
      kind: "collection-index",
      definitionHash: "projection-def:workflow:branch-commit-queue:v1",
      sourceScopeKinds: ["module"],
      dependencyKeys: ["projection:workflow:branch-commit-queue", "scope:workflow:review"],
      rebuildStrategy: "full",
      visibilityMode: "policy-filtered",
    });
    expect(projectionCatalog).toEqual([projectBranchBoardProjection, branchCommitQueueProjection]);
    expect(Object.keys(projectionSchema)).toEqual(
      expect.arrayContaining([
        "document",
        "documentBlock",
        "documentBlockKind",
        "documentPlacement",
        "tag",
        "type",
        "project",
        "repository",
        "branch",
        "commit",
        "repositoryBranch",
        "repositoryCommit",
        "agentSession",
        "agentSessionEvent",
        "artifact",
        "decision",
        "contextBundle",
        "contextBundleEntry",
      ]),
    );
    expect(projectionMetadata).toEqual({
      projectBranchBoard: projectBranchBoardProjection,
      branchCommitQueue: branchCommitQueueProjection,
    });
    expect(projectionIds).toEqual({
      projectBranchBoard: projectBranchBoardProjection.projectionId,
      branchCommitQueue: branchCommitQueueProjection.projectionId,
    });
    expect(projectionDefinitionHashes).toEqual({
      reviewScope: workflowReviewModuleReadScope.definitionHash,
      projectBranchBoard: projectBranchBoardProjection.definitionHash,
      branchCommitQueue: branchCommitQueueProjection.definitionHash,
    });
    expect(workflowQuerySurfaceCatalog).toMatchObject({
      catalogId: "workflow:query-surfaces",
      catalogVersion: "query-catalog:workflow:v1",
      moduleId: "workflow",
      surfaces: expect.any(Array),
    });
    expect(workflowBuiltInQuerySurfaces).toMatchObject({
      projectBranchBoard: {
        surfaceId: projectBranchBoardProjection.projectionId,
        surfaceVersion: "query-surface:workflow:project-branch-board:v1",
        queryKind: "collection",
        source: {
          kind: "projection",
          projectionId: projectBranchBoardProjection.projectionId,
        },
      },
      branchCommitQueue: {
        surfaceId: branchCommitQueueProjection.projectionId,
        surfaceVersion: "query-surface:workflow:branch-commit-queue:v1",
        queryKind: "collection",
        source: {
          kind: "projection",
          projectionId: branchCommitQueueProjection.projectionId,
        },
      },
      reviewScope: {
        surfaceId: workflowReviewModuleReadScope.scopeId,
        surfaceVersion: "query-surface:workflow:review-scope:v1",
        queryKind: "scope",
        source: {
          kind: "scope",
          scopeId: workflowReviewModuleReadScope.scopeId,
        },
      },
    });
    expect(
      workflowBuiltInQuerySurfaces.projectBranchBoard.filters?.map((field) => field.fieldId),
    ).toEqual(["projectId", "state", "hasActiveCommit", "showUnmanagedRepositoryBranches"]);
    expect(
      workflowBuiltInQuerySurfaces.projectBranchBoard.ordering?.map((field) => field.fieldId),
    ).toEqual(["queue-rank", "updated-at", "created-at", "title", "state"]);
    expect(
      workflowBuiltInQuerySurfaces.projectBranchBoard.selections?.map((field) => field.fieldId),
    ).toEqual([
      "title",
      "state",
      "queueRank",
      "hasActiveCommit",
      "repositoryFreshness",
      "updatedAt",
    ]);
    expect(workflowBuiltInQuerySurfaceIds).toEqual({
      projectBranchBoard: projectBranchBoardProjection.projectionId,
      branchCommitQueue: branchCommitQueueProjection.projectionId,
      reviewScope: workflowReviewModuleReadScope.scopeId,
    });
  });

  it("owns stable keys for workflow lineage, retained execution, and repository execution records", () => {
    const { map } = createGraphIdMap(workflowSchema);

    expect(Object.keys(map.keys)).toEqual(
      expect.arrayContaining([
        "workflow:project",
        "workflow:project:projectKey",
        "workflow:repository",
        "workflow:repository:project",
        "workflow:repository:repositoryKey",
        "workflow:branchState",
        "workflow:branchState.backlog",
        "workflow:branch",
        "workflow:branch:activeCommit",
        "workflow:branch:contextDocument",
        "workflow:branch:goalDocument",
        "workflow:commitState",
        "workflow:commit",
        "workflow:commit:contextDocument",
        "workflow:commit:parentCommit",
        "workflow:repositoryBranch",
        "workflow:repositoryBranch:branch",
        "workflow:repositoryCommitState",
        "workflow:repositoryCommitLeaseState",
        "workflow:repositoryCommit",
        "workflow:repositoryCommit:worktree",
        "workflow:repositoryCommit:worktree:leaseState",
        "workflow:agentSessionSubjectKind",
        "workflow:agentSessionKind",
        "workflow:agentSessionRuntimeState",
        "workflow:agentSession",
        "workflow:agentSession:sessionKey",
        "workflow:agentSession:branch",
        "workflow:agentSession:contextBundle",
        "workflow:agentSessionEventType",
        "workflow:agentSessionEventPhase",
        "workflow:agentSessionStatusCode",
        "workflow:agentSessionStatusFormat",
        "workflow:agentSessionStream",
        "workflow:agentSessionRawLineEncoding",
        "workflow:agentSessionEvent",
        "workflow:agentSessionEvent:session",
        "workflow:agentSessionEvent:statusCode",
        "workflow:artifactKind",
        "workflow:artifact",
        "workflow:artifact:session",
        "workflow:decisionKind",
        "workflow:decision",
        "workflow:decision:session",
        "workflow:contextBundle",
        "workflow:contextBundle:bundleKey",
        "workflow:contextBundle:session",
        "workflow:contextBundleEntrySource",
        "workflow:contextBundleEntrySource.document",
        "workflow:contextBundleEntrySource.repo-path",
        "workflow:contextBundleEntry",
        "workflow:contextBundleEntry:bundle",
        "workflow:contextBundleEntry:source",
      ]),
    );
  });

  it("resolves workflow lineage, retained execution refs, and event enums through the canonical workflow namespace", () => {
    expect(String(workflow.repository.fields.project.range)).toBe(workflow.project.values.id);
    expect(String(workflow.branch.fields.project.range)).toBe(workflow.project.values.id);
    expect(String(workflow.branch.fields.goalDocument.range)).toBe(workflow.document.values.id);
    expect(String(workflow.branch.fields.contextDocument.range)).toBe(workflow.document.values.id);
    expect(String(workflow.branch.fields.activeCommit.range)).toBe(workflow.commit.values.id);
    expect(String(workflow.commit.fields.branch.range)).toBe(workflow.branch.values.id);
    expect(String(workflow.commit.fields.contextDocument.range)).toBe(workflow.document.values.id);
    expect(String(workflow.repositoryBranch.fields.repository.range)).toBe(
      workflow.repository.values.id,
    );
    expect(String(workflow.repositoryCommit.fields.repositoryBranch.range)).toBe(
      workflow.repositoryBranch.values.id,
    );
    expect(String(workflow.repositoryCommit.fields.commit.range)).toBe(workflow.commit.values.id);
    expect(String(workflow.repositoryCommit.fields.worktree.leaseState.range)).toBe(
      workflow.repositoryCommitLeaseState.values.id,
    );
    expect(String(workflow.agentSession.fields.project.range)).toBe(workflow.project.values.id);
    expect(String(workflow.agentSession.fields.repository.range)).toBe(
      workflow.repository.values.id,
    );
    expect(String(workflow.agentSession.fields.subjectKind.range)).toBe(
      workflow.agentSessionSubjectKind.values.id,
    );
    expect(String(workflow.agentSession.fields.branch.range)).toBe(workflow.branch.values.id);
    expect(String(workflow.agentSession.fields.commit.range)).toBe(workflow.commit.values.id);
    expect(String(workflow.agentSession.fields.contextBundle.range)).toBe(
      workflow.contextBundle.values.id,
    );
    expect(String(workflow.agentSession.fields.kind.range)).toBe(
      workflow.agentSessionKind.values.id,
    );
    expect(String(workflow.agentSession.fields.runtimeState.range)).toBe(
      workflow.agentSessionRuntimeState.values.id,
    );
    expect(String(workflow.agentSessionEvent.fields.session.range)).toBe(
      workflow.agentSession.values.id,
    );
    expect(String(workflow.agentSessionEvent.fields.type.range)).toBe(
      workflow.agentSessionEventType.values.id,
    );
    expect(String(workflow.agentSessionEvent.fields.phase.range)).toBe(
      workflow.agentSessionEventPhase.values.id,
    );
    expect(String(workflow.agentSessionEvent.fields.statusCode.range)).toBe(
      workflow.agentSessionStatusCode.values.id,
    );
    expect(String(workflow.agentSessionEvent.fields.format.range)).toBe(
      workflow.agentSessionStatusFormat.values.id,
    );
    expect(String(workflow.agentSessionEvent.fields.stream.range)).toBe(
      workflow.agentSessionStream.values.id,
    );
    expect(String(workflow.agentSessionEvent.fields.encoding.range)).toBe(
      workflow.agentSessionRawLineEncoding.values.id,
    );
    expect(String(workflow.artifact.fields.session.range)).toBe(workflow.agentSession.values.id);
    expect(String(workflow.artifact.fields.kind.range)).toBe(workflow.artifactKind.values.id);
    expect(String(workflow.decision.fields.session.range)).toBe(workflow.agentSession.values.id);
    expect(String(workflow.decision.fields.kind.range)).toBe(workflow.decisionKind.values.id);
    expect(String(workflow.contextBundle.fields.session.range)).toBe(
      workflow.agentSession.values.id,
    );
    expect(String(workflow.contextBundle.fields.subjectKind.range)).toBe(
      workflow.agentSessionSubjectKind.values.id,
    );
    expect(String(workflow.contextBundleEntry.fields.bundle.range)).toBe(
      workflow.contextBundle.values.id,
    );
    expect(String(workflow.contextBundleEntry.fields.source.range)).toBe(
      workflow.contextBundleEntrySource.values.id,
    );
    expect(typeof workflow.project.fields.projectKey.id).toBe("string");
    expect(typeof workflow.agentSession.fields.sessionKey.id).toBe("string");
    expect(typeof workflow.contextBundle.fields.bundleKey.id).toBe("string");
  });

  it("validates stable retained keys and defaults retained execution lifecycle fields", () => {
    expect(projectKeyPattern.test("project:io")).toBe(true);
    expect(repositoryKeyPattern.test("repo:io")).toBe(true);
    expect(branchKeyPattern.test("branch:workflow-graph-native")).toBe(true);
    expect(commitKeyPattern.test("commit:branch-runtime-view")).toBe(true);
    expect(agentSessionKeyPattern.test("session:branch-runtime-view-plan-01")).toBe(true);
    expect(contextBundleKeyPattern.test("bundle:branch-runtime-view-plan-01")).toBe(true);

    expect(
      workflow.agentSession.fields.sessionKey.validate?.({
        event: "create",
        phase: "local",
        nodeId: "agent-session-1",
        now: new Date("2026-01-01T00:00:00.000Z"),
        path: [],
        field: "sessionKey",
        predicateKey: workflow.agentSession.fields.sessionKey.key,
        range: workflow.agentSession.fields.sessionKey.range,
        cardinality: workflow.agentSession.fields.sessionKey.cardinality,
        value: "branch:runtime-view",
        previous: undefined,
        changedPredicateKeys: new Set<string>([workflow.agentSession.fields.sessionKey.key]),
      }),
    ).toEqual({
      code: "workflow.key.invalid",
      message:
        'Session key must start with "session:" and use only lowercase letters, numbers, and hyphen-separated segments.',
    });

    expect(
      workflow.contextBundleEntry.fields.order.validate?.({
        event: "create",
        phase: "local",
        nodeId: "context-bundle-entry-1",
        now: new Date("2026-01-01T00:00:00.000Z"),
        path: [],
        field: "order",
        predicateKey: workflow.contextBundleEntry.fields.order.key,
        range: workflow.contextBundleEntry.fields.order.range,
        cardinality: workflow.contextBundleEntry.fields.order.cardinality,
        value: -1,
        previous: undefined,
        changedPredicateKeys: new Set<string>([workflow.contextBundleEntry.fields.order.key]),
      }),
    ).toEqual({
      code: "workflow.integer.invalid",
      message: "Context entry order must be a non-negative integer.",
    });

    expect(workflow.project.fields.inferred.onCreate?.(lifecycleContext)).toBe(true);
    expect(workflow.repositoryBranch.fields.managed.onCreate?.(lifecycleContext)).toBe(false);
    expect(workflow.branch.fields.state.onCreate?.(lifecycleContext)).toBe(
      workflow.branchState.values.backlog.id,
    );
    expect(workflow.commit.fields.state.onCreate?.(lifecycleContext)).toBe(
      workflow.commitState.values.planned.id,
    );
    expect(workflow.repositoryCommit.fields.state.onCreate?.(lifecycleContext)).toBe(
      workflow.repositoryCommitState.values.planned.id,
    );
    expect(workflow.repositoryCommit.fields.worktree.leaseState.onCreate?.(lifecycleContext)).toBe(
      workflow.repositoryCommitLeaseState.values.unassigned.id,
    );
    expect(workflow.agentSession.fields.runtimeState.onCreate?.(lifecycleContext)).toBe(
      workflow.agentSessionRuntimeState.values.running.id,
    );
    expect(workflow.agentSession.fields.startedAt.onCreate?.(lifecycleContext)).toBe(
      lifecycleContext.now,
    );
    expect(workflow.agentSessionEvent.fields.timestamp.onCreate?.(lifecycleContext)).toBe(
      lifecycleContext.now,
    );
    expect(workflow.contextBundleEntrySource.options.document.id).toEqual(expect.any(String));
  });

  it("preserves retained execution provenance across sessions, artifacts, decisions, and bundles", () => {
    const store = createGraphStore();
    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, workflow, coreGraphBootstrapOptions);
    const graph = createGraphClient(store, productGraph);

    const projectId = graph.project.create({
      name: "IO",
      projectKey: "project:io",
    });
    const repositoryId = graph.repository.create({
      name: "io",
      project: projectId,
      repositoryKey: "repo:io",
      repoRoot: "/tmp/io",
      defaultBaseBranch: "main",
    });
    const branchId = graph.branch.create({
      name: "Workflow authority",
      project: projectId,
      branchKey: "branch:workflow-authority",
      state: workflow.branchState.values.ready.id,
    });
    const commitId = graph.commit.create({
      name: "Add contract tests",
      branch: branchId,
      commitKey: "commit:add-contract-tests",
      state: workflow.commitState.values.active.id,
      order: 0,
    });
    const repositoryBranchId = graph.repositoryBranch.create({
      name: "workflow-authority",
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      managed: true,
      branchName: "workflow-authority",
      baseBranchName: "main",
    });
    const repositoryCommitId = graph.repositoryCommit.create({
      name: "Add contract tests",
      repository: repositoryId,
      repositoryBranch: repositoryBranchId,
      commit: commitId,
      state: workflow.repositoryCommitState.values.attached.id,
      worktree: {
        path: "/tmp/io-worktree",
        branchName: "workflow-authority",
        leaseState: workflow.repositoryCommitLeaseState.values.attached.id,
      },
    });
    const sessionId = graph.agentSession.create({
      name: "Execute workflow contracts",
      project: projectId,
      repository: repositoryId,
      subjectKind: workflow.agentSessionSubjectKind.values.commit.id,
      branch: branchId,
      commit: commitId,
      sessionKey: "session:workflow-authority-execution-01",
      kind: workflow.agentSessionKind.values.execution.id,
      workerId: "worker-1",
    });
    const bundleId = graph.contextBundle.create({
      name: "Workflow execution bundle",
      session: sessionId,
      subjectKind: workflow.agentSessionSubjectKind.values.commit.id,
      branch: branchId,
      commit: commitId,
      bundleKey: "bundle:workflow-authority-execution-01",
      sourceHash: "sha256:workflow-authority",
    });
    graph.agentSession.update(sessionId, {
      contextBundle: bundleId,
    });
    const eventId = graph.agentSessionEvent.create({
      name: "Commit selected",
      session: sessionId,
      type: workflow.agentSessionEventType.values.status.id,
      sequence: 0,
      statusCode: workflow.agentSessionStatusCode.values["commit-selected"].id,
      format: workflow.agentSessionStatusFormat.values.line.id,
      text: "Commit selected",
    });
    const artifactId = graph.artifact.create({
      name: "Patch summary",
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      session: sessionId,
      kind: workflow.artifactKind.values.patch.id,
      bodyText: "Summarize the contract coverage.",
    });
    const decisionId = graph.decision.create({
      name: "Keep singleton repository scope",
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      session: sessionId,
      kind: workflow.decisionKind.values.assumption.id,
      details: "Branch 6 v1 keeps one attached repository per graph.",
    });
    const entryId = graph.contextBundleEntry.create({
      name: "Branch 6 workflow contract",
      bundle: bundleId,
      order: 0,
      source: workflow.contextBundleEntrySource.values["repo-path"].id,
      path: "doc/branch/06-workflow-and-agent-runtime.md",
      bodyText: "Workflow contract reference",
    });

    expect(graph.repositoryCommit.get(repositoryCommitId)).toMatchObject({
      repository: repositoryId,
      repositoryBranch: repositoryBranchId,
      commit: commitId,
      state: workflow.repositoryCommitState.values.attached.id,
      worktree: {
        path: "/tmp/io-worktree",
        branchName: "workflow-authority",
        leaseState: workflow.repositoryCommitLeaseState.values.attached.id,
      },
    });
    expect(graph.agentSession.get(sessionId)).toMatchObject({
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      contextBundle: bundleId,
      sessionKey: "session:workflow-authority-execution-01",
      subjectKind: workflow.agentSessionSubjectKind.values.commit.id,
      kind: workflow.agentSessionKind.values.execution.id,
    });
    expect(graph.agentSessionEvent.get(eventId)).toMatchObject({
      session: sessionId,
      type: workflow.agentSessionEventType.values.status.id,
      statusCode: workflow.agentSessionStatusCode.values["commit-selected"].id,
      format: workflow.agentSessionStatusFormat.values.line.id,
    });
    expect(graph.artifact.get(artifactId)).toMatchObject({
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      session: sessionId,
      kind: workflow.artifactKind.values.patch.id,
    });
    expect(graph.decision.get(decisionId)).toMatchObject({
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      session: sessionId,
      kind: workflow.decisionKind.values.assumption.id,
    });
    expect(graph.contextBundle.get(bundleId)).toMatchObject({
      session: sessionId,
      branch: branchId,
      commit: commitId,
      bundleKey: "bundle:workflow-authority-execution-01",
      subjectKind: workflow.agentSessionSubjectKind.values.commit.id,
    });
    expect(graph.contextBundleEntry.get(entryId)).toMatchObject({
      bundle: bundleId,
      order: 0,
      source: workflow.contextBundleEntrySource.values["repo-path"].id,
      path: "doc/branch/06-workflow-and-agent-runtime.md",
    });
  });
});
