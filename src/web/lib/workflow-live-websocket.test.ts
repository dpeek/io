import { describe, expect, it } from "bun:test";

import {
  createLiveSyncActiveScopeId,
  defineInvalidationEvent,
  webSocketLiveSyncProtocol,
  type AuthorizationContext,
  type DependencyKey,
} from "@io/core/graph";
import { workflowReviewModuleReadScope } from "@io/core/graph/modules/ops/workflow";

import type { WebAppAuthority } from "./authority.js";
import { createWorkflowReviewLiveScopeRouter } from "./workflow-live-scope-router.js";
import {
  createTestWorkflowLiveWebSocketPair,
  handleWorkflowLiveWebSocketUpgrade,
  type TestWorkflowLiveWebSocket,
} from "./workflow-live-websocket.js";

const authorization: AuthorizationContext = {
  graphId: "graph:test",
  principalId: "principal:test",
  principalKind: "human",
  sessionId: "session:test",
  roleKeys: ["graph:member"],
  capabilityGrantIds: [],
  capabilityVersion: 0,
  policyVersion: 0,
};

function createAuthority(): WebAppAuthority {
  const registrations = new Map<
    string,
    {
      readonly activeScopeId: string;
      readonly definitionHash: string;
      readonly dependencyKeys: readonly string[];
      readonly policyFilterVersion: string;
      readonly scopeId: string;
    }
  >([
    [
      "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
      {
        activeScopeId: createLiveSyncActiveScopeId({
          scopeId: workflowReviewModuleReadScope.scopeId,
          definitionHash: workflowReviewModuleReadScope.definitionHash,
          policyFilterVersion: "policy:0",
        }),
        scopeId: workflowReviewModuleReadScope.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:0",
        dependencyKeys: [
          "projection:ops/workflow:project-branch-board",
          "scope:ops/workflow:review",
        ],
      },
    ],
    [
      "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Abacklog&definitionHash=scope-def%3Aops%2Fworkflow%3Abacklog%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A2",
      {
        activeScopeId: createLiveSyncActiveScopeId({
          scopeId: "scope:ops/workflow:backlog",
          definitionHash: "scope-def:ops/workflow:backlog:v1",
          policyFilterVersion: "policy:0",
        }),
        scopeId: "scope:ops/workflow:backlog",
        definitionHash: "scope-def:ops/workflow:backlog:v1",
        policyFilterVersion: "policy:0",
        dependencyKeys: ["scope:ops/workflow:backlog"],
      },
    ],
  ]);

  return {
    planWorkflowReviewLiveRegistration(
      cursor: string,
      { authorization }: { readonly authorization: AuthorizationContext },
    ) {
      const registration = registrations.get(cursor);
      expect(registration).toBeDefined();

      return {
        sessionId: authorization.sessionId ?? "",
        principalId: authorization.principalId ?? "",
        ...registration!,
      };
    },
  } as unknown as WebAppAuthority;
}

function createUpgradeRequest(): Request {
  return new Request("https://web.local/api/workflow-live", {
    method: "GET",
    headers: {
      upgrade: "websocket",
      "sec-websocket-protocol": webSocketLiveSyncProtocol,
    },
  });
}

function readSocketMessages(socket: TestWorkflowLiveWebSocket): unknown[] {
  return socket.sentMessages.map((message) => JSON.parse(message));
}

function createSocketSession() {
  return {
    socketSessionId: "socket:test",
    sessionId: "session:test",
    principalId: "principal:test",
  };
}

function reviewScope() {
  return {
    activeScopeId: "scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0",
    scopeId: workflowReviewModuleReadScope.scopeId,
    definitionHash: workflowReviewModuleReadScope.definitionHash,
    policyFilterVersion: "policy:0",
  };
}

function backlogScope() {
  return {
    activeScopeId: "scope:ops/workflow:backlog:scope-def:ops/workflow:backlog:v1:policy:0",
    scopeId: "scope:ops/workflow:backlog",
    definitionHash: "scope-def:ops/workflow:backlog:v1",
    policyFilterVersion: "policy:0",
  };
}

