import { describe, expect, it } from "bun:test";

import type { AgentSessionEvent, AgentSessionRef } from "./tui/index.js";

import { AgentSessionHistoryBridge } from "./session-history-bridge.js";

function createSession(overrides: Partial<AgentSessionRef> = {}): AgentSessionRef {
  return {
    id: "worker:OPE-475:1",
    issue: {
      identifier: "OPE-475",
      title: "Bridge retained workflow session events into graph-backed session history writes",
    },
    kind: "worker",
    parentSessionId: "supervisor",
    rootSessionId: "supervisor",
    title: "Workflow session history bridge",
    workerId: "worker-1",
    ...overrides,
  };
}

function createStatusEvent(
  sequence: number,
  session: AgentSessionRef,
): Extract<AgentSessionEvent, { type: "status" }> {
  return {
    type: "status",
    code: "turn-started",
    format: "line",
    sequence,
    session,
    text: `Event ${sequence}`,
    timestamp: `2026-03-30T10:00:0${sequence}.000Z`,
  };
}

describe("agent session history bridge", () => {
  it("creates a session on the first append and reuses the authoritative session id afterwards", async () => {
    const requests: unknown[] = [];
    const bridge = new AgentSessionHistoryBridge({
      append: async (request) => {
        requests.push(request);
        return requests.length === 1
          ? {
              ok: true,
              session: {
                sessionId: "agent-session-1",
                status: "created",
              },
              events: [
                {
                  bytes: 128,
                  fingerprint: "event-1",
                  sequence: 1,
                  status: "accepted",
                },
              ],
              nextExpectedSequence: 2,
            }
          : {
              ok: true,
              session: {
                sessionId: "agent-session-1",
                status: "existing",
              },
              events: [
                {
                  bytes: 144,
                  fingerprint: "event-2",
                  sequence: 2,
                  status: "accepted",
                },
              ],
              nextExpectedSequence: 3,
            };
      },
      launch: {
        kind: "execution",
        projectId: "project-1",
        repositoryId: "repository-1",
        sessionKey: "session:workflow-authority-execution-01",
        subject: {
          kind: "branch",
          branchId: "branch-1",
        },
      },
    });

    await bridge.observe(createStatusEvent(1, createSession()));
    await bridge.observe(
      createStatusEvent(
        2,
        createSession({
          threadId: "thread-1",
          turnId: "turn-1",
        }),
      ),
    );
    await bridge.flush();

    expect(bridge.sessionId).toBe("agent-session-1");
    expect(bridge.nextExpectedSequence).toBe(3);
    expect(requests).toMatchObject([
      {
        session: {
          mode: "create",
          sessionKey: "session:workflow-authority-execution-01",
        },
      },
      {
        session: {
          mode: "existing",
          sessionId: "agent-session-1",
        },
      },
    ]);
  });

  it("accepts duplicate acknowledgements without moving sequence state backwards", async () => {
    const event = createStatusEvent(1, createSession());
    let calls = 0;
    const bridge = new AgentSessionHistoryBridge({
      append: async () => {
        calls += 1;
        return calls === 1
          ? {
              ok: true,
              session: {
                sessionId: "agent-session-1",
                status: "created",
              },
              events: [
                {
                  bytes: 128,
                  fingerprint: "event-1",
                  sequence: 1,
                  status: "accepted",
                },
              ],
              nextExpectedSequence: 2,
            }
          : {
              ok: true,
              session: {
                sessionId: "agent-session-1",
                status: "existing",
              },
              events: [
                {
                  bytes: 128,
                  fingerprint: "event-1",
                  sequence: 1,
                  status: "duplicate",
                },
              ],
              nextExpectedSequence: 2,
            };
      },
      launch: {
        kind: "execution",
        projectId: "project-1",
        sessionKey: "session:workflow-authority-execution-01",
        subject: {
          kind: "branch",
          branchId: "branch-1",
        },
      },
    });

    await bridge.observe(event);
    await bridge.observe(event);
    await bridge.flush();

    expect(bridge.sessionId).toBe("agent-session-1");
    expect(bridge.nextExpectedSequence).toBe(2);
  });
});
