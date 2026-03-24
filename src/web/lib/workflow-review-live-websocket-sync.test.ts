import { describe, expect, it } from "bun:test";

import { webSocketLiveSyncProtocol, type SyncState } from "@io/core/graph";
import {
  workflowReviewModuleReadScope,
  workflowReviewSyncScopeRequest,
} from "@io/core/graph/modules/ops/workflow";

import {
  createWorkflowReviewLiveWebSocketSync,
  type WorkflowReviewLiveClientSocket,
} from "./workflow-review-live-websocket-sync.js";

type TimerId = number;

class TestWorkflowReviewLiveClientSocket implements WorkflowReviewLiveClientSocket {
  readonly closeEvents: Array<{ code?: number; reason?: string }> = [];
  readonly sentMessages: string[] = [];
  private readonly closeListeners = new Set<(event: { code?: number; reason?: string }) => void>();
  private readonly errorListeners = new Set<(event: { error?: unknown }) => void>();
  private readonly messageListeners = new Set<(event: { data: unknown }) => void>();
  private readonly openListeners = new Set<() => void>();

  addEventListener(
    type: "close" | "error" | "message" | "open",
    listener:
      | ((event: { code?: number; reason?: string }) => void)
      | ((event: { error?: unknown }) => void)
      | ((event: { data: unknown }) => void)
      | (() => void),
  ): void {
    if (type === "close") {
      this.closeListeners.add(listener as (event: { code?: number; reason?: string }) => void);
      return;
    }
    if (type === "error") {
      this.errorListeners.add(listener as (event: { error?: unknown }) => void);
      return;
    }
    if (type === "message") {
      this.messageListeners.add(listener as (event: { data: unknown }) => void);
      return;
    }
    this.openListeners.add(listener as () => void);
  }

  close(code?: number, reason?: string): void {
    const event = { code, reason };
    this.closeEvents.push(event);
    for (const listener of this.closeListeners) {
      listener(event);
    }
  }

  send(message: string): void {
    this.sentMessages.push(message);
  }

  dispatchError(error?: unknown): void {
    for (const listener of this.errorListeners) {
      listener({ error });
    }
  }

  dispatchMessage(message: unknown): void {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    for (const listener of this.messageListeners) {
      listener({ data });
    }
  }

  dispatchOpen(): void {
    for (const listener of this.openListeners) {
      listener();
    }
  }
}

function createTimerHarness() {
  let nextId = 1;
  const timers = new Map<TimerId, () => void>();

  return {
    clearTimeout(id?: TimerId) {
      if (typeof id === "number") {
        timers.delete(id);
      }
    },
    runNext() {
      const next = timers.entries().next().value as [TimerId, () => void] | undefined;
      if (!next) {
        throw new Error("Expected a scheduled timer.");
      }
      timers.delete(next[0]);
      next[1]();
    },
    setTimeout(fn: () => void, _ms?: number) {
      const id = nextId;
      nextId += 1;
      timers.set(id, fn);
      return id;
    },
  };
}

function createWorkflowReviewState(
  overrides: Partial<Pick<SyncState, "cursor" | "status">> = {},
): SyncState {
  return {
    mode: "total",
    requestedScope: workflowReviewSyncScopeRequest,
    scope: {
      kind: "module",
      moduleId: workflowReviewModuleReadScope.moduleId,
      scopeId: workflowReviewModuleReadScope.scopeId,
      definitionHash: workflowReviewModuleReadScope.definitionHash,
      policyFilterVersion: "policy:0",
    },
    status: overrides.status ?? "ready",
    completeness: "complete",
    freshness: "current",
    pendingCount: 0,
    recentActivities: [],
    cursor:
      overrides.cursor ??
      "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
  };
}

function createHandshakeEvent() {
  return {
    direction: "server" as const,
    kind: "handshake" as const,
    protocol: webSocketLiveSyncProtocol,
    session: {
      socketSessionId: "socket:test",
      sessionId: "session:test",
      principalId: "principal:test",
    },
    heartbeatIntervalMs: 15_000,
    sessionExpiresAt: "2026-03-25T00:01:00.000Z",
  };
}

function createRegistrationEvent() {
  return {
    direction: "server" as const,
    kind: "registration" as const,
    protocol: webSocketLiveSyncProtocol,
    registration: {
      registrationId:
        "workflow-review:socket:test:scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0",
      sessionId: "socket:test",
      principalId: "principal:test",
      activeScopeId: "scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0",
      scopeId: workflowReviewModuleReadScope.scopeId,
      definitionHash: workflowReviewModuleReadScope.definitionHash,
      policyFilterVersion: "policy:0",
      dependencyKeys: ["scope:ops/workflow:review", "projection:ops/workflow:project-branch-board"],
      expiresAt: "2026-03-25T00:02:00.000Z",
    },
  };
}