function sendHandshake(socket: TestWorkflowLiveWebSocket) {
  socket.send(
    JSON.stringify({
      direction: "client",
      kind: "handshake",
      protocol: webSocketLiveSyncProtocol,
      session: createSocketSession(),
    }),
  );
}

function sendRegister(
  socket: TestWorkflowLiveWebSocket,
  input: {
    readonly cursor: string;
    readonly dependencyKeys: readonly string[];
    readonly scope: ReturnType<typeof reviewScope> | ReturnType<typeof backlogScope>;
  },
) {
  socket.send(
    JSON.stringify({
      direction: "client",
      kind: "register",
      protocol: webSocketLiveSyncProtocol,
      session: createSocketSession(),
      scope: input.scope,
      cursor: input.cursor,
      dependencyKeys: input.dependencyKeys,
    }),
  );
}

function workflowInvalidation(
  overrides: {
    readonly affectedScopeIds?: readonly string[];
    readonly dependencyKeys?: readonly DependencyKey[];
    readonly eventId?: string;
    readonly sourceCursor?: string;
  } = {},
) {
  return defineInvalidationEvent({
    eventId: overrides.eventId ?? "workflow-review:cursor:1",
    graphId: "graph:test",
    sourceCursor: overrides.sourceCursor ?? "web-authority:1",
    dependencyKeys: overrides.dependencyKeys ?? [
      "projection:ops/workflow:project-branch-board",
      "scope:ops/workflow:review",
    ],
    affectedScopeIds: overrides.affectedScopeIds ?? [workflowReviewModuleReadScope.scopeId],
    delivery: { kind: "cursor-advanced" },
  });
}

