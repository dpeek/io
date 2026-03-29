import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { AgentTuiRetainedReader } from "./tui-runtime.js";
import { createAgentTuiStore, renderAgentTuiFrame } from "./tui/index.js";
import type { AgentSessionRef } from "./tui/index.js";
import type { IssueRuntimeState } from "./workspace.js";

type SessionRefOverrides = Omit<Partial<AgentSessionRef>, "issue"> & {
  issue?: Partial<NonNullable<AgentSessionRef["issue"]>>;
};

function resolveIssueRef(
  base: NonNullable<AgentSessionRef["issue"]> | undefined,
  override: SessionRefOverrides["issue"],
): AgentSessionRef["issue"] {
  if (!base && !override) {
    return undefined;
  }
  return {
    id: override?.id ?? base?.id,
    identifier: override?.identifier ?? base?.identifier ?? "unknown",
    title: override?.title ?? base?.title ?? "Unknown",
  };
}

function createSupervisorSession(overrides: SessionRefOverrides = {}): AgentSessionRef {
  const { issue: issueOverrides, ...sessionOverrides } = overrides;
  return {
    id: "supervisor",
    kind: "supervisor",
    rootSessionId: "supervisor",
    title: "Supervisor",
    workerId: "supervisor",
    workspacePath: "/Users/dpeek/code/io",
    ...sessionOverrides,
    issue: resolveIssueRef(undefined, issueOverrides),
  };
}

function createWorkerSession(overrides: SessionRefOverrides = {}): AgentSessionRef {
  const { issue: issueOverrides, ...sessionOverrides } = overrides;
  const baseIssue = {
    id: "issue-67",
    identifier: "OPE-67",
    title: "Implement io agent tui",
  };
  return {
    branchName: "ope-67",
    id: "worker:OPE-67:1",
    kind: "worker",
    parentSessionId: "supervisor",
    rootSessionId: "supervisor",
    title: "Implement io agent tui",
    workerId: "OPE-67",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-67",
    ...sessionOverrides,
    issue: resolveIssueRef(baseIssue, issueOverrides),
  };
}

function createIssueState(
  runtimePath: string,
  overrides: Partial<IssueRuntimeState> = {},
): IssueRuntimeState {
  return {
    branchName: "ope-67",
    controlPath: "/Users/dpeek/code/io/tmp/workspace/control",
    issueId: "issue-67",
    issueIdentifier: "OPE-67",
    issueTitle: "Implement io agent tui",
    originPath: "/Users/dpeek/code/io",
    outputPath: resolve(runtimePath, "output.log"),
    runtimePath,
    status: "running",
    streamIssueId: "issue-67",
    streamIssueIdentifier: "OPE-67",
    streamRuntimePath: runtimePath,
    updatedAt: "2026-03-10T02:00:00.000Z",
    workerId: "OPE-67",
    worktreePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-67",
    ...overrides,
  };
}

function createSnapshotColumn(
  overrides: Partial<
    ReturnType<ReturnType<typeof createAgentTuiStore>["getSnapshot"]>["sessions"][number]
  >,
) {
  return {
    body: "",
    childSessionIds: [],
    depth: 0,
    eventHistory: [],
    firstSequence: 0,
    lastSequence: 0,
    phase: "pending" as const,
    session: createSupervisorSession(),
    blocks: [],
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
    text: "IO is supervising /Users/dpeek/code/io",
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
  expect(snapshot.sessions[0]?.body).toContain("IO is supervising /Users/dpeek/code/io");
  expect(snapshot.sessions[1]?.body).toContain(
    "Session scheduled | ope-67 | /Users/dpeek/code/io/tmp/workspace/tree/ope-67\n",
  );
  expect(snapshot.sessions[1]?.body).toContain("Session started\n");
  expect(snapshot.sessions[1]?.body).toContain("Inspecting runtime state\n");
  expect(snapshot.sessions[1]?.body).toContain("stderr: stderr line");
});

