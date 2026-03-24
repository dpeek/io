import type { DependencyKey, InvalidationEvent } from "./projection.js";

export const webSocketLiveSyncProtocol = "io.live-sync.v1";

export const webSocketLiveSyncClientMessageKinds = [
  "handshake",
  "register",
  "renew",
  "unregister",
  "heartbeat",
] as const;

export type WebSocketLiveSyncClientMessageKind =
  (typeof webSocketLiveSyncClientMessageKinds)[number];

export const webSocketLiveSyncServerEventKinds = [
  "handshake",
  "registration",
  "renewal",
  "unregistration",
  "heartbeat",
  "invalidation",
  "error",
] as const;

export type WebSocketLiveSyncServerEventKind = (typeof webSocketLiveSyncServerEventKinds)[number];

export interface LiveSyncActiveScopeIdentity {
  readonly activeScopeId: string;
  readonly scopeId: string;
  readonly definitionHash: string;
  readonly policyFilterVersion: string;
}

export interface LiveSyncRegistrationTarget extends LiveSyncActiveScopeIdentity {
  readonly sessionId: string;
  readonly principalId: string;
  readonly dependencyKeys: readonly DependencyKey[];
}

export interface LiveSyncRegistration extends LiveSyncRegistrationTarget {
  readonly registrationId: string;
  readonly expiresAt: string;
}

export interface WebSocketLiveSyncSocketSessionIdentity {
  readonly socketSessionId: string;
  readonly sessionId: string;
  readonly principalId: string;
}

type WebSocketLiveSyncMessageBase<Kind extends string, Direction extends "client" | "server"> = {
  readonly direction: Direction;
  readonly kind: Kind;
  readonly protocol: typeof webSocketLiveSyncProtocol;
};

export type WebSocketLiveSyncHandshakeMessage = WebSocketLiveSyncMessageBase<
  "handshake",
  "client"
> & {
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
};

export type WebSocketLiveSyncRegisterMessage = WebSocketLiveSyncMessageBase<
  "register",
  "client"
> & {
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
  readonly scope: LiveSyncActiveScopeIdentity;
  readonly cursor: string;
  readonly dependencyKeys: readonly DependencyKey[];
};

export type WebSocketLiveSyncRenewMessage = WebSocketLiveSyncMessageBase<"renew", "client"> & {
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
  readonly scope: LiveSyncActiveScopeIdentity;
};

export type WebSocketLiveSyncHeartbeatMessage = WebSocketLiveSyncMessageBase<
  "heartbeat",
  "client"
> & {
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
};

export type WebSocketLiveSyncUnregisterMessage = WebSocketLiveSyncMessageBase<
  "unregister",
  "client"
> & {
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
  readonly scope: LiveSyncActiveScopeIdentity;
};

export type WebSocketLiveSyncClientMessage =
  | WebSocketLiveSyncHandshakeMessage
  | WebSocketLiveSyncRegisterMessage
  | WebSocketLiveSyncRenewMessage
  | WebSocketLiveSyncUnregisterMessage
  | WebSocketLiveSyncHeartbeatMessage;

export type WebSocketLiveSyncHandshakeEvent = WebSocketLiveSyncMessageBase<
  "handshake",
  "server"
> & {
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
  readonly heartbeatIntervalMs: number;
  readonly sessionExpiresAt: string;
};

export type WebSocketLiveSyncRegistrationEvent = WebSocketLiveSyncMessageBase<
  "registration",
  "server"
> & {
  readonly registration: LiveSyncRegistration;
};

export type WebSocketLiveSyncRenewalEvent = WebSocketLiveSyncMessageBase<"renewal", "server"> & {
  readonly registration: LiveSyncRegistration;
};

export type WebSocketLiveSyncUnregistrationEvent = WebSocketLiveSyncMessageBase<
  "unregistration",
  "server"
> & {
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
  readonly scope: LiveSyncActiveScopeIdentity;
  readonly removed: boolean;
};

export type WebSocketLiveSyncHeartbeatEvent = WebSocketLiveSyncMessageBase<
  "heartbeat",
  "server"
> & {
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
  readonly receivedAt: string;
};

export type WebSocketLiveSyncInvalidationEvent = WebSocketLiveSyncMessageBase<
  "invalidation",
  "server"
