import { createTestRenderer } from "@opentui/core/testing";
import { expect, test } from "bun:test";

import { buildAgentTuiRootComponentModel } from "./layout.js";
import type { AgentSessionRef } from "./session-events.js";
import { createAgentTuiStore } from "./store.js";
import { createAgentTui } from "./tui.js";

function createSupervisorSession(): AgentSessionRef {
  return {
    id: "supervisor",
    kind: "supervisor",
    rootSessionId: "supervisor",
    title: "Supervisor",
    workerId: "supervisor",
    workspacePath: "/Users/dpeek/code/io",
  };
}

function createWorkerSession(): AgentSessionRef {
  return {
    branchName: "ope-68",
    id: "worker:OPE-68:1",
    issue: {
      id: "issue-68",
      identifier: "OPE-68",
      title: "Run plan",
    },
    kind: "worker",
    parentSessionId: "supervisor",
    rootSessionId: "supervisor",
    title: "Run plan",
    workerId: "OPE-68",
    workspacePath: "/Users/dpeek/code/io/.io/tree/ope-68",
  };
}

function createChildSession(): AgentSessionRef {
  return {
    id: "child:OPE-68:1",
    kind: "child",
    parentSessionId: "worker:OPE-68:1",
    rootSessionId: "supervisor",
    title: "Helper",
    workerId: "OPE-68",
    workspacePath: "/Users/dpeek/code/io/.io/tree/ope-68",
  };
}

test("AgentTuiStore tracks column hierarchy, summaries, and event history", () => {
  const store = createAgentTuiStore();
  const supervisor = createSupervisorSession();
  const worker = createWorkerSession();
  const child = createChildSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: supervisor,
    timestamp: "2026-03-10T02:00:00.000Z",
    type: "session",
  });
  store.observe({
    phase: "scheduled",
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:00:01.000Z",
    type: "session",
  });
  store.observe({
    code: "thread-started",
    format: "line",
    sequence: 3,
    session: worker,
    text: "Session started",
    timestamp: "2026-03-10T02:00:02.000Z",
    type: "status",
  });
  store.observe({
    phase: "started",
    sequence: 4,
    session: child,
    timestamp: "2026-03-10T02:00:03.000Z",
    type: "session",
  });
  store.observe({
    code: "tool",
    format: "line",
    sequence: 5,
    session: child,
    text: 'Tool: helper.spawn {"mode":"plan"}',
    timestamp: "2026-03-10T02:00:04.000Z",
    type: "status",
  });

  const snapshot = store.getSnapshot();
  const columns = snapshot.columns ?? [];
  expect(columns.map((column) => column.session.id)).toEqual([
    "supervisor",
    "worker:OPE-68:1",
    "child:OPE-68:1",
  ]);
  expect(columns[1]?.childSessionIds).toEqual(["child:OPE-68:1"]);
  expect(columns[2]?.parentSessionId).toBe("worker:OPE-68:1");
  expect(columns[2]?.status?.text).toBe('Tool: helper.spawn {"mode":"plan"}');
  expect(columns[2]?.eventHistory.at(-1)?.summary).toContain("tool");
  expect(columns[1]?.body).toContain("Session started\n");
  expect(columns[1]?.transcriptEntries.map((entry) => entry.kind)).toEqual(["lifecycle", "status"]);
  expect(columns[2]?.transcriptEntries.at(-1)).toMatchObject({
    kind: "status",
    text: 'Tool: helper.spawn {"mode":"plan"}',
  });
  expect(columns[0]?.transcriptEntries.map((entry) => entry.kind)).toEqual([
    "lifecycle",
    "mirror",
    "mirror",
    "mirror",
    "mirror",
  ]);
  const supervisorTranscript = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: supervisor.id,
    viewMode: "status",
  }).columns.find((column) => column.id === supervisor.id)?.transcript;
  expect(supervisorTranscript).toContain("[SESSION STARTED] Session started | /Users/dpeek/code/io");
  expect(supervisorTranscript).toContain("[OPE-68] Session scheduled | ope-68 | /Users/dpeek/code/io/.io/tree/ope-68");
  expect(supervisorTranscript).toContain("[OPE-68] Session started");
  expect(supervisorTranscript).toContain("[OPE-68] Session started | /Users/dpeek/code/io/.io/tree/ope-68");
  expect(supervisorTranscript).toContain('[OPE-68] Tool: helper.spawn {"mode":"plan"}');
});