describe("workflow live websocket transport", () => {
  it("accepts authenticated upgrade requests and binds workflow registrations to the socket session", () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-25T00:00:00.000Z"),
    });
    const sockets = createTestWorkflowLiveWebSocketPair();
    const response = handleWorkflowLiveWebSocketUpgrade(
      createUpgradeRequest(),
      createAuthority(),
      router,
      authorization,
      {
        createSocketPair: () => sockets.pair,
        createSocketSessionId: () => "socket:test",
        now: () => new Date("2026-03-25T00:00:00.000Z"),
      },
    );

    expect(response.status).toBe(101);
    expect(sockets.server.accepted).toBe(true);
    expect((response as Response & { webSocket?: unknown }).webSocket).toBe(sockets.client);

    sendHandshake(sockets.client);
    sendRegister(sockets.client, {
      scope: reviewScope(),
      cursor:
        "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
      dependencyKeys: ["projection:ops/workflow:project-branch-board", "scope:ops/workflow:review"],
    });

    expect(router.registrationsForSession("socket:test")).toHaveLength(1);
    expect(readSocketMessages(sockets.server)).toMatchObject([
      {
        kind: "handshake",
        session: createSocketSession(),
      },
      {
        kind: "registration",
        registration: {
          sessionId: "socket:test",
          principalId: "principal:test",
          scopeId: workflowReviewModuleReadScope.scopeId,
        },
      },
    ]);
  });

  it("rejects unauthenticated upgrade attempts before opening a socket", () => {
    const response = handleWorkflowLiveWebSocketUpgrade(
      createUpgradeRequest(),
      createAuthority(),
      createWorkflowReviewLiveScopeRouter(),
      {
        ...authorization,
        principalId: null,
        principalKind: null,
        sessionId: null,
      },
    );

    expect(response.status).toBe(401);
  });

  it("fails malformed client handshakes clearly and closes the socket", () => {
    const sockets = createTestWorkflowLiveWebSocketPair();
    handleWorkflowLiveWebSocketUpgrade(
      createUpgradeRequest(),
      createAuthority(),
      createWorkflowReviewLiveScopeRouter(),
      authorization,
      {
        createSocketPair: () => sockets.pair,
        createSocketSessionId: () => "socket:test",
      },
    );

    sockets.client.send(
      JSON.stringify({
        direction: "client",
        kind: "handshake",
        protocol: webSocketLiveSyncProtocol,
        session: {
          ...createSocketSession(),
          socketSessionId: "socket:wrong",
        },
      }),
    );

    expect(readSocketMessages(sockets.server)).toMatchObject([
      {
        kind: "handshake",
      },
      {
        kind: "error",
        code: "invalid-message",
      },
    ]);
    expect(sockets.client.closeEvents.at(-1)).toMatchObject({
      code: 1007,
    });
  });

  it("removes socket registrations when the client closes the session", () => {
    const router = createWorkflowReviewLiveScopeRouter();
    const sockets = createTestWorkflowLiveWebSocketPair();
    handleWorkflowLiveWebSocketUpgrade(
      createUpgradeRequest(),
      createAuthority(),
      router,
      authorization,
      {
        createSocketPair: () => sockets.pair,
        createSocketSessionId: () => "socket:test",
      },
    );

    sendHandshake(sockets.client);
    sendRegister(sockets.client, {
      scope: reviewScope(),
      cursor:
        "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
      dependencyKeys: ["projection:ops/workflow:project-branch-board", "scope:ops/workflow:review"],
    });
    sendRegister(sockets.client, {
      scope: backlogScope(),
      cursor:
        "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Abacklog&definitionHash=scope-def%3Aops%2Fworkflow%3Abacklog%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A2",
      dependencyKeys: ["scope:ops/workflow:backlog"],
    });

    expect(router.registrationsForSession("socket:test")).toHaveLength(2);
    sockets.client.close(1000, "done");
    expect(router.registrationsForSession("socket:test")).toHaveLength(0);
  });

  it("can renew and explicitly unregister one active scope without disturbing another", () => {
    let now = new Date("2026-03-25T00:00:00.000Z");
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => now,
    });
    const sockets = createTestWorkflowLiveWebSocketPair();
    handleWorkflowLiveWebSocketUpgrade(
      createUpgradeRequest(),
      createAuthority(),
      router,
      authorization,
      {
        createSocketPair: () => sockets.pair,
        createSocketSessionId: () => "socket:test",
        now: () => now,
      },
    );

    sendHandshake(sockets.client);
    sendRegister(sockets.client, {
      scope: reviewScope(),
      cursor:
        "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
      dependencyKeys: ["projection:ops/workflow:project-branch-board", "scope:ops/workflow:review"],
    });
    sendRegister(sockets.client, {
      scope: backlogScope(),
      cursor:
        "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Abacklog&definitionHash=scope-def%3Aops%2Fworkflow%3Abacklog%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A2",
      dependencyKeys: ["scope:ops/workflow:backlog"],
    });

    now = new Date("2026-03-25T00:00:30.000Z");
    sockets.client.send(
      JSON.stringify({
        direction: "client",
        kind: "renew",
        protocol: webSocketLiveSyncProtocol,
        session: createSocketSession(),
        scope: reviewScope(),
      }),
    );
    sockets.client.send(
      JSON.stringify({
        direction: "client",
        kind: "unregister",
        protocol: webSocketLiveSyncProtocol,
        session: createSocketSession(),
        scope: reviewScope(),
      }),
    );

    expect(router.registrationsForSession("socket:test")).toMatchObject([
      {
        scopeId: "scope:ops/workflow:backlog",
      },
    ]);
    expect(readSocketMessages(sockets.server)).toMatchObject([
      { kind: "handshake" },
      { kind: "registration", registration: { scopeId: workflowReviewModuleReadScope.scopeId } },
      { kind: "registration", registration: { scopeId: "scope:ops/workflow:backlog" } },
      {
        kind: "renewal",
        registration: {
          sessionId: "socket:test",
          scopeId: workflowReviewModuleReadScope.scopeId,
        },
      },
      {
        kind: "unregistration",
        session: createSocketSession(),
        scope: reviewScope(),
        removed: true,
      },
    ]);
  });

  it("pushes cursor-advanced invalidations over the socket for each matching active scope", () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-25T00:00:00.000Z"),
    });
    const sockets = createTestWorkflowLiveWebSocketPair();
    handleWorkflowLiveWebSocketUpgrade(
      createUpgradeRequest(),
      createAuthority(),
      router,
      authorization,
      {
        createSocketPair: () => sockets.pair,
        createSocketSessionId: () => "socket:test",
      },
    );

    sendHandshake(sockets.client);
    sendRegister(sockets.client, {
      scope: reviewScope(),
      cursor:
        "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
      dependencyKeys: ["projection:ops/workflow:project-branch-board", "scope:ops/workflow:review"],
    });
    sendRegister(sockets.client, {
      scope: backlogScope(),
      cursor:
        "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Abacklog&definitionHash=scope-def%3Aops%2Fworkflow%3Abacklog%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A2",
      dependencyKeys: ["scope:ops/workflow:backlog"],
    });

    const reviewInvalidation = workflowInvalidation();
    const backlogInvalidation = workflowInvalidation({
      eventId: "workflow-backlog:cursor:1",
      sourceCursor: "web-authority:2",
      dependencyKeys: ["scope:ops/workflow:backlog"],
      affectedScopeIds: [backlogScope().scopeId],
    });

    expect(router.publish(reviewInvalidation)).toMatchObject([
      { scopeId: workflowReviewModuleReadScope.scopeId },
    ]);
    expect(router.publish(backlogInvalidation)).toMatchObject([
      { scopeId: backlogScope().scopeId },
    ]);
    expect(readSocketMessages(sockets.server)).toMatchObject([
      { kind: "handshake" },
      { kind: "registration", registration: { scopeId: workflowReviewModuleReadScope.scopeId } },
      { kind: "registration", registration: { scopeId: backlogScope().scopeId } },
      {
        kind: "invalidation",
        session: createSocketSession(),
        scope: reviewScope(),
        invalidation: reviewInvalidation,
      },
      {
        kind: "invalidation",
        session: createSocketSession(),
        scope: backlogScope(),
        invalidation: backlogInvalidation,
      },
    ]);
    expect(
      router.pull({
        sessionId: "socket:test",
        scopeId: reviewScope().scopeId,
      }),
    ).toEqual({
      active: true,
      invalidations: [],
      scopeId: reviewScope().scopeId,
      sessionId: "socket:test",
    });
  });

  it("drops socket-bound registrations when invalidation delivery fails", () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-25T00:00:00.000Z"),
    });
    const sockets = createTestWorkflowLiveWebSocketPair();
    handleWorkflowLiveWebSocketUpgrade(
      createUpgradeRequest(),
      createAuthority(),
      router,
      authorization,
      {
        createSocketPair: () => sockets.pair,
        createSocketSessionId: () => "socket:test",
      },
    );

    sendHandshake(sockets.client);
    sendRegister(sockets.client, {
      scope: reviewScope(),
      cursor:
        "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
      dependencyKeys: ["projection:ops/workflow:project-branch-board", "scope:ops/workflow:review"],
    });

    sockets.server.failSend = new Error("socket closed");

    expect(router.publish(workflowInvalidation())).toEqual([]);
    expect(router.registrationsForSession("socket:test")).toEqual([]);
    expect(sockets.client.closeEvents.at(-1)).toMatchObject({
      code: 1011,
      reason: "Workflow live invalidation delivery failed. Reconnect and register again.",
    });
  });

  it("expires idle socket sessions and reports that the caller must reconnect", () => {
    let now = new Date("2026-03-25T00:00:00.000Z");
    const sockets = createTestWorkflowLiveWebSocketPair();
    handleWorkflowLiveWebSocketUpgrade(
      createUpgradeRequest(),
      createAuthority(),
      createWorkflowReviewLiveScopeRouter(),
      authorization,
      {
        createSocketPair: () => sockets.pair,
        createSocketSessionId: () => "socket:test",
        now: () => now,
        sessionTtlMs: 10,
      },
    );

    sendHandshake(sockets.client);

    now = new Date("2026-03-25T00:00:01.000Z");
    sockets.client.send(
      JSON.stringify({
        direction: "client",
        kind: "heartbeat",
        protocol: webSocketLiveSyncProtocol,
        session: createSocketSession(),
      }),
    );

    expect(readSocketMessages(sockets.server).at(-1)).toMatchObject({
      kind: "error",
      code: "registration-expired",
    });
    expect(sockets.client.closeEvents.at(-1)).toMatchObject({
      code: 1008,
    });
  });
});
