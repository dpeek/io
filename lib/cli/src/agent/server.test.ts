import { expect, test } from "bun:test";

import { isCompletedRetainedSessionEvent, isTerminalSessionPhase } from "./server.js";
import type { AgentSessionEvent, AgentSessionRef } from "./tui/index.js";

function createWorkerSession(id = "worker:OPE-68:1"): AgentSessionRef {
  return {
    id,
    issue: {
      identifier: "OPE-68",
      title: "Run plan",
    },
    kind: "worker",
    parentSessionId: "supervisor",
    rootSessionId: "supervisor",
    title: "Run plan",
    workerId: "OPE-68",
  };
}

test("isTerminalSessionPhase matches terminal worker phases", () => {
  expect(isTerminalSessionPhase("completed")).toBe(true);
  expect(isTerminalSessionPhase("failed")).toBe(true);
  expect(isTerminalSessionPhase("stopped")).toBe(true);
  expect(isTerminalSessionPhase("started")).toBe(false);
  expect(isTerminalSessionPhase("scheduled")).toBe(false);
});

test("isCompletedRetainedSessionEvent matches terminal lifecycle events for the attached session", () => {
  const event: AgentSessionEvent = {
    phase: "completed",
    sequence: 1,
    session: createWorkerSession(),
    timestamp: "2026-03-10T02:00:00.000Z",
    type: "session",
  };

  expect(isCompletedRetainedSessionEvent(event, "worker:OPE-68:1")).toBe(true);
  expect(isCompletedRetainedSessionEvent(event, "worker:OPE-69:1")).toBe(false);
});

test("isCompletedRetainedSessionEvent ignores non-terminal and non-lifecycle events", () => {
  const session = createWorkerSession();
  const started: AgentSessionEvent = {
    phase: "started",
    sequence: 1,
    session,
    timestamp: "2026-03-10T02:00:00.000Z",
    type: "session",
  };
  const status: AgentSessionEvent = {
    code: "thread-started",
    format: "line",
    sequence: 2,
    session,
    text: "IO is supervising",
    timestamp: "2026-03-10T02:00:01.000Z",
    type: "status",
  };

  expect(isCompletedRetainedSessionEvent(started, session.id)).toBe(false);
  expect(isCompletedRetainedSessionEvent(status, session.id)).toBe(false);
});
