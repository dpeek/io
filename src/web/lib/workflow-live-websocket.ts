import {
  defineWebSocketLiveSyncClientMessage,
  defineWebSocketLiveSyncServerEvent,
  webSocketLiveSyncProtocol,
  type AuthorizationContext,
  type LiveSyncRegistration,
  type LiveSyncRegistrationTarget,
  type WebSocketLiveSyncClientMessage,
  type WebSocketLiveSyncSocketSessionIdentity,
  type WebSocketLiveSyncServerEvent,
} from "@io/core/graph";

import type { WebAppAuthority } from "./authority.js";
import type { WorkflowReviewLiveScopeRouter } from "./workflow-live-scope-router.js";

type LiveSyncSocketMessageEvent = {
  readonly data: unknown;
};

type LiveSyncSocketCloseEvent = {
  readonly code?: number;
  readonly reason?: string;
};

export type LiveSyncWebSocketLike = {
  accept(): void;
  close(code?: number, reason?: string): void;
  send(message: string): void;
  addEventListener(type: "close", listener: (event: LiveSyncSocketCloseEvent) => void): void;
  addEventListener(type: "message", listener: (event: LiveSyncSocketMessageEvent) => void): void;
};

export type LiveSyncWebSocketPair = {
  readonly client: LiveSyncWebSocketLike;
  readonly server: LiveSyncWebSocketLike;
};

type LiveSyncSocketServerState = {
  readonly deliveryCleanupByActiveScopeId: ReadonlyMap<string, () => void>;
  readonly expiresAt: string;
  readonly handshakeComplete: boolean;
  readonly registrations: ReadonlyMap<string, LiveSyncRegistration>;
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
};

export type WorkflowLiveWebSocketDependencies = {
  readonly createSocketPair?: () => LiveSyncWebSocketPair;
  readonly createSocketSessionId?: () => string;
  readonly heartbeatIntervalMs?: number;
  readonly now?: () => Date;
  readonly sessionTtlMs?: number;
};

export const defaultWorkflowLiveSocketHeartbeatIntervalMs = 15_000;
export const defaultWorkflowLiveSocketSessionTtlMs = 60_000;

const closeCodes = {
  invalidMessage: 1007,
  policyViolation: 1008,
} satisfies Record<"invalidMessage" | "policyViolation", number>;

class WorkflowLiveWebSocketProtocolError extends Error {
  readonly code:
    | "internal-error"
    | "invalid-message"
    | "policy-changed"
    | "registration-expired"
    | "scope-changed";
  readonly closeCode: number;

  constructor(
    code:
      | "internal-error"
      | "invalid-message"
      | "policy-changed"
      | "registration-expired"
      | "scope-changed",
    message: string,
    closeCode = closeCodes.policyViolation,
  ) {
    super(message);
    this.name = "WorkflowLiveWebSocketProtocolError";
    this.code = code;
    this.closeCode = closeCode;
  }
}

function createSocketPairFromRuntime(): LiveSyncWebSocketPair {
  const pairConstructor = (globalThis as { WebSocketPair?: new () => Record<number, WebSocket> })
    .WebSocketPair;
  if (typeof pairConstructor !== "function") {
    throw new Error("WebSocketPair is not available in this runtime.");
  }

  const pair = new pairConstructor();
  return {
    client: pair[0] as unknown as LiveSyncWebSocketLike,
    server: pair[1] as unknown as LiveSyncWebSocketLike,
  };
}

function createSessionIdentity(
  authorization: AuthorizationContext,
  createSocketSessionId: () => string,
): WebSocketLiveSyncSocketSessionIdentity {
  if (!authorization.sessionId || !authorization.principalId) {
    throw new Error("Workflow live WebSocket sessions require an authenticated session principal.");
  }

  return Object.freeze({
    socketSessionId: createSocketSessionId(),
    sessionId: authorization.sessionId,
    principalId: authorization.principalId,
  });
}

