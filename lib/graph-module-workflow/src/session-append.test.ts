import { describe, expect, it } from "bun:test";

import {
  agentSessionAppendCommand,
  agentSessionAppendEventAckStatusValues,
  agentSessionAppendFailureCodes,
  agentSessionAppendRetainedRoleValues,
  agentSessionAppendRetainedRuntimeStateValues,
  agentSessionAppendSessionAckStatusValues,
  createAgentSessionAppendEventFingerprint,
  evaluateAgentSessionAppendRequest,
  type AgentSessionAppendRequest,
} from "./schema.js";

function createRequest(
  overrides: Partial<AgentSessionAppendRequest> = {},
): AgentSessionAppendRequest {
  return {
    session: {
      mode: "create",
      kind: "execution",
      projectId: "project-1",
      repositoryId: "repository-1",
      retainedSession: {
        externalSessionId: "worker:ope-474:1",
        retainedRole: "worker",
        rootSessionId: "supervisor",
        parentSessionId: "supervisor",
        issue: {
          identifier: "OPE-474",
          title: "Define the graph-backed session append contract",
        },
        runtime: {
          state: "running",
        },
      },
      sessionKey: "session:ope-474-execution-01",
      startedAt: "2026-03-30T10:00:00.000Z",
      subject: {
        kind: "commit",
        branchId: "branch-1",
        commitId: "commit-1",
      },
      title: "Define the graph-backed session append contract",
      workerId: "worker-1",
    },
    events: [
      {
        type: "session",
        phase: "started",
        sequence: 1,
        timestamp: "2026-03-30T10:00:00.000Z",
        data: {
          workflowDiagnostics: {
            summaryText: "ready",
          },
        },
      },
    ],
    ...overrides,
  };
}

describe("agent session append contract", () => {
  it("exports the append command and stable acknowledgement enums", () => {
    expect(agentSessionAppendCommand).toMatchObject({
      key: "workflow:agent-session-append",
      execution: "serverOnly",
    });
    expect(agentSessionAppendFailureCodes).toEqual([
      "subject-missing",
      "sequence-conflict",
      "event-too-large",
    ]);
    expect(agentSessionAppendSessionAckStatusValues).toEqual(["created", "existing"]);
    expect(agentSessionAppendEventAckStatusValues).toEqual(["accepted", "duplicate"]);
    expect(agentSessionAppendRetainedRoleValues).toEqual(["supervisor", "worker", "child"]);
    expect(agentSessionAppendRetainedRuntimeStateValues).toEqual([
      "blocked",
      "finalized",
      "interrupted",
      "pending-finalization",
      "running",
    ]);
  });

  it("accepts the next contiguous retained event and advances the stream acknowledgement", () => {
    const request = createRequest();
    const result = evaluateAgentSessionAppendRequest({
      request,
      session: {
        sessionId: "agent-session-1",
        status: "created",
      },
      nextExpectedSequence: 1,
    });

    expect(result).toEqual({
      ok: true,
      session: {
        sessionId: "agent-session-1",
        status: "created",
      },
      events: [
        {
          bytes: expect.any(Number),
          fingerprint: createAgentSessionAppendEventFingerprint(request.events[0]!),
          sequence: 1,
          status: "accepted",
        },
      ],
      nextExpectedSequence: 2,
    });
  });

  it("acknowledges an exact retry as a duplicate without advancing sequence state", () => {
    const request = createRequest({
      session: {
        mode: "existing",
        sessionId: "agent-session-1",
      },
    });
    const fingerprint = createAgentSessionAppendEventFingerprint(request.events[0]!);
    const result = evaluateAgentSessionAppendRequest({
      request,
      session: {
        sessionId: "agent-session-1",
        status: "existing",
      },
      nextExpectedSequence: 2,
      persistedEventFingerprints: new Map([[1, fingerprint]]),
    });

    expect(result).toEqual({
      ok: true,
      session: {
        sessionId: "agent-session-1",
        status: "existing",
      },
      events: [
        {
          bytes: expect.any(Number),
          fingerprint,
          sequence: 1,
          status: "duplicate",
        },
      ],
      nextExpectedSequence: 2,
    });
  });

  it("fails when a retried sequence changes the retained envelope", () => {
    const request = createRequest({
      session: {
        mode: "existing",
        sessionId: "agent-session-1",
      },
      events: [
        {
          type: "status",
          code: "turn-completed",
          format: "line",
          sequence: 1,
          timestamp: "2026-03-30T10:00:10.000Z",
          text: "Completed",
        },
      ],
    });
    const result = evaluateAgentSessionAppendRequest({
      request,
      session: {
        sessionId: "agent-session-1",
        status: "existing",
      },
      nextExpectedSequence: 2,
      persistedEventFingerprints: new Map([[1, "different-fingerprint"]]),
    });

    expect(result).toEqual({
      ok: false,
      code: "sequence-conflict",
      message: "Session event 1 conflicts with the already acknowledged event at that sequence.",
      details: {
        expectedSequence: 2,
        fingerprint: createAgentSessionAppendEventFingerprint(request.events[0]!),
        sequence: 1,
      },
    });
  });

  it("fails when a batch skips the next expected sequence", () => {
    const request = createRequest({
      session: {
        mode: "existing",
        sessionId: "agent-session-1",
      },
      events: [
        {
          type: "raw-line",
          encoding: "text",
          line: "stdout line",
          sequence: 3,
          stream: "stdout",
          timestamp: "2026-03-30T10:00:10.000Z",
        },
      ],
    });
    const result = evaluateAgentSessionAppendRequest({
      request,
      session: {
        sessionId: "agent-session-1",
        status: "existing",
      },
      nextExpectedSequence: 2,
    });

    expect(result).toEqual({
      ok: false,
      code: "sequence-conflict",
      message: "Session event 3 skipped the next expected sequence 2.",
      details: {
        expectedSequence: 2,
        fingerprint: createAgentSessionAppendEventFingerprint(request.events[0]!),
        sequence: 3,
      },
    });
  });

  it("fails when an event exceeds the configured byte budget", () => {
    const request = createRequest({
      session: {
        mode: "existing",
        sessionId: "agent-session-1",
      },
      events: [
        {
          type: "raw-line",
          encoding: "text",
          line: "This retained line is intentionally longer than the tiny test budget.",
          sequence: 2,
          stream: "stderr",
          timestamp: "2026-03-30T10:00:11.000Z",
        },
      ],
    });
    const result = evaluateAgentSessionAppendRequest({
      request,
      session: {
        sessionId: "agent-session-1",
        status: "existing",
      },
      nextExpectedSequence: 2,
      maxEventBytes: 32,
    });

    expect(result).toEqual({
      ok: false,
      code: "event-too-large",
      message: "Session event 2 exceeds the 32 byte limit.",
      details: {
        actualBytes: expect.any(Number),
        maxBytes: 32,
        sequence: 2,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details?.actualBytes).toBeGreaterThan(32);
    }
  });
});
