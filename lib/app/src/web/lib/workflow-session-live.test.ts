import { describe, expect, it } from "bun:test";

import type { AgentSessionAppendEvent } from "@io/graph-module-workflow";

import {
  appendWorkflowSessionLiveEvent,
  createWorkflowSessionLiveEvent,
  mergeWorkflowSessionTimelineEvents,
  partitionWorkflowSessionLiveEvents,
  reconcileWorkflowSessionLiveEvents,
} from "./workflow-session-live.js";

function createStatusEvent(sequence: number, text: string): AgentSessionAppendEvent {
  return {
    type: "status",
    code: "ready",
    format: "line",
    sequence,
    text,
    timestamp: `2026-03-30T10:00:0${sequence}.000Z`,
  };
}

describe("workflow session live overlay", () => {
  it("deduplicates repeated local live events by session and sequence", () => {
    const first = createWorkflowSessionLiveEvent({
      browserAgentSessionId: "browser-agent:1",
      event: createStatusEvent(2, "Waiting on graph acknowledgement"),
      sessionId: "session:1",
    });

    expect(appendWorkflowSessionLiveEvent([], first)).toEqual([first]);
    expect(appendWorkflowSessionLiveEvent([first], first)).toEqual([first]);
  });

  it("drops local transient events once the authoritative feed acknowledges them", () => {
    const localEvent = createWorkflowSessionLiveEvent({
      browserAgentSessionId: "browser-agent:1",
      event: createStatusEvent(2, "Waiting on graph acknowledgement"),
      sessionId: "session:1",
    });

    expect(
      reconcileWorkflowSessionLiveEvents(
        [createStatusEvent(1, "Started"), localEvent.event],
        [localEvent],
      ),
    ).toEqual([]);
  });

  it("keeps conflicting local events visible as transient reconciliation drift", () => {
    const localEvent = createWorkflowSessionLiveEvent({
      browserAgentSessionId: "browser-agent:1",
      event: createStatusEvent(2, "Local drifted event"),
      sessionId: "session:1",
    });

    expect(
      partitionWorkflowSessionLiveEvents(
        [createStatusEvent(1, "Started"), createStatusEvent(2, "Authoritative event")],
        [localEvent],
      ),
    ).toEqual({
      conflictingEvents: [localEvent],
      pendingEvents: [],
    });
    expect(
      mergeWorkflowSessionTimelineEvents({
        authoritativeEvents: [
          createStatusEvent(1, "Started"),
          createStatusEvent(2, "Authoritative event"),
        ],
        localEvents: [localEvent],
      }),
    ).toEqual([
      {
        event: createStatusEvent(1, "Started"),
        transient: false,
      },
      {
        event: createStatusEvent(2, "Authoritative event"),
        transient: false,
      },
      {
        event: localEvent.event,
        transient: true,
      },
    ]);
  });

  it("keeps unmatched local events transient and appends them after authoritative history", () => {
    const localEvent = createWorkflowSessionLiveEvent({
      browserAgentSessionId: "browser-agent:1",
      event: createStatusEvent(3, "Local live event"),
      sessionId: "session:1",
    });

    expect(
      mergeWorkflowSessionTimelineEvents({
        authoritativeEvents: [createStatusEvent(1, "Started"), createStatusEvent(2, "Running")],
        localEvents: [localEvent],
      }),
    ).toEqual([
      {
        event: createStatusEvent(1, "Started"),
        transient: false,
      },
      {
        event: createStatusEvent(2, "Running"),
        transient: false,
      },
      {
        event: localEvent.event,
        transient: true,
      },
    ]);
  });
});
