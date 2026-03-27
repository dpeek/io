import { describe, expect, it } from "bun:test";

import { createStore } from "@io/core/graph";
import { type AuthorizationContext } from "@io/graph-authority";
import { createGraphClient } from "@io/graph-client";
import { core } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";

import { createAnonymousAuthorizationContext } from "./auth-bridge.js";
import {
  createTestWebAppAuthority,
  createTestWebAppAuthorityWithWorkflowFixture,
  executeTestWorkflowMutation as executeWorkflowMutation,
} from "./authority-test-helpers.js";
import { type WebAppAuthority } from "./authority.js";

const workflowAuthorityTimeout = 20_000;
const productGraph = { ...core, ...workflow } as const;

function createTestAuthorizationContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    ...createAnonymousAuthorizationContext({
      graphId: "graph:test",
      policyVersion: 0,
    }),
    principalId: "principal:authority",
    principalKind: "service",
    roleKeys: ["graph:authority"],
    sessionId: "session:authority",
    ...overrides,
  };
}

function readProductGraph(authority: WebAppAuthority, authorization: AuthorizationContext) {
  const store = createStore(authority.readSnapshot({ authorization }));
  return createGraphClient(store, productGraph);
}

describe("workflow authority", () => {
  it(
    "requires a managed repository target before marking a branch active",
    async () => {
      const authorization = createTestAuthorizationContext();
      const authority = await createTestWebAppAuthority();
      const project = await executeWorkflowMutation(authority, authorization, {
        action: "createProject",
        title: "IO",
        projectKey: "project:io",
      });
      await executeWorkflowMutation(authority, authorization, {
        action: "createRepository",
        projectId: project.summary.id,
        title: "io",
        repositoryKey: "repo:io",
        repoRoot: "/tmp/io",
        defaultBaseBranch: "main",
      });
      const branch = await executeWorkflowMutation(authority, authorization, {
        action: "createBranch",
        projectId: project.summary.id,
        title: "Unmapped branch",
        branchKey: "branch:unmapped-branch",
        state: "ready",
      });

      await expect(
        executeWorkflowMutation(authority, authorization, {
          action: "setBranchState",
          branchId: branch.summary.id,
          state: "active",
        }),
      ).rejects.toMatchObject({
        code: "repository-missing",
        status: 409,
      });
    },
    workflowAuthorityTimeout,
  );

  it(
    "attaches and updates a managed repository branch target in place",
    async () => {
      const authorization = createTestAuthorizationContext();
      const authority = await createTestWebAppAuthority();
      const project = await executeWorkflowMutation(authority, authorization, {
        action: "createProject",
        title: "IO",
        projectKey: "project:io",
      });
      const repository = await executeWorkflowMutation(authority, authorization, {
        action: "createRepository",
        projectId: project.summary.id,
        title: "io",
        repositoryKey: "repo:io",
        repoRoot: "/tmp/io",
        defaultBaseBranch: "main",
      });
      const branch = await executeWorkflowMutation(authority, authorization, {
        action: "createBranch",
        projectId: project.summary.id,
        title: "Workflow authority",
        branchKey: "branch:workflow-authority",
        state: "ready",
      });

      const created = await executeWorkflowMutation(authority, authorization, {
        action: "attachBranchRepositoryTarget",
        branchId: branch.summary.id,
        repositoryId: repository.summary.id,
        title: "Workflow authority repo branch",
        branchName: "workflow-authority",
        baseBranchName: "main",
        upstreamName: "origin/workflow-authority",
        headSha: "abc1234",
        worktreePath: "/tmp/io-worktree",
        latestReconciledAt: "2026-01-02T00:00:00.000Z",
      });

      expect(created).toMatchObject({
        action: "attachBranchRepositoryTarget",
        created: true,
        summary: {
          entity: "repository-branch",
          managed: true,
          projectId: project.summary.id,
          repositoryId: repository.summary.id,
          branchId: branch.summary.id,
          branchName: "workflow-authority",
          baseBranchName: "main",
          upstreamName: "origin/workflow-authority",
          headSha: "abc1234",
          worktreePath: "/tmp/io-worktree",
          latestReconciledAt: "2026-01-02T00:00:00.000Z",
        },
      });

      const updated = await executeWorkflowMutation(authority, authorization, {
        action: "attachBranchRepositoryTarget",
        branchId: branch.summary.id,
        repositoryId: repository.summary.id,
        repositoryBranchId: created.summary.id,
        title: "Workflow authority repo branch v2",
        branchName: "workflow-authority-v2",
        baseBranchName: "develop",
        upstreamName: null,
        headSha: null,
        worktreePath: null,
        latestReconciledAt: null,
      });
      const persisted = readProductGraph(authority, authorization).repositoryBranch.get(
        created.summary.id,
      );

      expect(updated).toMatchObject({
        action: "attachBranchRepositoryTarget",
        created: false,
        summary: {
          entity: "repository-branch",
          id: created.summary.id,
          title: "Workflow authority repo branch v2",
          managed: true,
          branchId: branch.summary.id,
          branchName: "workflow-authority-v2",
          baseBranchName: "develop",
        },
      });
      expect(persisted.managed).toBe(true);
      expect(persisted.branch).toBe(branch.summary.id);
      expect(persisted.branchName).toBe("workflow-authority-v2");
      expect(persisted.baseBranchName).toBe("develop");
      expect(persisted.upstreamName).toBeUndefined();
      expect(persisted.headSha).toBeUndefined();
      expect(persisted.worktreePath).toBeUndefined();
      expect(persisted.latestReconciledAt).toBeUndefined();
    },
    workflowAuthorityTimeout,
  );

  it(
    "rejects reusing a managed repository branch target across workflow branches",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const branch = await executeWorkflowMutation(authority, authorization, {
        action: "createBranch",
        projectId: fixture.projectId,
        title: "Conflicting branch",
        branchKey: "branch:conflicting-branch",
        state: "ready",
      });

      await expect(
        executeWorkflowMutation(authority, authorization, {
          action: "attachBranchRepositoryTarget",
          branchId: branch.summary.id,
          repositoryId: fixture.repositoryId,
          repositoryBranchId: fixture.repositoryBranchId,
          branchName: "workflow-authority",
          baseBranchName: "main",
        }),
      ).rejects.toMatchObject({
        code: "branch-lock-conflict",
        status: 409,
      });
    },
    workflowAuthorityTimeout,
  );

  it(
    "rejects marking an active branch done while open commits remain",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      await executeWorkflowMutation(authority, authorization, {
        action: "createCommit",
        branchId: fixture.branchId,
        title: "Open commit",
        commitKey: "commit:open-commit",
        order: 0,
        state: "ready",
      });
      await executeWorkflowMutation(authority, authorization, {
        action: "setBranchState",
        branchId: fixture.branchId,
        state: "active",
      });

      await expect(
        executeWorkflowMutation(authority, authorization, {
          action: "setBranchState",
          branchId: fixture.branchId,
          state: "done",
        }),
      ).rejects.toMatchObject({
        code: "invalid-transition",
        message: `Workflow branch "${fixture.branchId}" cannot be marked done while it still has open commits.`,
        status: 409,
      });
      expect(readProductGraph(authority, authorization).branch.get(fixture.branchId).state).toBe(
        workflow.branchState.values.active.id,
      );
    },
    workflowAuthorityTimeout,
  );

  it(
    "reconciles branch state and active commit through commit lifecycle transitions",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const commit = await executeWorkflowMutation(authority, authorization, {
        action: "createCommit",
        branchId: fixture.branchId,
        title: "Lifecycle commit",
        commitKey: "commit:lifecycle-commit",
        order: 0,
        state: "ready",
      });

      const active = await executeWorkflowMutation(authority, authorization, {
        action: "setCommitState",
        commitId: commit.summary.id,
        state: "active",
      });

      expect(active).toMatchObject({
        action: "setCommitState",
        created: false,
        summary: {
          entity: "commit",
          id: commit.summary.id,
          state: "active",
        },
      });
      expect(readProductGraph(authority, authorization).branch.get(fixture.branchId).state).toBe(
        workflow.branchState.values.active.id,
      );
      expect(
        readProductGraph(authority, authorization).branch.get(fixture.branchId).activeCommit,
      ).toBe(commit.summary.id);

      const blocked = await executeWorkflowMutation(authority, authorization, {
        action: "setCommitState",
        commitId: commit.summary.id,
        state: "blocked",
      });

      expect(blocked.summary).toMatchObject({
        entity: "commit",
        id: commit.summary.id,
        state: "blocked",
      });
      expect(readProductGraph(authority, authorization).branch.get(fixture.branchId).state).toBe(
        workflow.branchState.values.blocked.id,
      );
      expect(
        readProductGraph(authority, authorization).branch.get(fixture.branchId).activeCommit,
      ).toBeUndefined();

      const ready = await executeWorkflowMutation(authority, authorization, {
        action: "setCommitState",
        commitId: commit.summary.id,
        state: "ready",
      });

      expect(ready.summary).toMatchObject({
        entity: "commit",
        id: commit.summary.id,
        state: "ready",
      });
      expect(readProductGraph(authority, authorization).branch.get(fixture.branchId).state).toBe(
        workflow.branchState.values.ready.id,
      );
      expect(
        readProductGraph(authority, authorization).branch.get(fixture.branchId).activeCommit,
      ).toBeUndefined();
    },
    workflowAuthorityTimeout,
  );

  it(
    "requires a committed repository result before marking a workflow commit committed",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const commit = await executeWorkflowMutation(authority, authorization, {
        action: "createCommit",
        branchId: fixture.branchId,
        title: "Awaiting finalization",
        commitKey: "commit:awaiting-finalization",
        order: 0,
        state: "ready",
      });

      await executeWorkflowMutation(authority, authorization, {
        action: "setCommitState",
        commitId: commit.summary.id,
        state: "active",
      });
      await executeWorkflowMutation(authority, authorization, {
        action: "createRepositoryCommit",
        repositoryId: fixture.repositoryId,
        repositoryBranchId: fixture.repositoryBranchId,
        commitId: commit.summary.id,
        title: "Awaiting finalization",
        state: "attached",
        worktree: {
          path: "/tmp/io-worktree",
          branchName: "workflow-authority",
        },
      });

      await expect(
        executeWorkflowMutation(authority, authorization, {
          action: "setCommitState",
          commitId: commit.summary.id,
          state: "committed",
        }),
      ).rejects.toMatchObject({
        code: "invalid-transition",
        message: `Workflow commit "${commit.summary.id}" cannot be marked committed before its repository commit is committed.`,
        status: 409,
      });
    },
    workflowAuthorityTimeout,
  );

  it(
    "finalizes a workflow commit and clears the branch active commit through attachCommitResult",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const commit = await executeWorkflowMutation(authority, authorization, {
        action: "createCommit",
        branchId: fixture.branchId,
        title: "Finalized commit",
        commitKey: "commit:finalized-commit",
        order: 0,
        state: "ready",
      });

      await executeWorkflowMutation(authority, authorization, {
        action: "setCommitState",
        commitId: commit.summary.id,
        state: "active",
      });
      const repositoryCommit = await executeWorkflowMutation(authority, authorization, {
        action: "createRepositoryCommit",
        repositoryId: fixture.repositoryId,
        commitId: commit.summary.id,
        title: "Finalized commit",
        state: "attached",
        worktree: {
          path: "/tmp/io-worktree",
          branchName: "workflow-authority",
        },
      });

      const finalized = await executeWorkflowMutation(authority, authorization, {
        action: "attachCommitResult",
        repositoryCommitId: repositoryCommit.summary.id,
        sha: "abc1234",
      });

      expect(finalized).toMatchObject({
        action: "attachCommitResult",
        created: false,
        summary: {
          entity: "repository-commit",
          id: repositoryCommit.summary.id,
          state: "committed",
          commitId: commit.summary.id,
        },
      });
      expect(readProductGraph(authority, authorization).commit.get(commit.summary.id).state).toBe(
        workflow.commitState.values.committed.id,
      );
      expect(readProductGraph(authority, authorization).branch.get(fixture.branchId).state).toBe(
        workflow.branchState.values.done.id,
      );
      expect(
        readProductGraph(authority, authorization).branch.get(fixture.branchId).activeCommit,
      ).toBeUndefined();
    },
    workflowAuthorityTimeout,
  );
});
