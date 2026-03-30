import { describe, expect, it } from "bun:test";

import type { AgentSessionEvent, AgentSessionRef } from "./tui/index.js";

import {
  createAgentSessionAppendRequestFromRetainedEvents,
  mapRetainedAgentSessionEventToAppendEvent,
} from "./session-history.js";

function createSession(overrides: Partial<AgentSessionRef> = {}): AgentSessionRef {
  return {
    id: "worker:OPE-474:1",
    kind: "worker",
    rootSessionId: "supervisor",
    parentSessionId: "supervisor",
    title: "Define the graph-backed session append contract",
    workerId: "worker-1",
    issue: {
      identifier: "OPE-474",
      title: "Define the graph-backed session append contract",
    },
    workflow: {
      stream: {
        identifier: "OPE-455",
        title: "Workflow history",
      },
      task: {
        identifier: "OPE-474",
        state: "Todo",
        title: "Define the graph-backed session append contract",
      },
    },
    runtime: {
      state: "running",
    },
    ...overrides,
  };
}

function createStatusEvent(
  session: AgentSessionRef,
  overrides: Partial<Extract<AgentSessionEvent, { type: "status" }>> = {},
): Extract<AgentSessionEvent, { type: "status" }> {
  return {
    type: "status",
    code: "turn-started",
    format: "line",
    sequence: 1,
    session,
    text: "Starting turn",
    timestamp: "2026-03-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("agent session history append mapping", () => {
  it("maps retained events into a create request using launch context for graph subject and kind", () => {
    const firstSession = createSession();
    const finalSession = createSession({
      runtime: {
        state: "pending-finalization",
        finalization: {
          state: "pending",
        },
      },
      threadId: "thread-1",
      turnId: "turn-7",
    });
    const events: AgentSessionEvent[] = [
      createStatusEvent(firstSession),
      {
        type: "raw-line",
        encoding: "text",
        line: "stdout line",
        sequence: 2,
        session: finalSession,
        stream: "stdout",
        timestamp: "2026-03-30T10:00:05.000Z",
      },
    ];

    const request = createAgentSessionAppendRequestFromRetainedEvents({
      events,
      launch: {
        kind: "execution",
        projectId: "project-1",
        repositoryId: "repository-1",
        sessionKey: "session:ope-474-execution-01",
        subject: {
          kind: "commit",
          branchId: "branch-1",
          commitId: "commit-1",
        },
      },
    });

    expect(request).toEqual({
      session: {
        mode: "create",
        kind: "execution",
        projectId: "project-1",
        repositoryId: "repository-1",
        retainedSession: {
          branchName: undefined,
          externalSessionId: "worker:OPE-474:1",
          issue: {
            identifier: "OPE-474",
            title: "Define the graph-backed session append contract",
          },
          parentSessionId: "supervisor",
          retainedRole: "worker",
          rootSessionId: "supervisor",
          runtime: {
            state: "pending-finalization",
            finalization: {
              state: "pending",
            },
          },
          workflow: {
            stream: {
              identifier: "OPE-455",
              title: "Workflow history",
            },
            task: {
              identifier: "OPE-474",
              state: "Todo",
              title: "Define the graph-backed session append contract",
            },
          },
          workspacePath: undefined,
        },
        sessionKey: "session:ope-474-execution-01",
        startedAt: "2026-03-30T10:00:00.000Z",
        subject: {
          kind: "commit",
          branchId: "branch-1",
          commitId: "commit-1",
        },
        threadId: "thread-1",
        title: "Define the graph-backed session append contract",
        turnId: "turn-7",
        workerId: "worker-1",
      },
      events: [
        {
          type: "status",
          code: "turn-started",
          format: "line",
          sequence: 1,
          text: "Starting turn",
          timestamp: "2026-03-30T10:00:00.000Z",
        },
        {
          type: "raw-line",
          encoding: "text",
          line: "stdout line",
          sequence: 2,
          stream: "stdout",
          timestamp: "2026-03-30T10:00:05.000Z",
        },
      ],
    });
  });

  it("maps retained events into an append-only request when launch already resolved a session id", () => {
    const session = createSession();
    const event = createStatusEvent(session, {
      data: {
        workflowDiagnostics: {
          summaryText: "running",
        },
      },
    });

    const request = createAgentSessionAppendRequestFromRetainedEvents({
      events: [event],
      launch: {
        kind: "execution",
        projectId: "project-1",
        sessionId: "agent-session-1",
        sessionKey: "session:ope-474-execution-01",
        subject: {
          kind: "branch",
          branchId: "branch-1",
        },
      },
    });

    expect(request).toEqual({
      session: {
        mode: "existing",
        sessionId: "agent-session-1",
      },
      events: [
        {
          type: "status",
          code: "turn-started",
          data: {
            workflowDiagnostics: {
              summaryText: "running",
            },
          },
          format: "line",
          sequence: 1,
          text: "Starting turn",
          timestamp: "2026-03-30T10:00:00.000Z",
        },
      ],
    });
  });

  it("preserves the type-specific retained event envelope when mapping one event", () => {
    const mapped = mapRetainedAgentSessionEventToAppendEvent({
      type: "codex-notification",
      method: "thread.updated",
      params: {
        threadId: "thread-1",
      },
      sequence: 4,
      session: createSession(),
      timestamp: "2026-03-30T10:00:10.000Z",
    });

    expect(mapped).toEqual({
      type: "codex-notification",
      method: "thread.updated",
      params: {
        threadId: "thread-1",
      },
      sequence: 4,
      timestamp: "2026-03-30T10:00:10.000Z",
    });
  });

  it("rejects retained batches that mix session ids", () => {
    const event = createStatusEvent(createSession());

    expect(() =>
      createAgentSessionAppendRequestFromRetainedEvents({
        events: [
          event,
          createStatusEvent(
            createSession({
              id: "worker:OPE-474:2",
            }),
            {
              sequence: 2,
              timestamp: "2026-03-30T10:00:01.000Z",
            },
          ),
        ],
        launch: {
          kind: "execution",
          projectId: "project-1",
          sessionKey: "session:ope-474-execution-01",
          subject: {
            kind: "branch",
            branchId: "branch-1",
          },
        },
      }),
    ).toThrow("Retained session append batches must contain exactly one session id.");
  });
});