describe("workflow review websocket live sync", () => {
  it("registers the active scoped cursor, heartbeats, and re-pulls on pushed invalidations", async () => {
    const timers = createTimerHarness();
    const sockets: TestWorkflowReviewLiveClientSocket[] = [];
    let syncCalls = 0;
    const controller = createWorkflowReviewLiveWebSocketSync(
      {
        getState: () => createWorkflowReviewState(),
        subscribe: () => () => {},
        sync: async () => {
          syncCalls += 1;
          return {
            mode: "incremental",
            after: "cursor:1",
            cursor: "cursor:2",
            scope: createWorkflowReviewState().scope,
            transactions: [],
            completeness: "complete",
            freshness: "current",
          };
        },
      },
      {
        clearScheduledTimeout: timers.clearTimeout as typeof clearTimeout,
        createSocket(url, protocols) {
          expect(url).toBe("wss://web.local/api/workflow-live");
          expect(protocols).toBe(webSocketLiveSyncProtocol);
          const socket = new TestWorkflowReviewLiveClientSocket();
          sockets.push(socket);
          return socket;
        },
        scheduleTimeout: timers.setTimeout as typeof setTimeout,
        url: "https://web.local/",
      },
    );

    controller.start();
    sockets[0]!.dispatchOpen();
    sockets[0]!.dispatchMessage(createHandshakeEvent());
    sockets[0]!.dispatchMessage(createRegistrationEvent());

    const handshakeAndRegister = sockets[0]!.sentMessages.map((message) => JSON.parse(message));
    expect(handshakeAndRegister).toMatchObject([
      {
        kind: "handshake",
        session: createHandshakeEvent().session,
      },
      {
        kind: "register",
        cursor: createWorkflowReviewState().cursor,
        dependencyKeys: [
          "scope:ops/workflow:review",
          "projection:ops/workflow:project-branch-board",
          "projection:ops/workflow:branch-commit-queue",
        ],
        scope: {
          scopeId: workflowReviewModuleReadScope.scopeId,
        },
      },
    ]);

    timers.runNext();
    expect(sockets[0]!.sentMessages.map((message) => JSON.parse(message).kind).slice(-2)).toEqual([
      "heartbeat",
      "renew",
    ]);

    sockets[0]!.dispatchMessage({
      direction: "server",
      kind: "invalidation",
      protocol: webSocketLiveSyncProtocol,
      session: createHandshakeEvent().session,
      scope: {
        activeScopeId: "scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0",
        scopeId: workflowReviewModuleReadScope.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:0",
      },
      invalidation: {
        eventId: "workflow-review:cursor:2",
        graphId: "graph:test",
        sourceCursor: "web-authority:2",
        dependencyKeys: ["scope:ops/workflow:review"],
        affectedScopeIds: [workflowReviewModuleReadScope.scopeId],
        delivery: { kind: "cursor-advanced" },
      },
    });
    await Promise.resolve();

    expect(syncCalls).toBe(1);
    expect(controller.getState()).toMatchObject({
      connected: true,
      status: "connected",
      registration: {
        sessionId: "socket:test",
      },
    });
  });

  it("reconnects, re-registers, and scoped re-pulls after socket loss", async () => {
    const timers = createTimerHarness();
    const sockets: TestWorkflowReviewLiveClientSocket[] = [];
    let syncCalls = 0;
    const controller = createWorkflowReviewLiveWebSocketSync(
      {
        getState: () => createWorkflowReviewState(),
        subscribe: () => () => {},
        sync: async () => {
          syncCalls += 1;
          return {
            mode: "incremental",
            after: "cursor:1",
            cursor: "cursor:2",
            scope: createWorkflowReviewState().scope,
            transactions: [],
            completeness: "complete",
            freshness: "current",
          };
        },
      },
      {
        clearScheduledTimeout: timers.clearTimeout as typeof clearTimeout,
        createSocket() {
          const socket = new TestWorkflowReviewLiveClientSocket();
          sockets.push(socket);
          return socket;
        },
        reconnectDelayMs: 5,
        scheduleTimeout: timers.setTimeout as typeof setTimeout,
        url: "https://web.local/",
      },
    );

    controller.start();
    sockets[0]!.dispatchMessage(createHandshakeEvent());
    sockets[0]!.dispatchMessage(createRegistrationEvent());

    sockets[0]!.close(1011, "connection lost");
    timers.runNext();

    sockets[1]!.dispatchMessage(createHandshakeEvent());
    sockets[1]!.dispatchMessage(createRegistrationEvent());
    await Promise.resolve();

    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.sentMessages.map((message) => JSON.parse(message).kind)).toEqual([
      "handshake",
      "register",
    ]);
    expect(syncCalls).toBe(1);
    expect(controller.getState()).toMatchObject({
      connected: true,
      reconnectCount: 1,
      status: "connected",
    });
  });
});