test("AgentTuiStore prunes completed non-supervisor sessions when retention is disabled", () => {
  const store = createAgentTuiStore({ retainTerminalSessions: false });
  const supervisor = createSupervisorSession();
  const worker = createWorkerSession();
  const child = createChildSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: supervisor,
    timestamp: "2026-03-10T02:03:00.000Z",
    type: "session",
  });
  store.observe({
    phase: "started",
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:03:01.000Z",
    type: "session",
  });
  store.observe({
    phase: "started",
    sequence: 3,
    session: child,
    timestamp: "2026-03-10T02:03:02.000Z",
    type: "session",
  });
  store.observe({
    phase: "stopped",
    sequence: 4,
    session: child,
    timestamp: "2026-03-10T02:03:03.000Z",
    type: "session",
  });

  let snapshot = store.getSnapshot();
  expect(snapshot.columns.map((column) => column.session.id)).toEqual([
    "supervisor",
    "worker:OPE-68:1",
  ]);

  store.observe({
    phase: "completed",
    sequence: 5,
    session: worker,
    timestamp: "2026-03-10T02:03:04.000Z",
    type: "session",
  });

  snapshot = store.getSnapshot();
  expect(snapshot.columns.map((column) => column.session.id)).toEqual(["supervisor"]);
  const supervisorTranscript = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: supervisor.id,
    viewMode: "status",
  }).columns[0]?.transcript;
  expect(supervisorTranscript).toContain("[OPE-68] Session completed");
});

test("buildAgentTuiRootComponentModel supports status-focused and raw-heavy transcript views", () => {
  const store = createAgentTuiStore();
  const supervisor = createSupervisorSession();
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: supervisor,
    timestamp: "2026-03-10T02:05:00.000Z",
    type: "session",
  });
  store.observe({
    phase: "started",
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:05:01.000Z",
    type: "session",
  });
  store.observe({
    code: "command",
    format: "line",
    sequence: 3,
    session: worker,
    text: "$ git status --short --branch",
    timestamp: "2026-03-10T02:05:02.000Z",
    type: "status",
  });
  store.observe({
    code: "command-output",
    format: "line",
    sequence: 4,
    session: worker,
    text: "| ## main",
    timestamp: "2026-03-10T02:05:03.000Z",
    type: "status",
  });
  store.observe({
    code: "command-output",
    format: "line",
    sequence: 5,
    session: worker,
    text: "|  M agent/src/runner/codex.ts",
    timestamp: "2026-03-10T02:05:04.000Z",
    type: "status",
  });
  store.observe({
    code: "agent-message-delta",
    format: "chunk",
    itemId: "msg-1",
    sequence: 6,
    session: worker,
    text: "Inspecting ",
    timestamp: "2026-03-10T02:05:05.000Z",
    type: "status",
  });
  store.observe({
    code: "agent-message-delta",
    format: "chunk",
    itemId: "msg-1",
    sequence: 7,
    session: worker,
    text: "runtime state",
    timestamp: "2026-03-10T02:05:06.000Z",
    type: "status",
  });
  store.observe({
    encoding: "jsonl",
    line: '{"method":"thread/started"}',
    sequence: 8,
    session: worker,
    stream: "stdout",
    timestamp: "2026-03-10T02:05:07.000Z",
    type: "raw-line",
  });
  store.observe({
    encoding: "jsonl",
    line: '{"method":"turn/completed"}',
    sequence: 9,
    session: worker,
    stream: "stdout",
    timestamp: "2026-03-10T02:05:08.000Z",
    type: "raw-line",
  });

  const snapshot = store.getSnapshot();
  const statusModel = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: worker.id,
    viewMode: "status",
  });
  const rawModel = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: worker.id,
    viewMode: "raw",
  });
  const statusTranscript = statusModel.columns.find((column) => column.id === worker.id)?.transcript ?? "";
  const rawTranscript = rawModel.columns.find((column) => column.id === worker.id)?.transcript ?? "";
  const statusLatestEventLine =
    statusModel.columns.find((column) => column.id === worker.id)?.latestEventLine ?? "";

  expect(statusTranscript).toContain("[COMMAND] $ git status --short --branch");
  expect(statusTranscript).toContain("[CMD OUT x2] M agent/src/runner/codex.ts");
  expect(statusTranscript).toContain("Inspecting");
  expect(statusTranscript).toContain("runtime state");
  expect(statusTranscript).not.toContain("[RAW stdout/jsonl");
  expect(statusLatestEventLine).not.toContain("stdout jsonl:");
  expect(rawTranscript).toContain("[CMD OUT x2]");
  expect(rawTranscript).toContain("Inspecting runtime state");
  expect(rawTranscript).toContain("| ## main");
  expect(rawTranscript).toContain('jsonl: {"method":"thread/started"}');
  expect(rawTranscript).toContain('jsonl: {"method":"turn/completed"}');
});

