import { describe, expect, it } from "bun:test";

import {
  createLiveSyncActiveScopeId,
  defineLiveSyncRegistration,
  defineWebSocketLiveSyncClientMessage,
  defineWebSocketLiveSyncServerEvent,
  isWebSocketLiveSyncClientMessage,
  isWebSocketLiveSyncServerEvent,
  webSocketLiveSyncProtocol,
} from "./live-sync.js";
import {
  createProjectionDependencyKey,
  createScopeDependencyKey,
  defineInvalidationEvent,
} from "./projection.js";

const activeScopeId = createLiveSyncActiveScopeId({
  scopeId: "scope:ops/workflow:review",
  definitionHash: "scope-def:ops/workflow:review:v1",
  policyFilterVersion: "policy:0",
});

describe("live sync contracts", () => {
  it("defines shared active-scope registrations with explicit identity fields", () => {
    expect(
      defineLiveSyncRegistration({
        registrationId:
          "workflow-review:session:test:scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0",
        sessionId: "session:test",
        principalId: "principal:test",
        activeScopeId,
        scopeId: "scope:ops/workflow:review",
        definitionHash: "scope-def:ops/workflow:review:v1",
        policyFilterVersion: "policy:0",
        dependencyKeys: [
          createScopeDependencyKey("ops/workflow:review"),
          createProjectionDependencyKey("ops/workflow:project-branch-board"),
        ],
        expiresAt: "2026-03-24T00:01:00.000Z",
      }),
    ).toMatchObject({
      activeScopeId,
      scopeId: "scope:ops/workflow:review",
      policyFilterVersion: "policy:0",
    });

    expect(() =>
      defineLiveSyncRegistration({
        registrationId: "workflow-review:broken",
        sessionId: "session:test",
        principalId: "principal:test",
        activeScopeId: "scope:ops/workflow:review",
        scopeId: "scope:ops/workflow:review",
        definitionHash: "scope-def:ops/workflow:review:v1",
        policyFilterVersion: "policy:0",
        dependencyKeys: [createScopeDependencyKey("ops/workflow:review")],
        expiresAt: "2026-03-24T00:01:00.000Z",
      }),
    ).toThrow(
      'activeScopeId must match the shared scope identity "scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0".',
    );
  });

  it("validates websocket client messages for handshake, registration, renewal, unregister, and heartbeat", () => {
    const register = defineWebSocketLiveSyncClientMessage({
      direction: "client",
      kind: "register",
      protocol: webSocketLiveSyncProtocol,
      session: {
        socketSessionId: "socket:test",
        sessionId: "session:test",
        principalId: "principal:test",
      },
      scope: {
        activeScopeId,
        scopeId: "scope:ops/workflow:review",
        definitionHash: "scope-def:ops/workflow:review:v1",
        policyFilterVersion: "policy:0",
      },
      cursor: "web-authority:1",
      dependencyKeys: [
        createScopeDependencyKey("ops/workflow:review"),
        createProjectionDependencyKey("ops/workflow:project-branch-board"),
      ],
    });

    expect(register.kind).toBe("register");
    expect(isWebSocketLiveSyncClientMessage(register)).toBe(true);
    expect(
      defineWebSocketLiveSyncClientMessage({
        direction: "client",
        kind: "unregister",
        protocol: webSocketLiveSyncProtocol,
        session: {
          socketSessionId: "socket:test",
          sessionId: "session:test",
          principalId: "principal:test",
        },
        scope: {
          activeScopeId,
          scopeId: "scope:ops/workflow:review",
          definitionHash: "scope-def:ops/workflow:review:v1",
          policyFilterVersion: "policy:0",
        },
      }).kind,
    ).toBe("unregister");
    expect(
      isWebSocketLiveSyncClientMessage({
        direction: "client",
        kind: "register",
        protocol: "io.live-sync.v0",
      }),
    ).toBe(false);
  });

  it("validates websocket server events for lifecycle, invalidation, unregistration, and error envelopes", () => {
    const invalidation = defineInvalidationEvent({
      eventId: "workflow-review:cursor:2",
      graphId: "graph:test",
      sourceCursor: "web-authority:2",
      dependencyKeys: [
        createScopeDependencyKey("ops/workflow:review"),
        createProjectionDependencyKey("ops/workflow:project-branch-board"),
      ],
      affectedScopeIds: ["scope:ops/workflow:review"],
      delivery: { kind: "cursor-advanced" },
    });

    const event = defineWebSocketLiveSyncServerEvent({
      direction: "server",
      kind: "invalidation",
      protocol: webSocketLiveSyncProtocol,
      session: {
        socketSessionId: "socket:test",
        sessionId: "session:test",
        principalId: "principal:test",
      },
      scope: {
        activeScopeId,
        scopeId: "scope:ops/workflow:review",
        definitionHash: "scope-def:ops/workflow:review:v1",
        policyFilterVersion: "policy:0",
      },
      invalidation,
    });

    expect(event.invalidation).toEqual(invalidation);
    expect(isWebSocketLiveSyncServerEvent(event)).toBe(true);
    expect(
      defineWebSocketLiveSyncServerEvent({
        direction: "server",
        kind: "unregistration",
        protocol: webSocketLiveSyncProtocol,
        session: {
          socketSessionId: "socket:test",
          sessionId: "session:test",
          principalId: "principal:test",
        },
        scope: {
          activeScopeId,
          scopeId: "scope:ops/workflow:review",
          definitionHash: "scope-def:ops/workflow:review:v1",
          policyFilterVersion: "policy:0",
        },
        removed: true,
      }).kind,
    ).toBe("unregistration");
    expect(() =>
      defineWebSocketLiveSyncServerEvent({
        direction: "server",
        kind: "handshake",
        protocol: webSocketLiveSyncProtocol,
        session: {
          socketSessionId: "socket:test",
          sessionId: "session:test",
          principalId: "principal:test",
        },
        heartbeatIntervalMs: 0,
        sessionExpiresAt: "2026-03-24T00:01:00.000Z",
      }),
    ).toThrow("heartbeatIntervalMs must be a positive integer.");
  });
});
