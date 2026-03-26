import { describe, expect, it } from "bun:test";

import { createStore } from "@io/core/graph";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { createGraphIdMap as createIdMap } from "@io/graph-kernel";

import { core } from "../../core.js";
import { coreGraphBootstrapOptions } from "../../core/bootstrap.js";
import { ops } from "../../ops.js";
import { pkm } from "../../pkm.js";
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
  workflowBranchCommitQueueProjection,
  workflowBranchKeyPattern,
  workflowCommitKeyPattern,
  workflowMutationCommand,
  workflowMutationFailureCodes,
  workflowProjectBranchBoardProjection,
  workflowProjectionCatalog,
  workflowProjectionDefinitionHashes,
  workflowBuiltInQuerySurfaceIds,
  workflowBuiltInQuerySurfaces,
  workflowProjectionIds,
  workflowProjectionMetadata,
  workflowProjectionSchema,
  workflowReviewModuleReadScope,
  workflowReviewSyncScopeRequest,
  workflowProjectKeyPattern,
  workflowRepositoryKeyPattern,
  workflowSchema,
} from "./schema.js";

const productGraph = { ...core, ...pkm, ...ops } as const;

const lifecycleContext = {
  event: "create" as const,
  nodeId: "workflow-1",
  now: new Date("2026-01-01T00:00:00.000Z"),
  incoming: undefined,
  previous: undefined,
  changedPredicateKeys: new Set<string>(),
};

