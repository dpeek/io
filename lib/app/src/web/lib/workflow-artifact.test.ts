import { describe, expect, it } from "bun:test";

import { createStore } from "@io/app/graph";
import { type AuthorizationContext } from "@io/graph-authority";
import { createGraphClient } from "@io/graph-client";
import { core } from "@io/graph-module-core";
import {
  type AgentSessionAppendRequest,
  type ArtifactWriteRequest,
  workflow,
} from "@io/graph-module-workflow";

import { createAnonymousAuthorizationContext } from "./auth-bridge.js";
import {
  createTestWebAppAuthorityWithWorkflowFixture,
  executeTestAgentSessionAppend,
  executeTestWorkflowArtifactWrite,
  executeTestWorkflowMutation,
} from "./authority-test-helpers.js";
import type { WebAuthorityCommand } from "./authority.js";
import { handleWebCommandRequest } from "./server-routes.js";

const workflowArtifactTimeout = 20_000;
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

function readProductGraph(
  authority: Awaited<ReturnType<typeof createTestWebAppAuthorityWithWorkflowFixture>>["authority"],
  authorization: AuthorizationContext,
) {
  const store = createStore(authority.readSnapshot({ authorization }));
  return createGraphClient(store, productGraph);
}

function createAppendRequest(input: {
  readonly branchId: string;
  readonly commitId?: string;
  readonly kind?: "execution" | "planning" | "review";
  readonly projectId: string;
  readonly repositoryId?: string;
  readonly sessionKey: string;
}): AgentSessionAppendRequest {
  return {
    session: {
      mode: "create",
      kind: input.kind ?? "execution",
      projectId: input.projectId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      retainedSession: {
        externalSessionId: `${input.sessionKey}:external`,
        retainedRole: "worker",
        rootSessionId: "supervisor",
        parentSessionId: "supervisor",
        runtime: {
          state: "running",
        },
        workspacePath: "/tmp/io-worktree",
      },
      sessionKey: input.sessionKey,
      subject: input.commitId
        ? {
            kind: "commit",
            branchId: input.branchId,
            commitId: input.commitId,
          }
        : {
            kind: "branch",
            branchId: input.branchId,
          },
      threadId: `${input.sessionKey}:thread`,
      title: "Workflow artifact session",
      turnId: `${input.sessionKey}:turn`,
      workerId: "worker-1",
    },
    events: [
      {
        type: "session",
        phase: "started",
        sequence: 1,
        timestamp: "2026-03-30T10:00:00.000Z",
      },
    ],
  };
}

async function createWorkflowSession(input: {
  readonly authority: Awaited<
    ReturnType<typeof createTestWebAppAuthorityWithWorkflowFixture>
  >["authority"];
  readonly authorization: AuthorizationContext;
  readonly branchId: string;
  readonly commitId?: string;
  readonly kind?: "execution" | "planning" | "review";
  readonly projectId: string;
  readonly repositoryId?: string;
  readonly sessionKey: string;
}) {
  const result = await executeTestAgentSessionAppend(
    input.authority,
    input.authorization,
    createAppendRequest(input),
  );
  if (!result.ok) {
    throw new Error(`Expected workflow session creation to succeed: ${result.message}`);
  }
  return result.session.sessionId;
}

