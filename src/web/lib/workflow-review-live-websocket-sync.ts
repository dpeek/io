import {
  createLiveSyncActiveScopeId,
  defineWebSocketLiveSyncServerEvent,
  webSocketLiveSyncProtocol,
  type DependencyKey,
  type LiveSyncRegistration,
  type SyncState,
  type SyncedTypeSyncController,
  type WebSocketLiveSyncServerEvent,
  type WebSocketLiveSyncSocketSessionIdentity,
} from "@io/core/graph";
import {
  compileWorkflowReviewScopeDependencyKeys,
  workflowReviewModuleReadScope,
} from "@io/core/graph/modules/ops/workflow";

import { webWorkflowLivePath } from "./workflow-live-transport.js";

type LiveSyncSocketMessageEvent = {
  readonly data: unknown;
};

type LiveSyncSocketCloseEvent = {
  readonly code?: number;
  readonly reason?: string;
};

type LiveSyncSocketErrorEvent = {
  readonly error?: unknown;
};

export type WorkflowReviewLiveClientSocket = {
  close(code?: number, reason?: string): void;
  send(message: string): void;
  addEventListener(type: "close", listener: (event: LiveSyncSocketCloseEvent) => void): void;
  addEventListener(type: "error", listener: (event: LiveSyncSocketErrorEvent) => void): void;
  addEventListener(type: "message", listener: (event: LiveSyncSocketMessageEvent) => void): void;
  addEventListener(type: "open", listener: () => void): void;
};

export type WorkflowReviewLiveSocketFactory = (
  url: string,
  protocols: string | string[],
) => WorkflowReviewLiveClientSocket;

export type WorkflowReviewLiveWebSocketSyncOptions = {
  readonly createSocket?: WorkflowReviewLiveSocketFactory;
  readonly path?: string;
  readonly reconnectDelayMs?: number;
  readonly scheduleTimeout?: typeof setTimeout;
  readonly clearScheduledTimeout?: typeof clearTimeout;
  readonly url?: string;
};

export type WorkflowReviewLiveWebSocketSyncState = {
  readonly connected: boolean;
  readonly error?: unknown;
  readonly lastSocketClose?: {
    readonly code?: number;
    readonly reason?: string;
  };
  readonly reconnectCount: number;
  readonly registration?: LiveSyncRegistration;
  readonly status: "stopped" | "connecting" | "connected";
};

export type WorkflowReviewLiveWebSocketSyncController = {
  start(): void;
  stop(): void;
  getState(): WorkflowReviewLiveWebSocketSyncState;
  subscribe(listener: WorkflowReviewLiveControllerListener): () => void;
};

type WorkflowReviewLiveSocketRegistrationInput = {
  readonly cursor: string;
  readonly dependencyKeys: readonly DependencyKey[];
  readonly scope: {
    readonly activeScopeId: string;
    readonly definitionHash: string;
    readonly policyFilterVersion: string;
    readonly scopeId: string;
  };
};

export type WorkflowReviewLiveControllerListener = (
  state: WorkflowReviewLiveWebSocketSyncState,
) => void;

const defaultReconnectDelayMs = 1_000;

function matchesWorkflowReviewLiveState(
  state: Pick<SyncState, "requestedScope" | "scope">,
): boolean {
  return (
    state.requestedScope.kind === "module" &&
    state.scope.kind === "module" &&
    state.requestedScope.moduleId === workflowReviewModuleReadScope.moduleId &&
    state.requestedScope.scopeId === workflowReviewModuleReadScope.scopeId &&
    state.scope.moduleId === workflowReviewModuleReadScope.moduleId &&
    state.scope.scopeId === workflowReviewModuleReadScope.scopeId
  );
}

function readWorkflowReviewRegistrationInput(
  state: Pick<SyncState, "cursor" | "requestedScope" | "scope">,
): WorkflowReviewLiveSocketRegistrationInput {
  if (!matchesWorkflowReviewLiveState(state)) {
    throw new Error(
      "Workflow review WebSocket live sync requires the shipped workflow-review scope to stay active.",
    );
  }
  if (typeof state.cursor !== "string" || state.cursor.length === 0) {
    throw new Error(
      "Workflow review WebSocket live sync requires the current scoped workflow-review cursor.",
    );
  }
  const scope = state.scope as Extract<SyncState["scope"], { kind: "module" }>;

  return Object.freeze({
    cursor: state.cursor,
    dependencyKeys: compileWorkflowReviewScopeDependencyKeys(),
    scope: {
      activeScopeId: createLiveSyncActiveScopeId({
        scopeId: scope.scopeId,
        definitionHash: scope.definitionHash,
        policyFilterVersion: scope.policyFilterVersion,
      }),
      scopeId: scope.scopeId,
      definitionHash: scope.definitionHash,
      policyFilterVersion: scope.policyFilterVersion,
    },
  });
}