> & {
  readonly session: WebSocketLiveSyncSocketSessionIdentity;
  readonly scope: LiveSyncActiveScopeIdentity;
  readonly invalidation: InvalidationEvent;
};

export type WebSocketLiveSyncErrorCode =
  | "unsupported-protocol"
  | "invalid-message"
  | "scope-changed"
  | "policy-changed"
  | "registration-expired"
  | "internal-error";

export type WebSocketLiveSyncErrorEvent = WebSocketLiveSyncMessageBase<"error", "server"> & {
  readonly session?: WebSocketLiveSyncSocketSessionIdentity;
  readonly scope?: LiveSyncActiveScopeIdentity;
  readonly code: WebSocketLiveSyncErrorCode;
  readonly message: string;
};

export type WebSocketLiveSyncServerEvent =
  | WebSocketLiveSyncHandshakeEvent
  | WebSocketLiveSyncRegistrationEvent
  | WebSocketLiveSyncRenewalEvent
  | WebSocketLiveSyncUnregistrationEvent
  | WebSocketLiveSyncHeartbeatEvent
  | WebSocketLiveSyncInvalidationEvent
  | WebSocketLiveSyncErrorEvent;

function assertNonEmptyString(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}

function assertIsoDate(value: string, label: string): void {
  assertNonEmptyString(value, label);
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function assertDependencyKeys(
  values: readonly DependencyKey[],
  label: string,
): readonly DependencyKey[] {
  if (values.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }

  const seen = new Set<string>();
  for (const value of values) {
    assertNonEmptyString(value, label);
    if (seen.has(value)) {
      throw new TypeError(`${label} must not contain duplicate values.`);
    }
    seen.add(value);
  }

  return Object.freeze([...values]);
}

export function createLiveSyncActiveScopeId(
  identity: Pick<LiveSyncActiveScopeIdentity, "scopeId" | "definitionHash" | "policyFilterVersion">,
): string {
  assertNonEmptyString(identity.scopeId, "scopeId");
  assertNonEmptyString(identity.definitionHash, "definitionHash");
  assertNonEmptyString(identity.policyFilterVersion, "policyFilterVersion");
  return `${identity.scopeId}:${identity.definitionHash}:${identity.policyFilterVersion}`;
}

export function defineLiveSyncActiveScopeIdentity<const T extends LiveSyncActiveScopeIdentity>(
  identity: T,
): Readonly<T> {
  assertNonEmptyString(identity.activeScopeId, "activeScopeId");
  assertNonEmptyString(identity.scopeId, "scopeId");
  assertNonEmptyString(identity.definitionHash, "definitionHash");
  assertNonEmptyString(identity.policyFilterVersion, "policyFilterVersion");

  const expectedActiveScopeId = createLiveSyncActiveScopeId(identity);
  if (identity.activeScopeId !== expectedActiveScopeId) {
    throw new TypeError(
      `activeScopeId must match the shared scope identity "${expectedActiveScopeId}".`,
    );
  }

  return Object.freeze({ ...identity });
}

export function defineWebSocketLiveSyncSocketSessionIdentity<
  const T extends WebSocketLiveSyncSocketSessionIdentity,
>(identity: T): Readonly<T> {
  assertNonEmptyString(identity.socketSessionId, "socketSessionId");
  assertNonEmptyString(identity.sessionId, "sessionId");
  assertNonEmptyString(identity.principalId, "principalId");

  return Object.freeze({ ...identity });
}

export function defineLiveSyncRegistrationTarget<const T extends LiveSyncRegistrationTarget>(
  target: T,
): Readonly<T> {
  defineLiveSyncActiveScopeIdentity(target);
  assertNonEmptyString(target.sessionId, "sessionId");
  assertNonEmptyString(target.principalId, "principalId");

  return Object.freeze({
    ...target,
    dependencyKeys: assertDependencyKeys(target.dependencyKeys, "dependencyKeys"),
  });
}

export function defineLiveSyncRegistration<const T extends LiveSyncRegistration>(
  registration: T,
): Readonly<T> {
  defineLiveSyncRegistrationTarget(registration);
  assertNonEmptyString(registration.registrationId, "registrationId");
  assertIsoDate(registration.expiresAt, "expiresAt");

  return Object.freeze({
    ...registration,
    dependencyKeys: assertDependencyKeys(registration.dependencyKeys, "dependencyKeys"),
  });
}

function assertProtocol(protocol: string): void {
  if (protocol !== webSocketLiveSyncProtocol) {
    throw new TypeError(`protocol must be "${webSocketLiveSyncProtocol}".`);
  }
}

export function defineWebSocketLiveSyncClientMessage<
  const T extends WebSocketLiveSyncClientMessage,
>(message: T): Readonly<T> {
  assertProtocol(message.protocol);
  if (message.direction !== "client") {
    throw new TypeError('direction must be "client".');
  }

  if (message.kind === "handshake") {
    return Object.freeze({
      ...message,
      session: defineWebSocketLiveSyncSocketSessionIdentity(message.session),
    }) as Readonly<T>;
  }

  if (message.kind === "heartbeat") {
    return Object.freeze({
      ...message,
      session: defineWebSocketLiveSyncSocketSessionIdentity(message.session),
    }) as Readonly<T>;
  }

  if (message.kind === "register") {
    assertNonEmptyString(message.cursor, "cursor");
    return Object.freeze({
      ...message,
      session: defineWebSocketLiveSyncSocketSessionIdentity(message.session),
      scope: defineLiveSyncActiveScopeIdentity(message.scope),
      dependencyKeys: assertDependencyKeys(message.dependencyKeys, "dependencyKeys"),
    }) as Readonly<T>;
  }

  return Object.freeze({
    ...message,
    session: defineWebSocketLiveSyncSocketSessionIdentity(message.session),
    scope: defineLiveSyncActiveScopeIdentity(message.scope),
  }) as Readonly<T>;
}

export function defineWebSocketLiveSyncServerEvent<const T extends WebSocketLiveSyncServerEvent>(
  event: T,
): Readonly<T> {
  assertProtocol(event.protocol);
  if (event.direction !== "server") {
    throw new TypeError('direction must be "server".');
  }

  if (event.kind === "handshake") {
    assertPositiveInteger(event.heartbeatIntervalMs, "heartbeatIntervalMs");
    assertIsoDate(event.sessionExpiresAt, "sessionExpiresAt");
    return Object.freeze({
      ...event,
      session: defineWebSocketLiveSyncSocketSessionIdentity(event.session),
    }) as Readonly<T>;
  }

  if (event.kind === "registration" || event.kind === "renewal") {
    return Object.freeze({
      ...event,
      registration: defineLiveSyncRegistration(event.registration),
    }) as Readonly<T>;
  }

  if (event.kind === "unregistration") {
    return Object.freeze({
      ...event,
      session: defineWebSocketLiveSyncSocketSessionIdentity(event.session),
      scope: defineLiveSyncActiveScopeIdentity(event.scope),
    }) as Readonly<T>;
  }

  if (event.kind === "heartbeat") {
    assertIsoDate(event.receivedAt, "receivedAt");
    return Object.freeze({
      ...event,
      session: defineWebSocketLiveSyncSocketSessionIdentity(event.session),
    }) as Readonly<T>;
  }

  if (event.kind === "invalidation") {
    return Object.freeze({
      ...event,
      session: defineWebSocketLiveSyncSocketSessionIdentity(event.session),
      scope: defineLiveSyncActiveScopeIdentity(event.scope),
    }) as Readonly<T>;
  }

  assertNonEmptyString(event.message, "message");
  if (event.session) {
    defineWebSocketLiveSyncSocketSessionIdentity(event.session);
  }
  if (event.scope) {
    defineLiveSyncActiveScopeIdentity(event.scope);
  }

  return Object.freeze({ ...event }) as Readonly<T>;
}

export function isWebSocketLiveSyncClientMessage(
  value: unknown,
): value is WebSocketLiveSyncClientMessage {
  try {
    defineWebSocketLiveSyncClientMessage(value as WebSocketLiveSyncClientMessage);
    return true;
  } catch {
    return false;
  }
}

export function isWebSocketLiveSyncServerEvent(
  value: unknown,
): value is WebSocketLiveSyncServerEvent {
  try {
    defineWebSocketLiveSyncServerEvent(value as WebSocketLiveSyncServerEvent);
    return true;
  } catch {
    return false;
  }
}
