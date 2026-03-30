import { describe, expect, it } from "bun:test";

import { createStore } from "@io/app/graph";
import { type AuthorizationContext } from "@io/graph-authority";
import { createGraphClient } from "@io/graph-client";
import { core } from "@io/graph-module-core";
import { type AgentSessionAppendRequest, workflow } from "@io/graph-module-workflow";

import { createAnonymousAuthorizationContext } from "./auth-bridge.js";
import {
  createTestWebAppAuthorityWithWorkflowFixture,
  executeTestAgentSessionAppend,
} from "./authority-test-helpers.js";
import type { WebAuthorityCommand } from "./authority.js";
import { handleWebCommandRequest } from "./server-routes.js";

const workflowSessionHistoryTimeout = 20_000;
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
  readonly kind?: "execution" | "planning" | "review";
  readonly projectId: string;
  readonly repositoryId?: string;
  readonly sessionKey?: string;
}): AgentSessionAppendRequest {
  return {
    session: {
      mode: "create",
      kind: input.kind ?? "execution",
      projectId: input.projectId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      retainedSession: {
        externalSessionId: "worker:workflow-authority:1",
        retainedRole: "worker",
        rootSessionId: "supervisor",
        parentSessionId: "supervisor",
        issue: {
          identifier: "OPE-475",
          title: "Bridge retained workflow session events into graph-backed session history writes",
        },
        runtime: {
          state: "running",
        },
        workspacePath: "/tmp/io-worktree",
      },
      sessionKey: input.sessionKey ?? "session:workflow-authority-execution-01",
      subject: {
        kind: "branch",
        branchId: input.branchId,
      },
      threadId: "thread-1",
      title: "Workflow authority execution",
      turnId: "turn-1",
      workerId: "worker-1",
    },
    events: [
      {
        type: "session",
        phase: "started",
        sequence: 1,
        timestamp: "2026-03-30T10:00:00.000Z",
      },
      {
        type: "status",
        code: "waiting-on-user-input",
        format: "line",
        sequence: 2,
        text: "Waiting on user input",
        timestamp: "2026-03-30T10:00:05.000Z",
      },
      {
        type: "raw-line",
        encoding: "text",
        line: "stdout line",
        sequence: 3,
        stream: "stdout",
        timestamp: "2026-03-30T10:00:10.000Z",
      },
    ],
  };
}

