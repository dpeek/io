import { describe, expect, it } from "bun:test";

import type { ValidationResult, Workflow } from "../agent/types.js";
import { browserAgentSessionEventsPath } from "./transport.js";
import {
  createBrowserAgentServer,
  parseBrowserAgentCliArgs,
  type BrowserAgentLaunchCoordinator,
} from "./server.js";

function createWorkflowResult(): ValidationResult<Workflow> {
  return {
    ok: true,
    value: {
      agent: {
        maxConcurrentAgents: 1,
        maxRetryBackoffMs: 1,
        maxTurns: 1,
      },
      codex: {
        approvalPolicy: "never",
        command: "codex",
        readTimeoutMs: 1,
        stallTimeoutMs: 1,
        threadSandbox: "workspace-write",
        turnTimeoutMs: 1,
      },
      context: {
        docs: {},
        overrides: {},
        profiles: {},
      },
      entrypoint: {
        configPath: "/tmp/io.ts",
        kind: "io",
        promptPath: "/tmp/io.md",
      },
      entrypointContent: "prompt",
      hooks: {
        timeoutMs: 1,
      },
      issues: {
        defaultAgent: "execute",
        defaultProfile: "execute",
        routing: [],
      },
      modules: {},
      polling: {
        intervalMs: 1,
      },
      tracker: {
        activeStates: [],
        endpoint: "https://linear.local",
        kind: "linear",
        terminalStates: [],
      },
      tui: {
        graph: {
          kind: "http",
        },
        initialScope: {},
      },
      workspace: {
        root: "/tmp/workspace",
      },
    },
  };
}

