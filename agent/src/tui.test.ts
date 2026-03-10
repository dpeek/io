import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { AgentSessionRef } from "./session-events.js";
import { AgentTuiRetainedReader } from "./tui-runtime.js";
import { createAgentTuiStore, renderAgentTuiFrame } from "./tui.js";
import type { IssueRuntimeState } from "./workspace.js";

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
    branchName: "ope-67",
    id: "worker:OPE-67:1",
    issue: {
      id: "issue-67",
      identifier: "OPE-67",
      title: "Implement io agent tui",
    },
    kind: "worker",
    parentSessionId: "supervisor",
    rootSessionId: "supervisor",
    title: "Implement io agent tui",
    workerId: "OPE-67",
    workspacePath: "/Users/dpeek/code/io/.io/tree/ope-67",
  };
}

function createIssueState(runtimePath: string, overrides: Partial<IssueRuntimeState> = {}): IssueRuntimeState {
  return {
    branchName: "ope-67",
    controlPath: "/Users/dpeek/code/io/.io/control",
    issueId: "issue-67",
    issueIdentifier: "OPE-67",
    issueTitle: "Implement io agent tui",
    originPath: "/Users/dpeek/code/io",
    outputPath: resolve(runtimePath, "output.log"),
    runtimePath,
    status: "running",
    updatedAt: "2026-03-10T02:00:00.000Z",
    workerId: "OPE-67",
    worktreePath: "/Users/dpeek/code/io/.io/tree/ope-67",
    ...overrides,
  };
}

test("AgentTuiStore keeps supervisor first and records status plus raw output", () => {
  const store = createAgentTuiStore();
  const supervisor = createSupervisorSession();
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: supervisor,
    timestamp: "2026-03-10T02:00:00.000Z",
    type: "session",
  });
  store.observe({
    code: "ready",
    format: "line",
    sequence: 2,
    session: supervisor,
    text: "ready at /Users/dpeek/code/io",
    timestamp: "2026-03-10T02:00:01.000Z",
    type: "status",
  });
  store.observe({
    phase: "scheduled",
    sequence: 3,
    session: worker,
    timestamp: "2026-03-10T02:00:02.000Z",
    type: "session",
  });
  store.observe({
    code: "thread-started",
    format: "line",
    sequence: 4,
    session: worker,
    text: "Session started",
    timestamp: "2026-03-10T02:00:03.000Z",
    type: "status",
  });
  store.observe({
    code: "agent-message-delta",
    format: "chunk",
    itemId: "msg-1",
    sequence: 5,
    session: worker,
    text: "Inspecting ",
    timestamp: "2026-03-10T02:00:04.000Z",
    type: "status",
  });
  store.observe({
    code: "agent-message-delta",
    format: "chunk",
    itemId: "msg-1",
    sequence: 6,
    session: worker,
    text: "runtime state",
    timestamp: "2026-03-10T02:00:05.000Z",
    type: "status",
  });
  store.observe({
    code: "agent-message-completed",
    format: "close",
    itemId: "msg-1",
    sequence: 7,
    session: worker,
    timestamp: "2026-03-10T02:00:06.000Z",
    type: "status",
  });
  store.observe({
    encoding: "jsonl",
    line: '{"method":"thread/started"}',
    sequence: 8,
    session: worker,
    stream: "stdout",
    timestamp: "2026-03-10T02:00:07.000Z",
    type: "raw-line",
  });
  store.observe({
    encoding: "text",
    line: "stderr line",
    sequence: 9,
    session: worker,
    stream: "stderr",
    timestamp: "2026-03-10T02:00:08.000Z",
    type: "raw-line",
  });

  const snapshot = store.getSnapshot();
  expect(snapshot.sessions.map((session) => session.session.id)).toEqual([
    "supervisor",
    "worker:OPE-67:1",
  ]);
  expect(snapshot.sessions[0]?.body).toContain("Session started | /Users/dpeek/code/io");
  expect(snapshot.sessions[0]?.body).toContain("ready at /Users/dpeek/code/io\n");
  expect(snapshot.sessions[1]?.body).toContain(
    "Session scheduled | ope-67 | /Users/dpeek/code/io/.io/tree/ope-67\n",
  );
  expect(snapshot.sessions[1]?.body).toContain("Session started\n");
  expect(snapshot.sessions[1]?.body).toContain("Inspecting runtime state\n");
  expect(snapshot.sessions[1]?.body).toContain('jsonl: {"method":"thread/started"}\n');
  expect(snapshot.sessions[1]?.body).toContain("stderr: stderr line\n");
});

test("renderAgentTuiFrame lays out supervisor and worker columns", () => {
  const frame = renderAgentTuiFrame(
    {
      sessions: [
        {
          body: "Session started | /Users/dpeek/code/io\nready at /Users/dpeek/code/io\nNo issues\n",
          firstSequence: 1,
          lastSequence: 3,
          phase: "started",
          session: createSupervisorSession(),
        },
        {
          body:
            "Session scheduled | ope-67 | /Users/dpeek/code/io/.io/tree/ope-67\n" +
            "Session started\n" +
            'jsonl: {"method":"thread/started"}\n' +
            "stderr: stderr line\n",
          firstSequence: 4,
          lastSequence: 7,
          phase: "completed",
          session: createWorkerSession(),
        },
      ],
    },
    { columns: 80, rows: 8 },
  );

  const [firstLine] = frame.split("\n");
  expect(firstLine?.startsWith("Supervisor")).toBe(true);
  expect(firstLine).toContain("|OPE-67 Implement io agent tui");
  expect(frame).toContain("started");
  expect(frame).toContain("completed");
  expect(frame).toContain("No issues");
  expect(frame).toContain("stderr: stderr line");
});