function createUpgradeResponse(socket: LiveSyncWebSocketLike): Response {
  const response = new Response(null, {
    status: 101,
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-protocol": webSocketLiveSyncProtocol,
    },
    webSocket: socket,
  } as ResponseInit & { webSocket: LiveSyncWebSocketLike });
  if ((response as Response & { webSocket?: unknown }).webSocket === undefined) {
    Object.defineProperty(response, "webSocket", {
      configurable: true,
      enumerable: true,
      value: socket,
    });
  }
  return response;
}

function createErrorResponse(message: string, status: number, code?: string): Response {
  return Response.json(code ? { error: message, code } : { error: message }, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function readRequestedProtocols(request: Request): readonly string[] {
  return (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseSocketMessage(data: unknown): WebSocketLiveSyncClientMessage {
  if (typeof data !== "string") {
    throw new WorkflowLiveWebSocketProtocolError(
      "invalid-message",
      "Workflow live socket messages must be UTF-8 JSON strings.",
      closeCodes.invalidMessage,
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(data);
  } catch {
    throw new WorkflowLiveWebSocketProtocolError(
      "invalid-message",
      "Workflow live socket messages must be valid JSON.",
      closeCodes.invalidMessage,
    );
  }

  try {
    return defineWebSocketLiveSyncClientMessage(decoded as WebSocketLiveSyncClientMessage);
  } catch (error) {
    throw new WorkflowLiveWebSocketProtocolError(
      "invalid-message",
      error instanceof Error ? error.message : "Workflow live socket messages are invalid.",
      closeCodes.invalidMessage,
    );
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((entry, index) => entry === sortedRight[index]);
}

function sameSession(
  left: WebSocketLiveSyncSocketSessionIdentity,
  right: WebSocketLiveSyncSocketSessionIdentity,
): boolean {
  return (
    left.socketSessionId === right.socketSessionId &&
    left.sessionId === right.sessionId &&
    left.principalId === right.principalId
  );
}

function createSocketState(
  session: WebSocketLiveSyncSocketSessionIdentity,
  expiresAt: string,
): LiveSyncSocketServerState {
  return {
    deliveryCleanupByActiveScopeId: new Map(),
    session,
    expiresAt,
    handshakeComplete: false,
    registrations: new Map(),
  };
}

function refreshSocketState(
  state: LiveSyncSocketServerState,
  now: Date,
  sessionTtlMs: number,
): LiveSyncSocketServerState {
  return {
    ...state,
    expiresAt: new Date(now.getTime() + sessionTtlMs).toISOString(),
  };
}

function withHandshake(
  state: LiveSyncSocketServerState,
  handshakeComplete: boolean,
): LiveSyncSocketServerState {
  return {
    ...state,
    handshakeComplete,
  };
}

function withRegistration(
  state: LiveSyncSocketServerState,
  registration: LiveSyncRegistration,
  deliveryCleanup: () => void,
): LiveSyncSocketServerState {
  const registrations = new Map(state.registrations);
  registrations.set(registration.activeScopeId, registration);
  const deliveryCleanupByActiveScopeId = new Map(state.deliveryCleanupByActiveScopeId);
  deliveryCleanupByActiveScopeId.set(registration.activeScopeId, deliveryCleanup);
  return {
    ...state,
    deliveryCleanupByActiveScopeId,
    registrations,
  };
}

function withoutRegistration(
  state: LiveSyncSocketServerState,
  activeScopeId: string,
): LiveSyncSocketServerState {
  if (!state.registrations.has(activeScopeId)) {
    return state;
  }

  const registrations = new Map(state.registrations);
  registrations.delete(activeScopeId);
  const deliveryCleanupByActiveScopeId = new Map(state.deliveryCleanupByActiveScopeId);
  const cleanup = deliveryCleanupByActiveScopeId.get(activeScopeId);
  cleanup?.();
  deliveryCleanupByActiveScopeId.delete(activeScopeId);
  return {
    ...state,
    deliveryCleanupByActiveScopeId,
    registrations,
  };
}

function sendServerEvent(socket: LiveSyncWebSocketLike, event: WebSocketLiveSyncServerEvent): void {
  socket.send(JSON.stringify(defineWebSocketLiveSyncServerEvent(event)));
}

function removeSocketRegistration(
  router: WorkflowReviewLiveScopeRouter,
  state: LiveSyncSocketServerState,
  activeScopeId: string,
): {
  readonly registration: LiveSyncRegistration | null;
  readonly state: LiveSyncSocketServerState;
} {
  const registration = state.registrations.get(activeScopeId) ?? null;
  if (!registration) {
    return {
      registration: null,
      state,
    };
  }

  router.remove({
    sessionId: state.session.socketSessionId,
    scopeId: registration.scopeId,
  });
  return {
    registration,
    state: withoutRegistration(state, activeScopeId),
  };
}

function removeAllSocketRegistrations(
  router: WorkflowReviewLiveScopeRouter,
  state: LiveSyncSocketServerState,
): LiveSyncSocketServerState {
  if (state.registrations.size === 0) {
    return state;
  }

  let nextState = state;
  for (const registration of state.registrations.values()) {
    nextState = removeSocketRegistration(router, nextState, registration.activeScopeId).state;
  }

  return nextState;
}

export function handleWorkflowLiveWebSocketUpgrade(
  request: Request,
  authority: WebAppAuthority,
  router: WorkflowReviewLiveScopeRouter,
  authorization: AuthorizationContext,
  dependencies: WorkflowLiveWebSocketDependencies = {},
): Response {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, POST" },
    });
  }

  if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
    return createErrorResponse("Workflow live socket upgrades require Upgrade: websocket.", 400);
  }

  const requestedProtocols = readRequestedProtocols(request);
  if (!requestedProtocols.includes(webSocketLiveSyncProtocol)) {
    return createErrorResponse(
      `Workflow live socket upgrades must request the "${webSocketLiveSyncProtocol}" protocol.`,
      426,
      "unsupported-protocol",
    );
  }

  if (!authorization.sessionId || !authorization.principalId) {
    return createErrorResponse(
      "Workflow live socket upgrades require an authenticated session principal.",
      401,
      "auth.unauthenticated",
    );
  }

  const now = dependencies.now ?? (() => new Date());
  const createSocketPair = dependencies.createSocketPair ?? createSocketPairFromRuntime;
  const createSocketSessionId = dependencies.createSocketSessionId ?? (() => crypto.randomUUID());
  const heartbeatIntervalMs =
    dependencies.heartbeatIntervalMs ?? defaultWorkflowLiveSocketHeartbeatIntervalMs;
  const sessionTtlMs = dependencies.sessionTtlMs ?? defaultWorkflowLiveSocketSessionTtlMs;

  const session = createSessionIdentity(authorization, createSocketSessionId);
  const pair = createSocketPair();
  const server = pair.server;
  const client = pair.client;

  let state = createSocketState(session, new Date(now().getTime() + sessionTtlMs).toISOString());
  let closed = false;

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    state = removeAllSocketRegistrations(router, state);
  };

  const sendProtocolError = (error: WorkflowLiveWebSocketProtocolError) => {
    sendServerEvent(server, {
      direction: "server",
      kind: "error",
      protocol: webSocketLiveSyncProtocol,
      session: state.handshakeComplete ? state.session : undefined,
      scope:
        state.registrations.size === 1
          ? {
              activeScopeId: [...state.registrations.values()][0]!.activeScopeId,
              scopeId: [...state.registrations.values()][0]!.scopeId,
              definitionHash: [...state.registrations.values()][0]!.definitionHash,
              policyFilterVersion: [...state.registrations.values()][0]!.policyFilterVersion,
            }
          : undefined,
      code: error.code,
      message: error.message,
    });
    cleanup();
    server.close(error.closeCode, error.message);
  };

  const assertActiveSession = () => {
    if (Date.parse(state.expiresAt) > now().getTime()) {
      return;
    }

    throw new WorkflowLiveWebSocketProtocolError(
      "registration-expired",
      "Workflow live socket session expired. Reconnect and register again.",
    );
  };

  server.accept();
  sendServerEvent(server, {
    direction: "server",
    kind: "handshake",
    protocol: webSocketLiveSyncProtocol,
    session: state.session,
    heartbeatIntervalMs,
    sessionExpiresAt: state.expiresAt,
  });
  server.addEventListener("close", cleanup);
  server.addEventListener("message", (event) => {
    try {
      assertActiveSession();
      const message = parseSocketMessage(event.data);

      if (!sameSession(message.session, state.session)) {
        throw new WorkflowLiveWebSocketProtocolError(
          "invalid-message",
          "Workflow live socket messages must target the current socket session identity.",
          closeCodes.invalidMessage,
        );
      }

      state = refreshSocketState(state, now(), sessionTtlMs);

      if (message.kind === "handshake") {
        state = withHandshake(state, true);
        return;
      }

      if (!state.handshakeComplete) {
        throw new WorkflowLiveWebSocketProtocolError(
          "invalid-message",
          "Workflow live socket sessions must handshake before other messages.",
          closeCodes.invalidMessage,
        );
      }

      if (message.kind === "heartbeat") {
        sendServerEvent(server, {
          direction: "server",
          kind: "heartbeat",
          protocol: webSocketLiveSyncProtocol,
          session: state.session,
          receivedAt: now().toISOString(),
        });
        return;
      }

      if (message.kind === "register") {
        const target = authority.planWorkflowReviewLiveRegistration(message.cursor, {
          authorization,
        });
        if (
          target.activeScopeId !== message.scope.activeScopeId ||
          target.scopeId !== message.scope.scopeId ||
          target.definitionHash !== message.scope.definitionHash ||
          target.policyFilterVersion !== message.scope.policyFilterVersion ||
          !sameStringArray(target.dependencyKeys, message.dependencyKeys)
        ) {
          throw new WorkflowLiveWebSocketProtocolError(
            "invalid-message",
            "Workflow live registration messages must match the current scope identity and dependency key plan.",
            closeCodes.invalidMessage,
          );
        }

        const socketTarget = {
          ...target,
          sessionId: state.session.socketSessionId,
        } satisfies LiveSyncRegistrationTarget;
        state = removeSocketRegistration(router, state, socketTarget.activeScopeId).state;
        const registration = router.register(socketTarget);
        const deliveryCleanup = router.attachInvalidationDelivery({
          sessionId: registration.sessionId,
          scopeId: registration.scopeId,
          deliver({ invalidation, registration }) {
            try {
              sendServerEvent(server, {
                direction: "server",
                kind: "invalidation",
                protocol: webSocketLiveSyncProtocol,
                session: state.session,
                scope: {
                  activeScopeId: registration.activeScopeId,
                  scopeId: registration.scopeId,
                  definitionHash: registration.definitionHash,
                  policyFilterVersion: registration.policyFilterVersion,
                },
                invalidation,
              });
            } catch (error) {
              cleanup();
              server.close(
                1011,
                "Workflow live invalidation delivery failed. Reconnect and register again.",
              );
              throw error;
            }
          },
        });
        state = withRegistration(state, registration, deliveryCleanup);
        sendServerEvent(server, {
          direction: "server",
          kind: "registration",
          protocol: webSocketLiveSyncProtocol,
          registration,
        });
        return;
      }

      const currentRegistration = state.registrations.get(message.scope.activeScopeId) ?? null;
      if (!currentRegistration) {
        throw new WorkflowLiveWebSocketProtocolError(
          "registration-expired",
          "Workflow live socket registration is no longer active. Register again.",
        );
      }

      if (
        currentRegistration.activeScopeId !== message.scope.activeScopeId ||
        currentRegistration.scopeId !== message.scope.scopeId ||
        currentRegistration.definitionHash !== message.scope.definitionHash ||
        currentRegistration.policyFilterVersion !== message.scope.policyFilterVersion
      ) {
        throw new WorkflowLiveWebSocketProtocolError(
          "scope-changed",
          `Workflow live scope "${message.scope.scopeId}" no longer matches the active registration.`,
        );
      }

      if (message.kind === "unregister") {
        const removed = removeSocketRegistration(router, state, currentRegistration.activeScopeId);
        state = removed.state;
        sendServerEvent(server, {
          direction: "server",
          kind: "unregistration",
          protocol: webSocketLiveSyncProtocol,
          session: state.session,
          scope: {
            activeScopeId: currentRegistration.activeScopeId,
            scopeId: currentRegistration.scopeId,
            definitionHash: currentRegistration.definitionHash,
            policyFilterVersion: currentRegistration.policyFilterVersion,
          },
          removed: removed.registration !== null,
        });
        return;
      }

      const renewed = router.register({
        activeScopeId: currentRegistration.activeScopeId,
        sessionId: currentRegistration.sessionId,
        principalId: currentRegistration.principalId,
        scopeId: currentRegistration.scopeId,
        definitionHash: currentRegistration.definitionHash,
        policyFilterVersion: currentRegistration.policyFilterVersion,
        dependencyKeys: currentRegistration.dependencyKeys,
      } satisfies LiveSyncRegistrationTarget);
      state = withRegistration(
        state,
        renewed,
        state.deliveryCleanupByActiveScopeId.get(currentRegistration.activeScopeId) ?? (() => {}),
      );
      sendServerEvent(server, {
        direction: "server",
        kind: "renewal",
        protocol: webSocketLiveSyncProtocol,
        registration: renewed,
      });
    } catch (error) {
      if (error instanceof WorkflowLiveWebSocketProtocolError) {
        sendProtocolError(error);
        return;
      }

      sendProtocolError(
        new WorkflowLiveWebSocketProtocolError(
          "internal-error",
          "Workflow live socket handling failed unexpectedly.",
        ),
      );
    }
  });

  return createUpgradeResponse(client);
}

export function createTestWorkflowLiveWebSocketPair(): {
  readonly client: TestWorkflowLiveWebSocket;
  readonly pair: LiveSyncWebSocketPair;
  readonly server: TestWorkflowLiveWebSocket;
} {
  const client = new TestWorkflowLiveWebSocket();
  const server = new TestWorkflowLiveWebSocket();

  client.peer = server;
  server.peer = client;

  return {
    client,
    pair: {
      client,
      server,
    },
    server,
  };
}

export class TestWorkflowLiveWebSocket implements LiveSyncWebSocketLike {
  peer: TestWorkflowLiveWebSocket | null = null;
  accepted = false;
  closeEvents: LiveSyncSocketCloseEvent[] = [];
  failSend: Error | null = null;
  readonly sentMessages: string[] = [];
  private readonly closeListeners = new Set<(event: LiveSyncSocketCloseEvent) => void>();
  private readonly messageListeners = new Set<(event: LiveSyncSocketMessageEvent) => void>();

  accept(): void {
    this.accepted = true;
  }

  addEventListener(
    type: "close" | "message",
    listener:
      | ((event: LiveSyncSocketCloseEvent) => void)
      | ((event: LiveSyncSocketMessageEvent) => void),
  ): void {
    if (type === "close") {
      this.closeListeners.add(listener as (event: LiveSyncSocketCloseEvent) => void);
      return;
    }

    this.messageListeners.add(listener as (event: LiveSyncSocketMessageEvent) => void);
  }

  close(code?: number, reason?: string): void {
    const event = { code, reason } satisfies LiveSyncSocketCloseEvent;
    this.closeEvents.push(event);
    for (const listener of this.closeListeners) {
      listener(event);
    }
    if (this.peer) {
      this.peer.closeEvents.push(event);
      for (const listener of this.peer.closeListeners) {
        listener(event);
      }
    }
  }

  send(message: string): void {
    if (this.failSend) {
      throw this.failSend;
    }
    this.sentMessages.push(message);
    const peer = this.peer;
    if (!peer) {
      return;
    }

    for (const listener of peer.messageListeners) {
      listener({ data: message });
    }
  }
}