function resolveSocketUrl(options: WorkflowReviewLiveWebSocketSyncOptions): string {
  const path = options.path ?? webWorkflowLivePath;
  const baseUrl =
    options.url ??
    (typeof window !== "undefined" && window.location.origin.length > 0
      ? window.location.origin
      : undefined) ??
    (typeof globalThis.location === "object" &&
    globalThis.location !== null &&
    typeof globalThis.location.origin === "string" &&
    globalThis.location.origin.length > 0
      ? globalThis.location.origin
      : undefined);
  if (!baseUrl) {
    throw new Error("Workflow review WebSocket live sync requires a base URL.");
  }

  const resolved = new URL(path, baseUrl);
  if (resolved.protocol === "http:") {
    resolved.protocol = "ws:";
  } else if (resolved.protocol === "https:") {
    resolved.protocol = "wss:";
  }
  return resolved.toString();
}

function defaultCreateSocket(
  url: string,
  protocols: string | string[],
): WorkflowReviewLiveClientSocket {
  return new WebSocket(url, protocols) as unknown as WorkflowReviewLiveClientSocket;
}

function publishControllerState(
  listeners: Set<WorkflowReviewLiveControllerListener>,
  state: WorkflowReviewLiveWebSocketSyncState,
): void {
  for (const listener of new Set(listeners)) {
    listener(state);
  }
}

function parseServerEvent(data: unknown): WebSocketLiveSyncServerEvent {
  if (typeof data !== "string") {
    throw new Error("Workflow review live socket events must be UTF-8 JSON strings.");
  }

  const decoded = JSON.parse(data) as WebSocketLiveSyncServerEvent;
  return defineWebSocketLiveSyncServerEvent(decoded);
}