describe("ops workflow schema", () => {
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
        "workflowArtifact",
        "workflowArtifactKind",
        "workflowBranch",
        "workflowBranchState",
        "workflowCommit",
        "workflowCommitState",
        "workflowDecision",
        "workflowDecisionKind",
        "workflowProject",
        "workflowRepository",
      ].sort(),
    );

    expect(workflowMutationCommand.key).toBe("ops:workflow:mutation");
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
        { predicateId: ops.workflowProject.fields.projectKey.key },
        { predicateId: ops.workflowRepository.fields.repositoryKey.key },
        { predicateId: ops.workflowBranch.fields.state.key },
        { predicateId: ops.workflowBranch.fields.activeCommit.key },
        { predicateId: ops.workflowCommit.fields.state.key },
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
        workflowBranch: {
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
            workflowBranchId: "workflow-branch-1",
            managed: true,
            branchName: "workflow/runtime-contract",
            baseBranchName: "main",
            latestReconciledAt: "2026-01-02T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        },
        activeCommit: {
          workflowCommit: {
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
            workflowCommitId: "workflow-commit-2",
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
          workflowCommit: {
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
            workflowCommitId: "workflow-commit-1",
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
          workflowCommit: {
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
            workflowCommitId: "workflow-commit-2",
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
    expect(result.branch.workflowBranch.goalSummary).toBe(
      "Define the canonical branch detail and commit queue contract.",
    );
    expect(result.branch.activeCommit?.workflowCommit.id).toBe("workflow-commit-2");
    expect(result.branch.latestSession?.subject.kind).toBe("commit");
    expect(result.rows[1]?.repositoryCommit?.state).toBe("attached");
  });

  it("exports the canonical workflow read scope and projection metadata", () => {
    expect(workflowReviewModuleReadScope).toEqual({
      kind: "module",
      moduleId: "ops/workflow",
      scopeId: "scope:ops/workflow:review",
      definitionHash: "scope-def:ops/workflow:review:v1",
    });
    expect(workflowReviewSyncScopeRequest).toEqual({
      kind: "module",
      moduleId: workflowReviewModuleReadScope.moduleId,
      scopeId: workflowReviewModuleReadScope.scopeId,
    });
    expect(workflowProjectBranchBoardProjection).toMatchObject({
      projectionId: "ops/workflow:project-branch-board",
      kind: "collection-index",
      definitionHash: "projection-def:ops/workflow:project-branch-board:v1",
      sourceScopeKinds: ["module"],
      dependencyKeys: ["projection:ops/workflow:project-branch-board", "scope:ops/workflow:review"],
      rebuildStrategy: "full",
      visibilityMode: "policy-filtered",
    });
    expect(workflowBranchCommitQueueProjection).toMatchObject({
      projectionId: "ops/workflow:branch-commit-queue",
      kind: "collection-index",
      definitionHash: "projection-def:ops/workflow:branch-commit-queue:v1",
      sourceScopeKinds: ["module"],
      dependencyKeys: ["projection:ops/workflow:branch-commit-queue", "scope:ops/workflow:review"],
      rebuildStrategy: "full",
      visibilityMode: "policy-filtered",
    });
    expect(workflowProjectionCatalog).toEqual([
      workflowProjectBranchBoardProjection,
      workflowBranchCommitQueueProjection,
    ]);
    expect(Object.keys(workflowProjectionSchema)).toEqual(
      expect.arrayContaining([
        "document",
        "documentBlock",
        "documentBlockKind",
        "documentPlacement",
        "tag",
        "type",
        "workflowProject",
        "workflowRepository",
        "workflowBranch",
        "workflowCommit",
        "repositoryBranch",
        "repositoryCommit",
        "agentSession",
        "agentSessionEvent",
        "workflowArtifact",
        "workflowDecision",
        "contextBundle",
        "contextBundleEntry",
      ]),
    );
    expect(workflowProjectionMetadata).toEqual({
      projectBranchBoard: workflowProjectBranchBoardProjection,
      branchCommitQueue: workflowBranchCommitQueueProjection,
    });
    expect(workflowProjectionIds).toEqual({
      projectBranchBoard: workflowProjectBranchBoardProjection.projectionId,
      branchCommitQueue: workflowBranchCommitQueueProjection.projectionId,
    });
    expect(workflowProjectionDefinitionHashes).toEqual({
      reviewScope: workflowReviewModuleReadScope.definitionHash,
      projectBranchBoard: workflowProjectBranchBoardProjection.definitionHash,
      branchCommitQueue: workflowBranchCommitQueueProjection.definitionHash,
    });
    expect(workflowBuiltInQuerySurfaces).toEqual({
      projectBranchBoard: {
        surfaceId: workflowProjectBranchBoardProjection.projectionId,
        queryKind: "collection",
        sourceKind: "projection",
        projectionId: workflowProjectBranchBoardProjection.projectionId,
      },
      branchCommitQueue: {
        surfaceId: workflowBranchCommitQueueProjection.projectionId,
        queryKind: "collection",
        sourceKind: "projection",
        projectionId: workflowBranchCommitQueueProjection.projectionId,
      },
      reviewScope: {
        surfaceId: workflowReviewModuleReadScope.scopeId,
        queryKind: "scope",
        sourceKind: "scope",
        scopeId: workflowReviewModuleReadScope.scopeId,
      },
    });
    expect(workflowBuiltInQuerySurfaceIds).toEqual({
      projectBranchBoard: workflowProjectBranchBoardProjection.projectionId,
      branchCommitQueue: workflowBranchCommitQueueProjection.projectionId,
      reviewScope: workflowReviewModuleReadScope.scopeId,
    });
  });

  it("owns stable keys for workflow lineage, retained execution, and repository execution records", () => {
    const { map } = createIdMap(workflowSchema);

    expect(Object.keys(map.keys)).toEqual(
      expect.arrayContaining([
        "ops:workflowProject",
        "ops:workflowProject:projectKey",
        "ops:workflowRepository",
        "ops:workflowRepository:project",
        "ops:workflowRepository:repositoryKey",
        "ops:workflowBranchState",
        "ops:workflowBranchState.backlog",
        "ops:workflowBranch",
        "ops:workflowBranch:activeCommit",
        "ops:workflowBranch:contextDocument",
        "ops:workflowBranch:goalDocument",
        "ops:workflowCommitState",
        "ops:workflowCommit",
        "ops:workflowCommit:contextDocument",
        "ops:workflowCommit:parentCommit",
        "ops:repositoryBranch",
        "ops:repositoryBranch:workflowBranch",
        "ops:repositoryCommitState",
        "ops:repositoryCommitLeaseState",
        "ops:repositoryCommit",
        "ops:repositoryCommit:worktree",
        "ops:repositoryCommit:worktree:leaseState",
        "ops:agentSessionSubjectKind",
        "ops:agentSessionKind",
        "ops:agentSessionRuntimeState",
        "ops:agentSession",
        "ops:agentSession:sessionKey",
        "ops:agentSession:branch",
        "ops:agentSession:contextBundle",
        "ops:agentSessionEventType",
        "ops:agentSessionEventPhase",
        "ops:agentSessionStatusCode",
        "ops:agentSessionStatusFormat",
        "ops:agentSessionStream",
        "ops:agentSessionRawLineEncoding",
        "ops:agentSessionEvent",
        "ops:agentSessionEvent:session",
        "ops:agentSessionEvent:statusCode",
        "ops:workflowArtifactKind",
        "ops:workflowArtifact",
        "ops:workflowArtifact:session",
        "ops:workflowDecisionKind",
        "ops:workflowDecision",
        "ops:workflowDecision:session",
        "ops:contextBundle",
        "ops:contextBundle:bundleKey",
        "ops:contextBundle:session",
        "ops:contextBundleEntrySource",
        "ops:contextBundleEntrySource.document",
        "ops:contextBundleEntrySource.repo-path",
        "ops:contextBundleEntry",
        "ops:contextBundleEntry:bundle",
        "ops:contextBundleEntry:source",
      ]),
    );
  });

  it("resolves workflow lineage, retained execution refs, and event enums through the canonical ops namespace", () => {
    expect(String(ops.workflowRepository.fields.project.range)).toBe(ops.workflowProject.values.id);
    expect(String(ops.workflowBranch.fields.project.range)).toBe(ops.workflowProject.values.id);
    expect(String(ops.workflowBranch.fields.goalDocument.range)).toBe(pkm.document.values.id);
    expect(String(ops.workflowBranch.fields.contextDocument.range)).toBe(pkm.document.values.id);
    expect(String(ops.workflowBranch.fields.activeCommit.range)).toBe(ops.workflowCommit.values.id);
    expect(String(ops.workflowCommit.fields.branch.range)).toBe(ops.workflowBranch.values.id);
    expect(String(ops.workflowCommit.fields.contextDocument.range)).toBe(pkm.document.values.id);
    expect(String(ops.repositoryBranch.fields.repository.range)).toBe(
      ops.workflowRepository.values.id,
    );
    expect(String(ops.repositoryCommit.fields.repositoryBranch.range)).toBe(
      ops.repositoryBranch.values.id,
    );
    expect(String(ops.repositoryCommit.fields.workflowCommit.range)).toBe(
      ops.workflowCommit.values.id,
    );
    expect(String(ops.repositoryCommit.fields.worktree.leaseState.range)).toBe(
      ops.repositoryCommitLeaseState.values.id,
    );
    expect(String(ops.agentSession.fields.project.range)).toBe(ops.workflowProject.values.id);
    expect(String(ops.agentSession.fields.repository.range)).toBe(ops.workflowRepository.values.id);
    expect(String(ops.agentSession.fields.subjectKind.range)).toBe(
      ops.agentSessionSubjectKind.values.id,
    );
    expect(String(ops.agentSession.fields.branch.range)).toBe(ops.workflowBranch.values.id);
    expect(String(ops.agentSession.fields.commit.range)).toBe(ops.workflowCommit.values.id);
    expect(String(ops.agentSession.fields.contextBundle.range)).toBe(ops.contextBundle.values.id);
    expect(String(ops.agentSession.fields.kind.range)).toBe(ops.agentSessionKind.values.id);
    expect(String(ops.agentSession.fields.runtimeState.range)).toBe(
      ops.agentSessionRuntimeState.values.id,
    );
    expect(String(ops.agentSessionEvent.fields.session.range)).toBe(ops.agentSession.values.id);
    expect(String(ops.agentSessionEvent.fields.type.range)).toBe(
      ops.agentSessionEventType.values.id,
    );
    expect(String(ops.agentSessionEvent.fields.phase.range)).toBe(
      ops.agentSessionEventPhase.values.id,
    );
    expect(String(ops.agentSessionEvent.fields.statusCode.range)).toBe(
      ops.agentSessionStatusCode.values.id,
    );
    expect(String(ops.agentSessionEvent.fields.format.range)).toBe(
      ops.agentSessionStatusFormat.values.id,
    );
    expect(String(ops.agentSessionEvent.fields.stream.range)).toBe(
      ops.agentSessionStream.values.id,
    );
    expect(String(ops.agentSessionEvent.fields.encoding.range)).toBe(
      ops.agentSessionRawLineEncoding.values.id,
    );
    expect(String(ops.workflowArtifact.fields.session.range)).toBe(ops.agentSession.values.id);
    expect(String(ops.workflowArtifact.fields.kind.range)).toBe(ops.workflowArtifactKind.values.id);
    expect(String(ops.workflowDecision.fields.session.range)).toBe(ops.agentSession.values.id);
    expect(String(ops.workflowDecision.fields.kind.range)).toBe(ops.workflowDecisionKind.values.id);
    expect(String(ops.contextBundle.fields.session.range)).toBe(ops.agentSession.values.id);
    expect(String(ops.contextBundle.fields.subjectKind.range)).toBe(
      ops.agentSessionSubjectKind.values.id,
    );
    expect(String(ops.contextBundleEntry.fields.bundle.range)).toBe(ops.contextBundle.values.id);
    expect(String(ops.contextBundleEntry.fields.source.range)).toBe(
      ops.contextBundleEntrySource.values.id,
    );
    expect(typeof ops.workflowProject.fields.projectKey.id).toBe("string");
    expect(typeof ops.agentSession.fields.sessionKey.id).toBe("string");
    expect(typeof ops.contextBundle.fields.bundleKey.id).toBe("string");
  });

  it("validates stable retained keys and defaults retained execution lifecycle fields", () => {
    expect(workflowProjectKeyPattern.test("project:io")).toBe(true);
    expect(workflowRepositoryKeyPattern.test("repo:io")).toBe(true);
    expect(workflowBranchKeyPattern.test("branch:workflow-graph-native")).toBe(true);
    expect(workflowCommitKeyPattern.test("commit:branch-runtime-view")).toBe(true);
    expect(agentSessionKeyPattern.test("session:branch-runtime-view-plan-01")).toBe(true);
    expect(contextBundleKeyPattern.test("bundle:branch-runtime-view-plan-01")).toBe(true);

    expect(
      ops.agentSession.fields.sessionKey.validate?.({
        event: "create",
        phase: "local",
        nodeId: "agent-session-1",
        now: new Date("2026-01-01T00:00:00.000Z"),
        path: [],
        field: "sessionKey",
        predicateKey: ops.agentSession.fields.sessionKey.key,
        range: ops.agentSession.fields.sessionKey.range,
        cardinality: ops.agentSession.fields.sessionKey.cardinality,
        value: "branch:runtime-view",
        previous: undefined,
        changedPredicateKeys: new Set<string>([ops.agentSession.fields.sessionKey.key]),
      }),
    ).toEqual({
      code: "workflow.key.invalid",
      message:
        'Session key must start with "session:" and use only lowercase letters, numbers, and hyphen-separated segments.',
    });

    expect(
      ops.contextBundleEntry.fields.order.validate?.({
        event: "create",
        phase: "local",
        nodeId: "context-bundle-entry-1",
        now: new Date("2026-01-01T00:00:00.000Z"),
        path: [],
        field: "order",
        predicateKey: ops.contextBundleEntry.fields.order.key,
        range: ops.contextBundleEntry.fields.order.range,
        cardinality: ops.contextBundleEntry.fields.order.cardinality,
        value: -1,
        previous: undefined,
        changedPredicateKeys: new Set<string>([ops.contextBundleEntry.fields.order.key]),
      }),
    ).toEqual({
      code: "workflow.integer.invalid",
      message: "Context entry order must be a non-negative integer.",
    });

    expect(ops.workflowProject.fields.inferred.onCreate?.(lifecycleContext)).toBe(true);
    expect(ops.repositoryBranch.fields.managed.onCreate?.(lifecycleContext)).toBe(false);
    expect(ops.workflowBranch.fields.state.onCreate?.(lifecycleContext)).toBe(
      ops.workflowBranchState.values.backlog.id,
    );
    expect(ops.workflowCommit.fields.state.onCreate?.(lifecycleContext)).toBe(
      ops.workflowCommitState.values.planned.id,
    );
    expect(ops.repositoryCommit.fields.state.onCreate?.(lifecycleContext)).toBe(
      ops.repositoryCommitState.values.planned.id,
    );
    expect(ops.repositoryCommit.fields.worktree.leaseState.onCreate?.(lifecycleContext)).toBe(
      ops.repositoryCommitLeaseState.values.unassigned.id,
    );
    expect(ops.agentSession.fields.runtimeState.onCreate?.(lifecycleContext)).toBe(
      ops.agentSessionRuntimeState.values.running.id,
    );
    expect(ops.agentSession.fields.startedAt.onCreate?.(lifecycleContext)).toBe(
      lifecycleContext.now,
    );
    expect(ops.agentSessionEvent.fields.timestamp.onCreate?.(lifecycleContext)).toBe(
      lifecycleContext.now,
    );
    expect(ops.contextBundleEntrySource.options.document.id).toEqual(expect.any(String));
  });

  it("preserves retained execution provenance across sessions, artifacts, decisions, and bundles", () => {
    const store = createStore();
    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, pkm, coreGraphBootstrapOptions);
    bootstrap(store, ops, coreGraphBootstrapOptions);
    const graph = createGraphClient(store, productGraph);

    const projectId = graph.workflowProject.create({
      name: "IO",
      projectKey: "project:io",
    });
    const repositoryId = graph.workflowRepository.create({
      name: "io",
      project: projectId,
      repositoryKey: "repo:io",
      repoRoot: "/tmp/io",
      defaultBaseBranch: "main",
    });
    const branchId = graph.workflowBranch.create({
      name: "Workflow authority",
      project: projectId,
      branchKey: "branch:workflow-authority",
      state: ops.workflowBranchState.values.ready.id,
    });
    const commitId = graph.workflowCommit.create({
      name: "Add contract tests",
      branch: branchId,
      commitKey: "commit:add-contract-tests",
      state: ops.workflowCommitState.values.active.id,
      order: 0,
    });
    const repositoryBranchId = graph.repositoryBranch.create({
      name: "workflow-authority",
      project: projectId,
      repository: repositoryId,
      workflowBranch: branchId,
      managed: true,
      branchName: "workflow-authority",
      baseBranchName: "main",
    });
    const repositoryCommitId = graph.repositoryCommit.create({
      name: "Add contract tests",
      repository: repositoryId,
      repositoryBranch: repositoryBranchId,
      workflowCommit: commitId,
      state: ops.repositoryCommitState.values.attached.id,
      worktree: {
        path: "/tmp/io-worktree",
        branchName: "workflow-authority",
        leaseState: ops.repositoryCommitLeaseState.values.attached.id,
      },
    });
    const sessionId = graph.agentSession.create({
      name: "Execute workflow contracts",
      project: projectId,
      repository: repositoryId,
      subjectKind: ops.agentSessionSubjectKind.values.commit.id,
      branch: branchId,
      commit: commitId,
      sessionKey: "session:workflow-authority-execution-01",
      kind: ops.agentSessionKind.values.execution.id,
      workerId: "worker-1",
    });
    const bundleId = graph.contextBundle.create({
      name: "Workflow execution bundle",
      session: sessionId,
      subjectKind: ops.agentSessionSubjectKind.values.commit.id,
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
      type: ops.agentSessionEventType.values.status.id,
      sequence: 0,
      statusCode: ops.agentSessionStatusCode.values["commit-selected"].id,
      format: ops.agentSessionStatusFormat.values.line.id,
      text: "Commit selected",
    });
    const artifactId = graph.workflowArtifact.create({
      name: "Patch summary",
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      session: sessionId,
      kind: ops.workflowArtifactKind.values.patch.id,
      bodyText: "Summarize the contract coverage.",
    });
    const decisionId = graph.workflowDecision.create({
      name: "Keep singleton repository scope",
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      session: sessionId,
      kind: ops.workflowDecisionKind.values.assumption.id,
      details: "Branch 6 v1 keeps one attached repository per graph.",
    });
    const entryId = graph.contextBundleEntry.create({
      name: "Branch 6 workflow contract",
      bundle: bundleId,
      order: 0,
      source: ops.contextBundleEntrySource.values["repo-path"].id,
      path: "doc/branch/06-workflow-and-agent-runtime.md",
      bodyText: "Workflow contract reference",
    });

    expect(graph.repositoryCommit.get(repositoryCommitId)).toMatchObject({
      repository: repositoryId,
      repositoryBranch: repositoryBranchId,
      workflowCommit: commitId,
      state: ops.repositoryCommitState.values.attached.id,
      worktree: {
        path: "/tmp/io-worktree",
        branchName: "workflow-authority",
        leaseState: ops.repositoryCommitLeaseState.values.attached.id,
      },
    });
    expect(graph.agentSession.get(sessionId)).toMatchObject({
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      contextBundle: bundleId,
      sessionKey: "session:workflow-authority-execution-01",
      subjectKind: ops.agentSessionSubjectKind.values.commit.id,
      kind: ops.agentSessionKind.values.execution.id,
    });
    expect(graph.agentSessionEvent.get(eventId)).toMatchObject({
      session: sessionId,
      type: ops.agentSessionEventType.values.status.id,
      statusCode: ops.agentSessionStatusCode.values["commit-selected"].id,
      format: ops.agentSessionStatusFormat.values.line.id,
    });
    expect(graph.workflowArtifact.get(artifactId)).toMatchObject({
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      session: sessionId,
      kind: ops.workflowArtifactKind.values.patch.id,
    });
    expect(graph.workflowDecision.get(decisionId)).toMatchObject({
      project: projectId,
      repository: repositoryId,
      branch: branchId,
      commit: commitId,
      session: sessionId,
      kind: ops.workflowDecisionKind.values.assumption.id,
    });
    expect(graph.contextBundle.get(bundleId)).toMatchObject({
      session: sessionId,
      branch: branchId,
      commit: commitId,
      bundleKey: "bundle:workflow-authority-execution-01",
      subjectKind: ops.agentSessionSubjectKind.values.commit.id,
    });
    expect(graph.contextBundleEntry.get(entryId)).toMatchObject({
      bundle: bundleId,
      order: 0,
      source: ops.contextBundleEntrySource.values["repo-path"].id,
      path: "doc/branch/06-workflow-and-agent-runtime.md",
    });
  });
});