describe("workflow artifact authority", () => {
  it(
    "writes branch-scoped text artifacts with session provenance",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const sessionId = await createWorkflowSession({
        authority,
        authorization,
        branchId: fixture.branchId,
        kind: "planning",
        projectId: fixture.projectId,
        repositoryId: fixture.repositoryId,
        sessionKey: "session:workflow-branch-artifact-01",
      });

      const result = await executeTestWorkflowArtifactWrite(authority, authorization, {
        sessionId,
        kind: "summary",
        title: "Branch plan summary",
        mimeType: "text/markdown",
        bodyText: "# Summary\nPersist branch output.",
      });

      expect(result).toEqual({
        artifact: {
          id: expect.any(String),
          projectId: fixture.projectId,
          repositoryId: fixture.repositoryId,
          branchId: fixture.branchId,
          sessionId,
          kind: "summary",
          title: "Branch plan summary",
          mimeType: "text/markdown",
          bodyText: "# Summary\nPersist branch output.",
          createdAt: expect.any(String),
        },
      });

      const graph = readProductGraph(authority, authorization);
      expect(graph.artifact.get(result.artifact.id)).toMatchObject({
        project: fixture.projectId,
        repository: fixture.repositoryId,
        branch: fixture.branchId,
        session: sessionId,
        kind: workflow.artifactKind.values.summary.id,
        mimeType: "text/markdown",
        bodyText: "# Summary\nPersist branch output.",
      });
    },
    workflowArtifactTimeout,
  );

  it(
    "writes commit-scoped blob artifacts with commit provenance",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const commit = await executeTestWorkflowMutation(authority, authorization, {
        action: "createCommit",
        branchId: fixture.branchId,
        commitKey: "commit:workflow-artifact-provenance",
        order: 0,
        state: "ready",
        title: "Persist workflow artifact provenance",
      });
      const sessionId = await createWorkflowSession({
        authority,
        authorization,
        branchId: fixture.branchId,
        commitId: commit.summary.id,
        projectId: fixture.projectId,
        repositoryId: fixture.repositoryId,
        sessionKey: "session:workflow-commit-artifact-01",
      });

      const result = await executeTestWorkflowArtifactWrite(authority, authorization, {
        sessionId,
        kind: "file",
        title: "Patch bundle",
        mimeType: "application/zip",
        blobId: "blob:patch-bundle-01",
      });

      expect(result).toEqual({
        artifact: {
          id: expect.any(String),
          projectId: fixture.projectId,
          repositoryId: fixture.repositoryId,
          branchId: fixture.branchId,
          commitId: commit.summary.id,
          sessionId,
          kind: "file",
          title: "Patch bundle",
          mimeType: "application/zip",
          blobId: "blob:patch-bundle-01",
          createdAt: expect.any(String),
        },
      });

      const graph = readProductGraph(authority, authorization);
      expect(graph.artifact.get(result.artifact.id)).toMatchObject({
        project: fixture.projectId,
        repository: fixture.repositoryId,
        branch: fixture.branchId,
        commit: commit.summary.id,
        session: sessionId,
        kind: workflow.artifactKind.values.file.id,
        mimeType: "application/zip",
        blobId: "blob:patch-bundle-01",
      });
    },
    workflowArtifactTimeout,
  );

  it(
    "rejects artifact writes that mix inline text and blob-backed content",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const sessionId = await createWorkflowSession({
        authority,
        authorization,
        branchId: fixture.branchId,
        projectId: fixture.projectId,
        repositoryId: fixture.repositoryId,
        sessionKey: "session:workflow-artifact-validation-01",
      });

      await expect(
        executeTestWorkflowArtifactWrite(authority, authorization, {
          sessionId,
          kind: "summary",
          title: "Invalid mixed content artifact",
          bodyText: "Retained summary",
          blobId: "blob:artifact-invalid-01",
        }),
      ).rejects.toThrow("Workflow artifact writes must use either bodyText or blobId, not both.");
    },
    workflowArtifactTimeout,
  );

  it(
    "accepts the artifact-write envelope over /api/commands",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const sessionId = await createWorkflowSession({
        authority,
        authorization,
        branchId: fixture.branchId,
        projectId: fixture.projectId,
        repositoryId: fixture.repositoryId,
        sessionKey: "session:workflow-artifact-command-01",
      });
      const command: WebAuthorityCommand = {
        kind: "artifact-write",
        input: {
          sessionId,
          kind: "summary",
          title: "HTTP artifact",
          bodyText: "Durable artifact body",
        } satisfies ArtifactWriteRequest,
      };

      const response = await handleWebCommandRequest(
        new Request("https://graph.local/api/commands", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(command),
        }),
        authority,
        authorization,
      );

      expect(response.status).toBe(201);
      expect((await response.json()) as { artifact: { sessionId: string } }).toMatchObject({
        artifact: {
          branchId: fixture.branchId,
          kind: "summary",
          sessionId,
          title: "HTTP artifact",
          bodyText: "Durable artifact body",
        },
      });
    },
    workflowArtifactTimeout,
  );
});