test("renderAgentTuiFrame lays out supervisor and worker columns", () => {
  const sessions = [
    createSnapshotColumn({
      blocks: [
        {
          code: "workflow-diagnostic",
          count: 1,
          format: "line",
          kind: "status",
          sequenceEnd: 3,
          sequenceStart: 3,
          text: "Workflow: idle",
          timestamp: "2026-03-10T02:00:02.000Z",
        },
      ],
      body:
        "Session started | /Users/dpeek/code/io\n" +
        "IO is supervising /Users/dpeek/code/io\n" +
        "Workflow: idle\n",
      firstSequence: 1,
      lastSequence: 3,
      phase: "started",
      session: createSupervisorSession(),
    }),
    createSnapshotColumn({
      body:
        "Session scheduled | ope-67 | /Users/dpeek/code/io/tmp/workspace/tree/ope-67\n" +
        "Session started\n" +
        'jsonl: {"method":"thread/started"}\n' +
        "stderr: stderr line\n",
      firstSequence: 4,
      lastSequence: 7,
      phase: "completed",
      session: createWorkerSession(),
    }),
  ];
  const frame = renderAgentTuiFrame(
    {
      columns: sessions,
      sessions,
    },
    { columns: 80, rows: 12 },
    { selectedColumnId: sessions[1]?.session.id },
  );

  const [firstLine, secondLine] = frame.split("\n");
  expect(firstLine).toContain("Workflow: idle");
  expect(secondLine).toContain("Selected: worker OPE-67");
  expect(secondLine).toContain("ope-67");
  expect(frame).toContain("Workflow: idle");
  expect(frame).toContain('jsonl: {"method":"thread/started"}');
});

