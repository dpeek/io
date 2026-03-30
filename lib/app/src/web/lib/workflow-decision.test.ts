import { describe, expect, it } from "bun:test";

import { createStore } from "@io/app/graph";
import { type AuthorizationContext } from "@io/graph-authority";
import { createGraphClient } from "@io/graph-client";
import { core } from "@io/graph-module-core";
import {
  type AgentSessionAppendRequest,
  type DecisionWriteRequest,
  workflow,
} from "@io/graph-module-workflow";

import { createAnonymousAuthorizationContext } from "./auth-bridge.js";
import {
  createTestWebAppAuthorityWithWorkflowFixture,
  executeTestAgentSessionAppend,
  executeTestWorkflowDecisionWrite,
  executeTestWorkflowMutation,
} from "./authority-test-helpers.js";
import type { WebAuthorityCommand } from "./authority.js";
import { handleWebCommandRequest } from "./server-routes.js";

const workflowDecisionTimeout = 20_000;
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
      title: "Workflow decision session",
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

describe("workflow decision authority", () => {
  it(
    "writes branch-scoped planning decisions with session provenance",
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
        sessionKey: "session:workflow-branch-decision-01",
      });

      const result = await executeTestWorkflowDecisionWrite(authority, authorization, {
        sessionId,
        decision: {
          kind: "plan",
          summary: "Persist the branch plan as workflow memory",
        },
      });

      expect(result).toEqual({
        decision: {
          id: expect.any(String),
          projectId: fixture.projectId,
          repositoryId: fixture.repositoryId,
          branchId: fixture.branchId,
          sessionId,
          kind: "plan",
          summary: "Persist the branch plan as workflow memory",
          createdAt: expect.any(String),
        },
      });

      const graph = readProductGraph(authority, authorization);
      expect(graph.decision.get(result.decision.id)).toMatchObject({
        project: fixture.projectId,
        repository: fixture.repositoryId,
        branch: fixture.branchId,
        session: sessionId,
        kind: workflow.decisionKind.values.plan.id,
        name: "Persist the branch plan as workflow memory",
      });
    },
    workflowDecisionTimeout,
  );

  it(
    "writes commit-scoped blocker decisions with commit provenance",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const commit = await executeTestWorkflowMutation(authority, authorization, {
        action: "createCommit",
        branchId: fixture.branchId,
        commitKey: "commit:workflow-decision-provenance",
        order: 0,
        state: "ready",
        title: "Persist workflow decision provenance",
      });
      const sessionId = await createWorkflowSession({
        authority,
        authorization,
        branchId: fixture.branchId,
        commitId: commit.summary.id,
        projectId: fixture.projectId,
        repositoryId: fixture.repositoryId,
        sessionKey: "session:workflow-commit-decision-01",
      });

      const result = await executeTestWorkflowDecisionWrite(authority, authorization, {
        sessionId,
        decision: {
          kind: "blocker",
          summary: "Await repository review",
          details: "The execution session is blocked until the branch owner reviews the plan.",
        },
      });

      expect(result).toEqual({
        decision: {
          id: expect.any(String),
          projectId: fixture.projectId,
          repositoryId: fixture.repositoryId,
          branchId: fixture.branchId,
          commitId: commit.summary.id,
          sessionId,
          kind: "blocker",
          summary: "Await repository review",
          details: "The execution session is blocked until the branch owner reviews the plan.",
          createdAt: expect.any(String),
        },
      });

      const graph = readProductGraph(authority, authorization);
      expect(graph.decision.get(result.decision.id)).toMatchObject({
        project: fixture.projectId,
        repository: fixture.repositoryId,
        branch: fixture.branchId,
        commit: commit.summary.id,
        session: sessionId,
        kind: workflow.decisionKind.values.blocker.id,
        name: "Await repository review",
        details: "The execution session is blocked until the branch owner reviews the plan.",
      });
    },
    workflowDecisionTimeout,
  );

  it(
    "rejects blocker decisions without non-empty details",
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
        sessionKey: "session:workflow-decision-validation-01",
      });

      await expect(
        executeTestWorkflowDecisionWrite(authority, authorization, {
          sessionId,
          decision: {
            kind: "blocker",
            summary: "Await design review",
            details: "  ",
          },
        }),
      ).rejects.toThrow("Workflow blocker decisions require non-empty details.");
    },
    workflowDecisionTimeout,
  );

  it(
    "accepts the decision-write envelope over /api/commands",
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
        sessionKey: "session:workflow-decision-command-01",
      });
      const command: WebAuthorityCommand = {
        kind: "decision-write",
        input: {
          sessionId,
          decision: {
            kind: "question",
            summary: "Should the planning session split the branch?",
            details: "The current summary mixes schema and authority work.",
          },
        } satisfies DecisionWriteRequest,
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
      expect((await response.json()) as { decision: { sessionId: string } }).toMatchObject({
        decision: {
          branchId: fixture.branchId,
          kind: "question",
          sessionId,
          summary: "Should the planning session split the branch?",
          details: "The current summary mixes schema and authority work.",
        },
      });
    },
    workflowDecisionTimeout,
  );
});