test("AgentTuiRetainedReader reconstructs events.log into supervisor and worker columns", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-tui-retained-events-"));
  const runtimePath = resolve(root, "issues", "ope-67");
  await mkdir(runtimePath, { recursive: true });

  const worker = createWorkerSession();
  const child: AgentSessionRef = {
    ...worker,
    id: "child:OPE-67:1",
    kind: "child",
    title: "Nested helper",
  };

  const issueState = createIssueState(runtimePath);
  await writeFile(
    resolve(runtimePath, "events.log"),
    [
      JSON.stringify({
        phase: "scheduled",
        sequence: 1,
        session: worker,
        timestamp: "2026-03-10T02:00:01.000Z",
        type: "session",
      }),
      JSON.stringify({
        code: "thread-started",
        format: "line",
        sequence: 2,
        session: worker,
        text: "Session started",
        timestamp: "2026-03-10T02:00:02.000Z",
        type: "status",
      }),
      JSON.stringify({
        code: "tool",
        format: "line",
        sequence: 3,
        session: child,
        text: 'Tool: spawned.run {"mode":"helper"}',
        timestamp: "2026-03-10T02:00:03.000Z",
        type: "status",
      }),
    ].join("\n") + "\n",
  );

  try {
    const reader = new AgentTuiRetainedReader({
      issueState,
      repoRoot: "/Users/dpeek/code/io",
    });
    const store = createAgentTuiStore();
    for (const event of await reader.readInitialEvents("attach")) {
      store.observe(event);
    }

    const snapshot = store.getSnapshot();
    expect(reader.source).toBe("events");
    expect(snapshot.sessions.map((session) => session.session.id)).toEqual([
      "supervisor",
      "worker:OPE-67:1",
    ]);
    expect(snapshot.sessions[0]?.body).toContain("Attach OPE-67 from events.log\n");
    expect(snapshot.sessions[1]?.body).toContain("Session scheduled | ope-67");
    expect(snapshot.sessions[1]?.body).toContain('Tool: spawned.run {"mode":"helper"}\n');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader falls back to codex.stdout.jsonl for replay", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-tui-retained-stdout-"));
  const runtimePath = resolve(root, "issues", "ope-67");
  await mkdir(runtimePath, { recursive: true });

  const issueState = createIssueState(runtimePath, {
    status: "completed",
    updatedAt: "2026-03-10T03:00:00.000Z",
  });
  await writeFile(
    resolve(runtimePath, "codex.stdout.jsonl"),
    [
      JSON.stringify({ method: "thread/started" }),
      JSON.stringify({ method: "turn/completed" }),
    ].join("\n") + "\n",
  );

  try {
    const reader = new AgentTuiRetainedReader({
      issueState,
      repoRoot: "/Users/dpeek/code/io",
    });
    const store = createAgentTuiStore();
    for (const event of await reader.readInitialEvents("replay")) {
      store.observe(event);
    }

    const snapshot = store.getSnapshot();
    expect(reader.source).toBe("stdout");
    expect(snapshot.sessions.map((session) => session.session.id)).toEqual([
      "supervisor",
      "worker:OPE-67:retained",
    ]);
    expect(snapshot.sessions[0]?.body).toContain("Replay OPE-67 from codex.stdout.jsonl\n");
    expect(snapshot.sessions[1]?.phase).toBe("completed");
    expect(snapshot.sessions[1]?.body).toContain('jsonl: {"method":"thread/started"}\n');
    expect(snapshot.sessions[1]?.body).toContain("Session started\n");
    expect(snapshot.sessions[1]?.body).toContain("Turn completed\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader tails appended retained events", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-tui-retained-tail-"));
  const runtimePath = resolve(root, "issues", "ope-67");
  await mkdir(runtimePath, { recursive: true });

  const worker = createWorkerSession();
  const issueState = createIssueState(runtimePath);
  const eventsLogPath = resolve(runtimePath, "events.log");
  await writeFile(
    eventsLogPath,
    `${JSON.stringify({
      phase: "scheduled",
      sequence: 1,
      session: worker,
      timestamp: "2026-03-10T04:00:01.000Z",
      type: "session",
    })}\n`,
  );

  try {
    const reader = new AgentTuiRetainedReader({
      issueState,
      repoRoot: "/Users/dpeek/code/io",
    });
    await reader.readInitialEvents("attach");

    await appendFile(
      eventsLogPath,
      `${JSON.stringify({
        code: "turn-started",
        format: "line",
        sequence: 2,
        session: worker,
        text: "Turn started",
        timestamp: "2026-03-10T04:00:02.000Z",
        type: "status",
      })}\n`,
    );

    const nextEvents = await reader.readNextEvents();
    expect(nextEvents).toHaveLength(1);
    expect(nextEvents[0]).toMatchObject({
      session: { id: "worker:OPE-67:1" },
      text: "Turn started",
      type: "status",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