test("AgentTuiRetainedReader reconstructs events.log into supervisor and worker columns", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-events-"));
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
    expect(snapshot.sessions[0]?.body).toContain("workflow: stream OPE-67\n");
    expect(snapshot.sessions[0]?.body).toContain("runtime state: active on ope-67\n");
    expect(snapshot.sessions[1]?.body).toContain("Session scheduled | ope-67");
    expect(snapshot.sessions[1]?.body).toContain("Tool: spawned.run [running]");
    expect(snapshot.sessions[1]?.body).toContain("args:\n  mode: helper");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader keeps workflow blocker context visible in attach mode", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-workflow-attach-"));
  const runtimePath = resolve(root, "issues", "ope-188");
  await mkdir(runtimePath, { recursive: true });

  const worker = createWorkerSession({
    branchName: "io/ope-174",
    id: "worker:OPE-188:1",
    issue: {
      id: "issue-188",
      identifier: "OPE-188",
      title: "Prove workflow-aware TUI behavior with regression coverage",
    },
    title: "Prove workflow-aware TUI behavior with regression coverage",
    workerId: "OPE-188",
    workspacePath: "/repo/tmp/workspace/tree/ope-188",
  });
  const issueState = createIssueState(runtimePath, {
    branchName: "io/ope-174",
    controlPath: "/repo/tmp/workspace/control",
    issueId: "issue-188",
    issueIdentifier: "OPE-188",
    issueTitle: "Prove workflow-aware TUI behavior with regression coverage",
    originPath: "/repo",
    parentIssueId: "issue-174",
    parentIssueIdentifier: "OPE-174",
    status: "blocked",
    streamIssueId: "issue-174",
    streamIssueIdentifier: "OPE-174",
    workerId: "OPE-188",
    worktreePath: "/repo/tmp/workspace/tree/ope-188",
  });
  await writeFile(
    resolve(runtimePath, "events.log"),
    [
      JSON.stringify({
        phase: "scheduled",
        sequence: 1,
        session: worker,
        timestamp: "2026-03-10T05:00:01.000Z",
        type: "session",
      }),
      JSON.stringify({
        code: "issue-blocked",
        format: "line",
        sequence: 2,
        session: worker,
        text: "OPE-188: blocked",
        timestamp: "2026-03-10T05:00:02.000Z",
        type: "status",
      }),
      JSON.stringify({
        data: {
          reason: "Blocked on OPE-187 finalization",
        },
        phase: "failed",
        sequence: 3,
        session: worker,
        timestamp: "2026-03-10T05:00:03.000Z",
        type: "session",
      }),
    ].join("\n") + "\n",
  );

  try {
    const reader = new AgentTuiRetainedReader({
      issueState,
      repoRoot: "/repo",
    });
    const store = createAgentTuiStore();
    for (const event of await reader.readInitialEvents("attach")) {
      store.observe(event);
    }

    const snapshot = store.getSnapshot();
    const frame = renderAgentTuiFrame(snapshot, { columns: 120, rows: 10 });

    expect(reader.source).toBe("events");
    expect(snapshot.sessions.map((session) => session.session.id)).toEqual([
      "supervisor",
      "worker:OPE-188:1",
    ]);
    expect(snapshot.sessions[0]?.body).toContain("Attach OPE-188 from events.log");
    expect(snapshot.sessions[0]?.body).toContain("workflow: stream OPE-174 / task OPE-188");
    expect(snapshot.sessions[0]?.body).toContain(
      "runtime state: blocked; worktree preserved on io/ope-174",
    );
    expect(snapshot.sessions[1]?.status).toMatchObject({
      code: "issue-blocked",
      text: "OPE-188: blocked",
    });
    expect(snapshot.sessions[1]?.session.runtime).toMatchObject({
      blocker: {
        kind: "blocked",
        reason: "Blocked on OPE-187 finalization",
      },
      state: "blocked",
    });
    expect(snapshot.sessions[1]?.body).toContain(
      "Session scheduled | io/ope-174 | /repo/tmp/workspace/tree/ope-188",
    );
    expect(snapshot.sessions[1]?.body).toContain("OPE-188: blocked");
    expect(snapshot.sessions[1]?.body).toContain(
      "Session failed | io/ope-174 | /repo/tmp/workspace/tree/ope-188: Blocked on OPE-187 finalization",
    );
    expect(frame).toContain("Attach OPE-188 from events.log");
    expect(frame).toContain("OPE-188: blocked");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader falls back to codex.stdout.jsonl for replay", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-stdout-"));
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
    expect(snapshot.sessions[0]?.body).toContain("workflow: stream OPE-67\n");
    expect(snapshot.sessions[0]?.body).toContain(
      "runtime state: waiting on finalization on ope-67\n",
    );
    expect(snapshot.sessions[1]?.phase).toBe("completed");
    expect(snapshot.sessions[1]?.body).toContain("Session completed");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader describes interrupted retained work as resumable", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-interrupted-"));
  const runtimePath = resolve(root, "issues", "ope-67");
  await mkdir(runtimePath, { recursive: true });

  const issueState = createIssueState(runtimePath, {
    status: "interrupted",
    updatedAt: "2026-03-10T03:30:00.000Z",
  });

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
    expect(snapshot.sessions[1]?.phase).toBe("stopped");
    expect(snapshot.sessions[1]?.session.runtime).toMatchObject({
      blocker: {
        kind: "interrupted",
      },
      state: "interrupted",
    });
    expect(snapshot.sessions[0]?.body).toContain("workflow: stream OPE-67\n");
    expect(snapshot.sessions[0]?.body).toContain(
      "runtime state: interrupted; worktree preserved to resume on ope-67\n",
    );
    expect(snapshot.sessions[1]?.body).toContain("Session stopped");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader keeps finalized workflow context visible in replay mode", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-workflow-replay-"));
  const runtimePath = resolve(root, "issues", "ope-174");
  await mkdir(runtimePath, { recursive: true });

  const issueState = createIssueState(runtimePath, {
    branchName: "io/ope-174",
    controlPath: "/repo/tmp/workspace/control",
    finalizedAt: "2026-03-10T06:00:03.000Z",
    finalizedLinearState: "Done",
    issueId: "issue-174",
    issueIdentifier: "OPE-174",
    issueTitle: "Ship workflow-aware TUI behavior",
    originPath: "/repo",
    status: "finalized",
    streamIssueId: "issue-174",
    streamIssueIdentifier: "OPE-174",
    updatedAt: "2026-03-10T06:00:00.000Z",
    workerId: "OPE-174",
    worktreePath: "/repo/tmp/workspace/tree/ope-174",
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
      repoRoot: "/repo",
    });
    const store = createAgentTuiStore();
    for (const event of await reader.readInitialEvents("replay")) {
      store.observe(event);
    }

    const snapshot = store.getSnapshot();
    const frame = renderAgentTuiFrame(snapshot, { columns: 120, rows: 10 });

    expect(reader.source).toBe("stdout");
    expect(snapshot.sessions.map((session) => session.session.id)).toEqual([
      "supervisor",
      "worker:OPE-174:retained",
    ]);
    expect(snapshot.sessions[0]?.body).toContain("Replay OPE-174 from codex.stdout.jsonl");
    expect(snapshot.sessions[0]?.body).toContain("workflow: stream OPE-174");
    expect(snapshot.sessions[0]?.body).toContain("runtime state: finalized in Done");
    expect(snapshot.sessions[0]?.body).toContain("finalized: Done");
    expect(snapshot.sessions[1]?.session.branchName).toBe("io/ope-174");
    expect(snapshot.sessions[1]?.session.runtime).toMatchObject({
      finalization: {
        linearState: "Done",
        state: "finalized",
      },
      state: "finalized",
    });
    expect(snapshot.sessions[1]?.phase).toBe("completed");
    expect(snapshot.sessions[1]?.body).toContain(
      "Session completed | io/ope-174 | /repo/tmp/workspace/tree/ope-174",
    );
    expect(frame).toContain("Replay OPE-174 from codex.stdout.jsonl");
    expect(frame).toContain("Session completed | io/ope-174");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader supplements partial events.log with retained workflow milestones", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-partial-events-"));
  const runtimePath = resolve(root, "issues", "ope-174");
  await mkdir(runtimePath, { recursive: true });

  const commitSha = "abc1234def567890abc1234def567890abc1234";
  const worker = createWorkerSession({
    branchName: "io/ope-174",
    id: "worker:OPE-174:1",
    issue: {
      id: "issue-174",
      identifier: "OPE-174",
      title: "Ship workflow-aware TUI behavior",
    },
    title: "Ship workflow-aware TUI behavior",
    workerId: "OPE-174",
    workspacePath: "/repo/tmp/workspace/tree/ope-174",
  });
  const issueState = createIssueState(runtimePath, {
    branchName: "io/ope-174",
    controlPath: "/repo/tmp/workspace/control",
    finalizedAt: "2026-03-10T06:00:03.000Z",
    finalizedLinearState: "Done",
    issueId: "issue-174",
    issueIdentifier: "OPE-174",
    issueTitle: "Ship workflow-aware TUI behavior",
    landedAt: "2026-03-10T06:00:02.000Z",
    landedCommitSha: commitSha,
    originPath: "/repo",
    status: "finalized",
    streamIssueId: "issue-174",
    streamIssueIdentifier: "OPE-174",
    updatedAt: "2026-03-10T06:00:00.000Z",
    workerId: "OPE-174",
    worktreePath: "/repo/tmp/workspace/tree/ope-174",
  });
  await writeFile(
    resolve(runtimePath, "events.log"),
    [
      JSON.stringify({
        code: "thread-started",
        format: "line",
        sequence: 1,
        session: worker,
        text: "Session started",
        timestamp: "2026-03-10T06:00:01.000Z",
        type: "status",
      }),
    ].join("\n") + "\n",
  );

  try {
    const reader = new AgentTuiRetainedReader({
      issueState,
      repoRoot: "/repo",
    });
    const store = createAgentTuiStore();
    for (const event of await reader.readInitialEvents("replay")) {
      store.observe(event);
    }

    const snapshot = store.getSnapshot();
    const frame = renderAgentTuiFrame(snapshot, { columns: 120, rows: 12 });

    expect(reader.source).toBe("events");
    expect(snapshot.sessions.map((session) => session.session.id)).toEqual([
      "supervisor",
      "worker:OPE-174:1",
    ]);
    expect(snapshot.sessions[0]?.body).toContain("Replay OPE-174 from events.log");
    expect(snapshot.sessions[0]?.body).toContain("landed: abc1234 on io/ope-174");
    expect(snapshot.sessions[0]?.body).toContain("finalized: Done");
    expect(snapshot.sessions[1]?.status).toMatchObject({
      code: "issue-committed",
      data: {
        branchName: "io/ope-174",
        commitSha,
      },
      text: `OPE-174: committed ${commitSha} on io/ope-174`,
    });
    expect(snapshot.sessions[1]?.body).toContain(
      "Session scheduled | io/ope-174 | /repo/tmp/workspace/tree/ope-174",
    );
    expect(snapshot.sessions[1]?.body).toContain("Session started");
    expect(snapshot.sessions[1]?.body).toContain(`OPE-174: committed ${commitSha} on io/ope-174`);
    expect(snapshot.sessions[1]?.body).toContain(
      "Session completed | commit abc1234 | io/ope-174 | /repo/tmp/workspace/tree/ope-174",
    );
    expect(frame).toContain("finalized: Done");
    expect(frame).toContain("Session completed | commit abc1234");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader inserts retained commit context before a partial completed lifecycle", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-partial-completed-"));
  const runtimePath = resolve(root, "issues", "ope-174");
  await mkdir(runtimePath, { recursive: true });

  const commitSha = "abc1234def567890abc1234def567890abc1234";
  const worker = createWorkerSession({
    branchName: "io/ope-174",
    id: "worker:OPE-174:1",
    issue: {
      id: "issue-174",
      identifier: "OPE-174",
      title: "Ship workflow-aware TUI behavior",
    },
    title: "Ship workflow-aware TUI behavior",
    workerId: "OPE-174",
    workspacePath: "/repo/tmp/workspace/tree/ope-174",
  });
  const issueState = createIssueState(runtimePath, {
    branchName: "io/ope-174",
    controlPath: "/repo/tmp/workspace/control",
    issueId: "issue-174",
    issueIdentifier: "OPE-174",
    issueTitle: "Ship workflow-aware TUI behavior",
    landedAt: "2026-03-10T06:00:02.000Z",
    landedCommitSha: commitSha,
    originPath: "/repo",
    status: "completed",
    streamIssueId: "issue-174",
    streamIssueIdentifier: "OPE-174",
    updatedAt: "2026-03-10T06:00:00.000Z",
    workerId: "OPE-174",
    worktreePath: "/repo/tmp/workspace/tree/ope-174",
  });
  await writeFile(
    resolve(runtimePath, "events.log"),
    [
      JSON.stringify({
        code: "thread-started",
        format: "line",
        sequence: 1,
        session: worker,
        text: "Session started",
        timestamp: "2026-03-10T06:00:01.000Z",
        type: "status",
      }),
      JSON.stringify({
        phase: "completed",
        sequence: 2,
        session: worker,
        timestamp: "2026-03-10T06:00:02.000Z",
        type: "session",
      }),
    ].join("\n") + "\n",
  );

  try {
    const reader = new AgentTuiRetainedReader({
      issueState,
      repoRoot: "/repo",
    });
    const store = createAgentTuiStore();
    for (const event of await reader.readInitialEvents("replay")) {
      store.observe(event);
    }

    const snapshot = store.getSnapshot();
    const body = snapshot.sessions[1]?.body ?? "";
    const commitIndex = body.indexOf(`OPE-174: committed ${commitSha} on io/ope-174`);
    const completedIndex = body.indexOf(
      "Session completed | io/ope-174 | /repo/tmp/workspace/tree/ope-174",
    );

    expect(snapshot.sessions[1]?.status).toMatchObject({
      code: "issue-committed",
      text: `OPE-174: committed ${commitSha} on io/ope-174`,
    });
    expect(snapshot.sessions[1]?.lastSequence).toBe(2);
    expect(commitIndex).toBeGreaterThan(-1);
    expect(completedIndex).toBeGreaterThan(commitIndex);
    expect(snapshot.sessions[1]?.eventHistory.map((entry) => entry.summary).slice(-2)).toEqual([
      `issue-committed: OPE-174: committed ${commitSha} on io/ope-174`,
      "Session completed | io/ope-174 | /repo/tmp/workspace/tree/ope-174",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader reconstructs blocker context from runtime files when logs are missing", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-runtime-only-"));
  const runtimePath = resolve(root, "issues", "ope-188");
  await mkdir(runtimePath, { recursive: true });

  const issueState = createIssueState(runtimePath, {
    branchName: "io/ope-174",
    controlPath: "/repo/tmp/workspace/control",
    issueId: "issue-188",
    issueIdentifier: "OPE-188",
    issueTitle: "Prove workflow-aware TUI behavior with regression coverage",
    originPath: "/repo",
    parentIssueId: "issue-174",
    parentIssueIdentifier: "OPE-174",
    status: "blocked",
    streamIssueId: "issue-174",
    streamIssueIdentifier: "OPE-174",
    updatedAt: "2026-03-10T05:00:00.000Z",
    workerId: "OPE-188",
    worktreePath: "/repo/tmp/workspace/tree/ope-188",
  });
  await writeFile(
    resolve(runtimePath, "output.log"),
    "OPE-188: blocked: Blocked on OPE-187 finalization\n",
  );

  try {
    const reader = new AgentTuiRetainedReader({
      issueState,
      repoRoot: "/repo",
    });
    const store = createAgentTuiStore();
    for (const event of await reader.readInitialEvents("attach")) {
      store.observe(event);
    }

    const snapshot = store.getSnapshot();
    const frame = renderAgentTuiFrame(snapshot, { columns: 120, rows: 12 });

    expect(reader.source).toBe("runtime");
    expect(snapshot.sessions.map((session) => session.session.id)).toEqual([
      "supervisor",
      "worker:OPE-188:retained",
    ]);
    expect(snapshot.sessions[0]?.body).toContain("Attach OPE-188 from runtime files");
    expect(snapshot.sessions[0]?.body).toContain("stream: OPE-174");
    expect(snapshot.sessions[1]?.phase).toBe("failed");
    expect(snapshot.sessions[1]?.status).toMatchObject({
      code: "issue-blocked",
      text: "OPE-188: blocked",
    });
    expect(snapshot.sessions[1]?.session.runtime).toMatchObject({
      blocker: {
        kind: "blocked",
        reason: "Blocked on OPE-187 finalization",
      },
      state: "blocked",
    });
    expect(snapshot.sessions[1]?.body).toContain(
      "Session scheduled | io/ope-174 | /repo/tmp/workspace/tree/ope-188",
    );
    expect(snapshot.sessions[1]?.body).toContain("OPE-188: blocked");
    expect(snapshot.sessions[1]?.body).toContain(
      "Session failed | io/ope-174 | /repo/tmp/workspace/tree/ope-188: Blocked on OPE-187 finalization",
    );
    expect(frame).toContain("Attach OPE-188 from runtime files");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader inserts retained blocker context before a partial failed lifecycle", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-partial-failed-"));
  const runtimePath = resolve(root, "issues", "ope-188");
  await mkdir(runtimePath, { recursive: true });

  const worker = createWorkerSession({
    branchName: "io/ope-174",
    id: "worker:OPE-188:1",
    issue: {
      id: "issue-188",
      identifier: "OPE-188",
      title: "Prove workflow-aware TUI behavior with regression coverage",
    },
    title: "Prove workflow-aware TUI behavior with regression coverage",
    workerId: "OPE-188",
    workspacePath: "/repo/tmp/workspace/tree/ope-188",
  });
  const issueState = createIssueState(runtimePath, {
    branchName: "io/ope-174",
    controlPath: "/repo/tmp/workspace/control",
    issueId: "issue-188",
    issueIdentifier: "OPE-188",
    issueTitle: "Prove workflow-aware TUI behavior with regression coverage",
    originPath: "/repo",
    parentIssueId: "issue-174",
    parentIssueIdentifier: "OPE-174",
    status: "blocked",
    streamIssueId: "issue-174",
    streamIssueIdentifier: "OPE-174",
    updatedAt: "2026-03-10T05:00:00.000Z",
    workerId: "OPE-188",
    worktreePath: "/repo/tmp/workspace/tree/ope-188",
  });
  await writeFile(
    resolve(runtimePath, "events.log"),
    [
      JSON.stringify({
        code: "thread-started",
        format: "line",
        sequence: 1,
        session: worker,
        text: "Session started",
        timestamp: "2026-03-10T05:00:01.000Z",
        type: "status",
      }),
      JSON.stringify({
        data: {
          reason: "Blocked on OPE-187 finalization",
        },
        phase: "failed",
        sequence: 2,
        session: worker,
        timestamp: "2026-03-10T05:00:02.000Z",
        type: "session",
      }),
    ].join("\n") + "\n",
  );

  try {
    const reader = new AgentTuiRetainedReader({
      issueState,
      repoRoot: "/repo",
    });
    const store = createAgentTuiStore();
    for (const event of await reader.readInitialEvents("attach")) {
      store.observe(event);
    }

    const snapshot = store.getSnapshot();
    const body = snapshot.sessions[1]?.body ?? "";
    const blockedIndex = body.indexOf("OPE-188: blocked");
    const failedIndex = body.indexOf(
      "Session failed | io/ope-174 | /repo/tmp/workspace/tree/ope-188: Blocked on OPE-187 finalization",
    );

    expect(snapshot.sessions[1]?.status).toMatchObject({
      code: "issue-blocked",
      text: "OPE-188: blocked",
    });
    expect(snapshot.sessions[1]?.lastSequence).toBe(2);
    expect(blockedIndex).toBeGreaterThan(-1);
    expect(failedIndex).toBeGreaterThan(blockedIndex);
    expect(snapshot.sessions[1]?.eventHistory.map((entry) => entry.summary).slice(-2)).toEqual([
      "issue-blocked: OPE-188: blocked",
      "Session failed | io/ope-174 | /repo/tmp/workspace/tree/ope-188: Blocked on OPE-187 finalization",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentTuiRetainedReader tails appended retained events", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tui-retained-tail-"));
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