describe("browser-agent server", () => {
  it("parses host, port, and workflow path CLI arguments", () => {
    expect(parseBrowserAgentCliArgs(["./io.ts", "--host", "0.0.0.0", "--port", "8123"])).toEqual({
      help: false,
      host: "0.0.0.0",
      port: 8123,
      workflowPath: "./io.ts",
    });
  });

  it("reports an unavailable runtime when the launch coordinator is missing", async () => {
    const server = createBrowserAgentServer(createWorkflowResult(), {
      now: () => new Date("2026-03-26T02:00:00.000Z"),
    });
    const response = await server.fetch(new Request("http://127.0.0.1:4317/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      runtime: {
        activeSessionLookupPath: "/active-session",
        launchPath: "/launch-session",
        sessionEventsPath: browserAgentSessionEventsPath,
        startedAt: "2026-03-26T02:00:00.000Z",
        status: "unavailable",
        statusMessage:
          "No shared workflow launch coordinator is configured for the local browser-agent runtime.",
        version: 1,
      },
    });
  });

  it("routes launch and active-session requests through the shared coordinator", async () => {
    const calls: string[] = [];
    const coordinator: BrowserAgentLaunchCoordinator = {
      async launchSession(request) {
        calls.push(`launch:${request.subject.kind}:${request.projectId}`);
        return {
          ok: true,
          outcome: "attached",
          session: {
            id: "session:1",
            kind: request.kind,
            runtimeState: "running",
            sessionKey: "session:key:1",
            startedAt: "2026-03-26T02:00:00.000Z",
            subject: request.subject,
          },
          attach: {
            attachToken: "attach:1",
            browserAgentSessionId: "browser-agent:1",
            expiresAt: "2026-03-26T03:00:00.000Z",
            transport: "browser-agent-http",
          },
          workspace: {
            repositoryId: "repo:1",
          },
          authority: {
            auditActorPrincipalId: request.actor.principalId,
            appendGrant: {
              allowedActions: ["append-session-events", "write-artifact", "write-decision"],
              expiresAt: "2026-03-26T03:00:00.000Z",
              grantId: "grant:1",
              grantToken: "grant-token:1",
              issuedAt: "2026-03-26T02:00:00.000Z",
              sessionId: "session:1",
            },
          },
        };
      },
      async lookupActiveSession(request) {
        calls.push(`lookup:${request.subject.kind}:${request.projectId}`);
        return {
          ok: true,
          found: false,
        };
      },
      async observeSessionEvents(request, observer) {
        calls.push(`stream:${request.sessionId}:${request.attach.browserAgentSessionId}`);
        observer({
          browserAgentSessionId: request.attach.browserAgentSessionId,
          event: {
            type: "session",
            phase: "started",
            sequence: 1,
            timestamp: "2026-03-26T02:00:00.000Z",
          },
          sessionId: request.sessionId,
          type: "event",
        });
      },
    };
    const server = createBrowserAgentServer(createWorkflowResult(), {
      coordinator,
      now: () => new Date("2026-03-26T02:00:00.000Z"),
    });

    const launchResponse = await server.fetch(
      new Request("http://127.0.0.1:4317/launch-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actor: {
            principalId: "principal:1",
            sessionId: "session:web:1",
            surface: "browser",
          },
          kind: "execution",
          projectId: "project:1",
          subject: {
            kind: "branch",
            branchId: "branch:1",
          },
        }),
      }),
    );
    const lookupResponse = await server.fetch(
      new Request("http://127.0.0.1:4317/active-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actor: {
            principalId: "principal:1",
            sessionId: "session:web:1",
            surface: "browser",
          },
          kind: "execution",
          projectId: "project:1",
          subject: {
            kind: "branch",
            branchId: "branch:1",
          },
        }),
      }),
    );

    expect(launchResponse.status).toBe(200);
    expect((await launchResponse.json()) as { outcome: string }).toMatchObject({
      outcome: "attached",
      ok: true,
    });
    expect(lookupResponse.status).toBe(200);
    expect(await lookupResponse.json()).toEqual({
      ok: true,
      found: false,
    });
    expect(calls).toEqual(["launch:branch:project:1", "lookup:branch:project:1"]);
  });

  it("streams session events through the shared coordinator", async () => {
    const coordinator: BrowserAgentLaunchCoordinator = {
      async launchSession() {
        throw new Error("not implemented");
      },
      async lookupActiveSession() {
        return {
          ok: true,
          found: false,
        };
      },
      async observeSessionEvents(request, observer) {
        observer({
          browserAgentSessionId: request.attach.browserAgentSessionId,
          event: {
            type: "session",
            phase: "started",
            sequence: 1,
            timestamp: "2026-03-26T02:00:00.000Z",
          },
          sessionId: request.sessionId,
          type: "event",
        });
        observer({
          browserAgentSessionId: request.attach.browserAgentSessionId,
          event: {
            type: "status",
            code: "ready",
            format: "line",
            sequence: 2,
            text: "Running",
            timestamp: "2026-03-26T02:00:01.000Z",
          },
          sessionId: request.sessionId,
          type: "event",
        });
      },
    };
    const server = createBrowserAgentServer(createWorkflowResult(), {
      coordinator,
      now: () => new Date("2026-03-26T02:00:00.000Z"),
    });

    const response = await server.fetch(
      new Request(`http://127.0.0.1:4317${browserAgentSessionEventsPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          attach: {
            attachToken: "attach:1",
            browserAgentSessionId: "browser-agent:1",
            expiresAt: "2026-03-26T03:00:00.000Z",
            transport: "browser-agent-http",
          },
          sessionId: "session:1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      `${JSON.stringify({
        browserAgentSessionId: "browser-agent:1",
        event: {
          type: "session",
          phase: "started",
          sequence: 1,
          timestamp: "2026-03-26T02:00:00.000Z",
        },
        sessionId: "session:1",
        type: "event",
      })}\n${JSON.stringify({
        browserAgentSessionId: "browser-agent:1",
        event: {
          type: "status",
          code: "ready",
          format: "line",
          sequence: 2,
          text: "Running",
          timestamp: "2026-03-26T02:00:01.000Z",
        },
        sessionId: "session:1",
        type: "event",
      })}\n`,
    );
  });
});