export function createWorkflowReviewLiveWebSocketSync(
  sync: Pick<SyncedTypeSyncController, "getState" | "subscribe" | "sync">,
  options: WorkflowReviewLiveWebSocketSyncOptions = {},
): WorkflowReviewLiveWebSocketSyncController {
  const createSocket = options.createSocket ?? defaultCreateSocket;
  const reconnectDelayMs = options.reconnectDelayMs ?? defaultReconnectDelayMs;
  const scheduleTimeout = options.scheduleTimeout ?? setTimeout;
  const clearScheduledTimeout = options.clearScheduledTimeout ?? clearTimeout;
  const listeners = new Set<WorkflowReviewLiveControllerListener>();
  const socketUrl = resolveSocketUrl(options);

  let controllerState: WorkflowReviewLiveWebSocketSyncState = {
    connected: false,
    reconnectCount: 0,
    status: "stopped",
  };
  let socket: WorkflowReviewLiveClientSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let serverSession: WebSocketLiveSyncSocketSessionIdentity | null = null;
  let registration: LiveSyncRegistration | undefined;
  let stopped = true;
  let shouldReconnect = true;
  let needsRecoveryRefresh = false;
  let refreshPromise: Promise<void> | null = null;
  let refreshQueued = false;

  function updateState(
    update: Partial<WorkflowReviewLiveWebSocketSyncState>,
    replaceError = false,
  ): void {
    controllerState = {
      ...controllerState,
      ...update,
      registration,
      error: replaceError || "error" in update ? update.error : controllerState.error,
    };
    publishControllerState(listeners, controllerState);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearScheduledTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearHeartbeatTimer(): void {
    if (heartbeatTimer !== null) {
      clearScheduledTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function queueScopedRefresh(): Promise<void> {
    if (refreshPromise) {
      refreshQueued = true;
      return refreshPromise.then(() => undefined);
    }

    refreshPromise = (async () => {
      try {
        do {
          refreshQueued = false;
          await sync.sync();
        } while (refreshQueued);
      } finally {
        refreshPromise = null;
      }
    })();

    try {
      await refreshPromise;
      updateState({ error: undefined });
    } catch (error) {
      updateState({ error }, true);
    }
  }

  function readRegistrationInput(): WorkflowReviewLiveSocketRegistrationInput {
    return readWorkflowReviewRegistrationInput(sync.getState());
  }

  function sendClientHandshakeAndRegister(session: WebSocketLiveSyncSocketSessionIdentity): void {
    const registrationInput = readRegistrationInput();
    socket?.send(
      JSON.stringify({
        direction: "client",
        kind: "handshake",
        protocol: webSocketLiveSyncProtocol,
        session,
      }),
    );
    socket?.send(
      JSON.stringify({
        direction: "client",
        kind: "register",
        protocol: webSocketLiveSyncProtocol,
        session,
        scope: registrationInput.scope,
        cursor: registrationInput.cursor,
        dependencyKeys: registrationInput.dependencyKeys,
      }),
    );
  }

  function sendHeartbeat(): void {
    if (!socket || !serverSession) {
      return;
    }

    socket.send(
      JSON.stringify({
        direction: "client",
        kind: "heartbeat",
        protocol: webSocketLiveSyncProtocol,
        session: serverSession,
      }),
    );
    if (registration) {
      socket.send(
        JSON.stringify({
          direction: "client",
          kind: "renew",
          protocol: webSocketLiveSyncProtocol,
          session: serverSession,
          scope: {
            activeScopeId: registration.activeScopeId,
            scopeId: registration.scopeId,
            definitionHash: registration.definitionHash,
            policyFilterVersion: registration.policyFilterVersion,
          },
        }),
      );
    }
  }

  function scheduleHeartbeat(intervalMs: number): void {
    clearHeartbeatTimer();
    heartbeatTimer = scheduleTimeout(() => {
      heartbeatTimer = null;
      try {
        sendHeartbeat();
      } catch (error) {
        updateState({ error }, true);
        socket?.close(1011, "Workflow review live heartbeat failed.");
        return;
      }
      scheduleHeartbeat(intervalMs);
    }, intervalMs);
  }

  function scheduleReconnect(): void {
    if (stopped || !shouldReconnect || reconnectTimer !== null) {
      return;
    }

    reconnectTimer = scheduleTimeout(() => {
      reconnectTimer = null;
      if (!stopped && shouldReconnect) {
        openSocket(true);
      }
    }, reconnectDelayMs);
  }

  function handleServerEvent(event: WebSocketLiveSyncServerEvent): void {
    if (event.kind === "handshake") {
      serverSession = event.session;
      updateState({ connected: true, error: undefined, status: "connected" }, true);
      sendClientHandshakeAndRegister(event.session);
      scheduleHeartbeat(event.heartbeatIntervalMs);
      return;
    }

    if (event.kind === "registration" || event.kind === "renewal") {
      registration = event.registration;
      updateState({
        connected: true,
        error: undefined,
        registration,
        status: "connected",
      });
      if (needsRecoveryRefresh) {
        needsRecoveryRefresh = false;
        void queueScopedRefresh();
      }
      return;
    }

    if (event.kind === "invalidation" && event.invalidation.delivery.kind === "cursor-advanced") {
      void queueScopedRefresh();
      return;
    }

    if (event.kind === "error") {
      updateState({ error: new Error(event.message) }, true);
      if (event.code === "scope-changed" || event.code === "policy-changed") {
        shouldReconnect = false;
        void queueScopedRefresh();
      }
      return;
    }
  }

  function cleanupSocket(): void {
    socket = null;
    serverSession = null;
    registration = undefined;
    clearHeartbeatTimer();
  }

  function openSocket(isReconnect: boolean): void {
    cleanupSocket();
    updateState({
      connected: false,
      lastSocketClose: controllerState.lastSocketClose,
      reconnectCount: isReconnect
        ? controllerState.reconnectCount + 1
        : controllerState.reconnectCount,
      status: "connecting",
    });

    const nextSocket = createSocket(socketUrl, webSocketLiveSyncProtocol);
    socket = nextSocket;

    nextSocket.addEventListener("open", () => {
      updateState({ connected: false, status: "connecting" });
    });
    nextSocket.addEventListener("message", (event) => {
      try {
        handleServerEvent(parseServerEvent(event.data));
      } catch (error) {
        updateState({ error }, true);
        shouldReconnect = false;
        socket?.close(1007, "Workflow review live socket received an invalid event.");
      }
    });
    nextSocket.addEventListener("error", (event) => {
      updateState(
        {
          error: event.error ?? new Error("Workflow review live socket failed unexpectedly."),
        },
        true,
      );
    });
    nextSocket.addEventListener("close", (event) => {
      const lostConnection = controllerState.connected || registration !== undefined;
      cleanupSocket();
      updateState({
        connected: false,
        lastSocketClose: {
          code: event.code,
          reason: event.reason,
        },
        status: stopped ? "stopped" : "connecting",
      });
      if (!stopped && lostConnection) {
        needsRecoveryRefresh = true;
      }
      scheduleReconnect();
    });
  }

  return {
    start() {
      if (!stopped) {
        return;
      }

      readRegistrationInput();
      stopped = false;
      shouldReconnect = true;
      needsRecoveryRefresh = false;
      controllerState = {
        connected: false,
        reconnectCount: 0,
        status: "connecting",
      };
      publishControllerState(listeners, controllerState);
      openSocket(false);
    },
    stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      shouldReconnect = false;
      clearReconnectTimer();
      clearHeartbeatTimer();
      socket?.close(1000, "Workflow review live sync stopped.");
      cleanupSocket();
      updateState({
        connected: false,
        registration: undefined,
        status: "stopped",
      });
    },
    getState() {
      return controllerState;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