test("createAgentTui supports keyboard column navigation, view toggles, and transcript scrolling", async () => {
  const { captureCharFrame, mockInput, renderOnce, renderer } = await createTestRenderer({
    height: 18,
    width: 96,
  });
  let exitRequested = 0;

  const tui = createAgentTui({
    onExitRequest: () => {
      exitRequested += 1;
    },
    renderer,
    requireTty: false,
  });
  const supervisor = createSupervisorSession();
  const worker = createWorkerSession();
  const child = createChildSession();

  try {
    await tui.start();
    tui.observe({
      phase: "started",
      sequence: 1,
      session: supervisor,
      timestamp: "2026-03-10T02:10:00.000Z",
      type: "session",
    });
    tui.observe({
      phase: "scheduled",
      sequence: 2,
      session: worker,
      timestamp: "2026-03-10T02:10:01.000Z",
      type: "session",
    });
    tui.observe({
      code: "thread-started",
      format: "line",
      sequence: 3,
      session: worker,
      text: "Session started",
      timestamp: "2026-03-10T02:10:02.000Z",
      type: "status",
    });
    tui.observe({
      phase: "started",
      sequence: 4,
      session: child,
      timestamp: "2026-03-10T02:10:03.000Z",
      type: "session",
    });
    tui.observe({
      code: "tool",
      format: "line",
      sequence: 5,
      session: child,
      text: "Tool: helper.spawn",
      timestamp: "2026-03-10T02:10:04.000Z",
      type: "status",
    });
    for (let index = 0; index < 12; index++) {
      tui.observe({
        code: "command-output",
        format: "line",
        sequence: 6 + index,
        session: worker,
        text: `| output line ${index}`,
        timestamp: `2026-03-10T02:10:${String(5 + index).padStart(2, "0")}.000Z`,
        type: "status",
      });
    }

    await Promise.resolve();
    await renderOnce();

    let frame = captureCharFrame();
    expect(frame).toContain("View: STATUS");
    expect(frame).toContain("> . Supervisor");
    expect(frame).toContain("Transcript");

    mockInput.pressArrow("right");
    await renderOnce();
    frame = captureCharFrame();
    expect(frame).toContain("> * OPE-68 Run plan");

    await mockInput.typeText("v");
    await renderOnce();
    frame = captureCharFrame();
    expect(frame).toContain("View: RAW");

    await mockInput.typeText("g");
    await renderOnce();
    frame = captureCharFrame();
    expect(frame).toContain("| output line 0");

    await mockInput.typeText("j");
    await renderOnce();
    await mockInput.typeText("j");
    await renderOnce();
    frame = captureCharFrame();
    expect(frame).toContain("| output line 2");

    await mockInput.typeText("q");
    await Promise.resolve();
    expect(exitRequested).toBe(1);
  } finally {
    await tui.stop();
    renderer.destroy();
  }
});

test("createAgentTui drops completed worker columns in live mode", async () => {
  const { renderOnce, renderer } = await createTestRenderer({
    height: 14,
    width: 96,
  });
  const tui = createAgentTui({
    renderer,
    requireTty: false,
  });
  const supervisor = createSupervisorSession();
  const worker = createWorkerSession();

  try {
    await tui.start();
    tui.observe({
      phase: "started",
      sequence: 1,
      session: supervisor,
      timestamp: "2026-03-10T02:12:00.000Z",
      type: "session",
    });
    tui.observe({
      phase: "started",
      sequence: 2,
      session: worker,
      timestamp: "2026-03-10T02:12:01.000Z",
      type: "session",
    });

    await Promise.resolve();
    await renderOnce();
    expect(tui.getSnapshot().columns.map((column) => column.session.id)).toEqual([
      "supervisor",
      "worker:OPE-68:1",
    ]);

    tui.observe({
      phase: "completed",
      sequence: 3,
      session: worker,
      timestamp: "2026-03-10T02:12:02.000Z",
      type: "session",
    });

    await Promise.resolve();
    await renderOnce();
    expect(tui.getSnapshot().columns.map((column) => column.session.id)).toEqual(["supervisor"]);
  } finally {
    await tui.stop();
    renderer.destroy();
  }
});