describe("workflow session history authority", () => {
  it(
    "creates a workflow session and appends ordered retained events",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const request = createAppendRequest(fixture);

      const result = await executeTestAgentSessionAppend(authority, authorization, request);

      expect(result).toEqual({
        ok: true,
        session: {
          sessionId: expect.any(String),
          status: "created",
        },
        events: [
          {
            bytes: expect.any(Number),
            fingerprint: expect.any(String),
            sequence: 1,
            status: "accepted",
          },
          {
            bytes: expect.any(Number),
            fingerprint: expect.any(String),
            sequence: 2,
            status: "accepted",
          },
          {
            bytes: expect.any(Number),
            fingerprint: expect.any(String),
            sequence: 3,
            status: "accepted",
          },
        ],
        nextExpectedSequence: 4,
      });

      if (!result.ok) {
        throw new Error("Expected agent session append to succeed.");
      }

      const graph = readProductGraph(authority, authorization);
      const persistedSession = graph.agentSession.get(result.session.sessionId);
      const persistedEvents = graph.agentSessionEvent
        .list()
        .filter((event) => event.session === result.session.sessionId)
        .sort((left, right) => left.sequence - right.sequence)
        .map((event) => graph.agentSessionEvent.get(event.id));

      expect(persistedSession).toMatchObject({
        name: "Workflow authority execution",
        project: fixture.projectId,
        repository: fixture.repositoryId,
        branch: fixture.branchId,
        sessionKey: "session:workflow-authority-execution-01",
        subjectKind: workflow.agentSessionSubjectKind.values.branch.id,
        kind: workflow.agentSessionKind.values.execution.id,
        threadId: "thread-1",
        turnId: "turn-1",
        workerId: "worker-1",
        runtimeState: workflow.agentSessionRuntimeState.values["awaiting-user-input"].id,
      });
      expect(persistedSession.startedAt.toISOString()).toBe("2026-03-30T10:00:00.000Z");
      expect(persistedEvents).toHaveLength(3);
      expect(persistedEvents[0]).toMatchObject({
        type: workflow.agentSessionEventType.values.session.id,
        phase: workflow.agentSessionEventPhase.values.started.id,
        sequence: 1,
      });
      expect(persistedEvents[1]).toMatchObject({
        type: workflow.agentSessionEventType.values.status.id,
        statusCode: workflow.agentSessionStatusCode.values["waiting-on-user-input"].id,
        format: workflow.agentSessionStatusFormat.values.line.id,
        sequence: 2,
        text: "Waiting on user input",
      });
      expect(persistedEvents[2]).toMatchObject({
        type: workflow.agentSessionEventType.values["raw-line"].id,
        encoding: workflow.agentSessionRawLineEncoding.values.text.id,
        line: "stdout line",
        sequence: 3,
        stream: workflow.agentSessionStream.values.stdout.id,
      });
    },
    workflowSessionHistoryTimeout,
  );

  it(
    "rejects a create retry that changes the graph session kind for the same session key",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const request = createAppendRequest(fixture);

      await executeTestAgentSessionAppend(authority, authorization, request);

      await expect(
        executeTestAgentSessionAppend(
          authority,
          authorization,
          createAppendRequest({
            ...fixture,
            kind: "review",
          }),
        ),
      ).rejects.toThrow(
        'Workflow session key "session:workflow-authority-execution-01" already belongs to a different session kind.',
      );
    },
    workflowSessionHistoryTimeout,
  );

  it(
    "rejects a create retry that changes the repository for the same session key",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const request = createAppendRequest({
        branchId: fixture.branchId,
        projectId: fixture.projectId,
      });

      await executeTestAgentSessionAppend(authority, authorization, request);

      await expect(
        executeTestAgentSessionAppend(
          authority,
          authorization,
          createAppendRequest({
            branchId: fixture.branchId,
            projectId: fixture.projectId,
            repositoryId: fixture.repositoryId,
          }),
        ),
      ).rejects.toThrow(
        'Workflow session key "session:workflow-authority-execution-01" already belongs to a different repository.',
      );
    },
    workflowSessionHistoryTimeout,
  );

  it(
    "acknowledges an exact create retry as existing plus duplicate events",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const request = createAppendRequest(fixture);

      const first = await executeTestAgentSessionAppend(authority, authorization, request);
      const retried = await executeTestAgentSessionAppend(authority, authorization, request);

      expect(first.ok).toBe(true);
      expect(retried).toEqual({
        ok: true,
        session: {
          sessionId: first.ok ? first.session.sessionId : "",
          status: "existing",
        },
        events: [
          {
            bytes: expect.any(Number),
            fingerprint: expect.any(String),
            sequence: 1,
            status: "duplicate",
          },
          {
            bytes: expect.any(Number),
            fingerprint: expect.any(String),
            sequence: 2,
            status: "duplicate",
          },
          {
            bytes: expect.any(Number),
            fingerprint: expect.any(String),
            sequence: 3,
            status: "duplicate",
          },
        ],
        nextExpectedSequence: 4,
      });

      const graph = readProductGraph(authority, authorization);
      expect(graph.agentSession.list()).toHaveLength(1);
      expect(graph.agentSessionEvent.list()).toHaveLength(3);
    },
    workflowSessionHistoryTimeout,
  );

  it(
    "accepts the agent-session-append envelope over /api/commands",
    async () => {
      const authorization = createTestAuthorizationContext();
      const { authority, fixture } =
        await createTestWebAppAuthorityWithWorkflowFixture(authorization);
      const request = createAppendRequest(fixture);

      const response = await handleWebCommandRequest(
        new Request("http://web.local/api/commands", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            kind: "agent-session-append",
            input: request,
          } satisfies WebAuthorityCommand),
        }),
        authority,
        authorization,
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        session: {
          status: "created",
        },
        nextExpectedSequence: 4,
      });
    },
    workflowSessionHistoryTimeout,
  );
});
