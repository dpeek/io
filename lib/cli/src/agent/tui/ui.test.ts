import { expect, test } from "bun:test";

import { createTestRenderer } from "@opentui/core/testing";
import { act } from "react";

import { buildAgentTuiRootComponentModel } from "./layout.js";
import type { AgentSessionRef } from "./session-events.js";
import { createAgentTuiStore } from "./store.js";
import { createAgentTui } from "./tui.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
    id: "issue-68",
    identifier: "OPE-68",
    title: "Run plan",
  };
  return {
    branchName: "ope-68",
    id: "worker:OPE-68:1",
    kind: "worker",
    parentSessionId: "supervisor",
    rootSessionId: "supervisor",
    title: "Run plan",
    workerId: "OPE-68",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-68",
    ...sessionOverrides,
    issue: resolveIssueRef(baseIssue, issueOverrides),
  };
}

function createChildSession(overrides: SessionRefOverrides = {}): AgentSessionRef {
  const { issue: issueOverrides, ...sessionOverrides } = overrides;
  return {
    id: "child:OPE-68:1",
    kind: "child",
    parentSessionId: "worker:OPE-68:1",
    rootSessionId: "supervisor",
    title: "Helper",
    workerId: "OPE-68",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-68",
    ...sessionOverrides,
    issue: resolveIssueRef(undefined, issueOverrides),
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
  expect(columns[1]?.body).toContain("Session started");
  expect(columns[1]?.blocks.map((entry) => entry.kind)).toEqual(["lifecycle", "status"]);
  expect(columns[2]?.blocks.at(-1)).toMatchObject({
    argumentsText: '{"mode":"plan"}',
    kind: "tool",
    server: "helper",
    status: "running",
    tool: "spawn",
  });
  expect(columns[0]?.blocks.map((entry) => entry.kind)).toEqual(["lifecycle"]);
  const supervisorContent = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: supervisor.id,
  }).columns.find((column) => column.id === supervisor.id)?.content;
  expect(supervisorContent).toContain("Session started | /Users/dpeek/code/io");
  expect(supervisorContent).not.toContain("OPE-68");
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
  const supervisorContent = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: supervisor.id,
  }).columns[0]?.content;
  expect(supervisorContent).toContain("Session started | /Users/dpeek/code/io");
});

test("AgentTuiStore keeps active workers ahead of a short retained completed and failed tail", () => {
  const store = createAgentTuiStore({ maxRetainedTerminalWorkers: 2 });
  const supervisor = createSupervisorSession();
  const completedWorker = createWorkerSession();
  const failedWorker = createWorkerSession({
    branchName: "ope-69",
    id: "worker:OPE-69:1",
    issue: {
      id: "issue-69",
      identifier: "OPE-69",
      title: "Handle failure path",
    },
    title: "Handle failure path",
    workerId: "OPE-69",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-69",
  });
  const activeWorker = createWorkerSession({
    branchName: "ope-70",
    id: "worker:OPE-70:1",
    issue: {
      id: "issue-70",
      identifier: "OPE-70",
      title: "Keep active work visible",
    },
    title: "Keep active work visible",
    workerId: "OPE-70",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-70",
  });
  const recentCompletedWorker = createWorkerSession({
    branchName: "ope-71",
    id: "worker:OPE-71:1",
    issue: {
      id: "issue-71",
      identifier: "OPE-71",
      title: "Inspect recent completion",
    },
    title: "Inspect recent completion",
    workerId: "OPE-71",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-71",
  });

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
    session: completedWorker,
    timestamp: "2026-03-10T02:03:01.000Z",
    type: "session",
  });
  store.observe({
    phase: "completed",
    sequence: 3,
    session: completedWorker,
    timestamp: "2026-03-10T02:03:02.000Z",
    type: "session",
  });
  store.observe({
    phase: "started",
    sequence: 4,
    session: failedWorker,
    timestamp: "2026-03-10T02:03:03.000Z",
    type: "session",
  });
  store.observe({
    phase: "failed",
    sequence: 5,
    session: failedWorker,
    timestamp: "2026-03-10T02:03:04.000Z",
    type: "session",
  });
  store.observe({
    phase: "started",
    sequence: 6,
    session: activeWorker,
    timestamp: "2026-03-10T02:03:05.000Z",
    type: "session",
  });
  store.observe({
    phase: "started",
    sequence: 7,
    session: recentCompletedWorker,
    timestamp: "2026-03-10T02:03:06.000Z",
    type: "session",
  });
  store.observe({
    phase: "completed",
    sequence: 8,
    session: recentCompletedWorker,
    timestamp: "2026-03-10T02:03:07.000Z",
    type: "session",
  });

  expect(store.getSnapshot().columns.map((column) => column.session.id)).toEqual([
    "supervisor",
    "worker:OPE-70:1",
    "worker:OPE-71:1",
    "worker:OPE-69:1",
  ]);
});

test("AgentTuiStore bounds retained transcript blocks and large block payloads", () => {
  const store = createAgentTuiStore({ maxBlocksPerSession: 3 });
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: worker,
    timestamp: "2026-03-10T02:05:00.000Z",
    type: "session",
  });
  store.observe({
    code: "command",
    data: { command: "tail -f output.log" },
    format: "line",
    itemId: "cmd-1",
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:05:01.000Z",
    type: "status",
  });
  store.observe({
    code: "command-output",
    data: {
      lines: Array.from({ length: 300 }, (_, index) => `line-${index + 1}`),
    },
    format: "line",
    itemId: "cmd-1",
    sequence: 3,
    session: worker,
    timestamp: "2026-03-10T02:05:02.000Z",
    type: "status",
  });
  store.observe({
    code: "thread-started",
    format: "line",
    sequence: 4,
    session: worker,
    text: "Session started",
    timestamp: "2026-03-10T02:05:03.000Z",
    type: "status",
  });
  store.observe({
    code: "turn-started",
    format: "line",
    sequence: 5,
    session: worker,
    text: "Turn started",
    timestamp: "2026-03-10T02:05:04.000Z",
    type: "status",
  });

  const snapshot = store.getSnapshot();
  const blocks = snapshot.columns[0]?.blocks ?? [];
  expect(blocks).toHaveLength(3);
  expect(blocks[0]?.kind).toBe("lifecycle");
  expect(blocks[1]).toMatchObject({
    kind: "status",
    text: "Session started",
  });
  expect(blocks[2]).toMatchObject({
    kind: "status",
    text: "Turn started",
  });

  const boundedStore = createAgentTuiStore();
  boundedStore.observe({
    phase: "started",
    sequence: 1,
    session: worker,
    timestamp: "2026-03-10T02:06:00.000Z",
    type: "session",
  });
  boundedStore.observe({
    code: "command",
    data: { command: "tail -f output.log" },
    format: "line",
    itemId: "cmd-2",
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:06:01.000Z",
    type: "status",
  });
  boundedStore.observe({
    code: "command-output",
    data: {
      lines: Array.from({ length: 300 }, (_, index) => `line-${index + 1}`),
    },
    format: "line",
    itemId: "cmd-2",
    sequence: 3,
    session: worker,
    timestamp: "2026-03-10T02:06:02.000Z",
    type: "status",
  });
  const boundedCommand = boundedStore
    .getSnapshot()
    .columns[0]?.blocks.find((entry) => entry.kind === "command");
  expect(boundedCommand?.kind).toBe("command");
  if (boundedCommand?.kind === "command") {
    expect(boundedCommand.outputLines).toHaveLength(200);
    expect(boundedCommand.outputLines[0]).toBe("line-101");
    expect(boundedCommand.outputLines.at(-1)).toBe("line-300");
  }
});

test("buildAgentTuiRootComponentModel keeps workflow stream, task, blocker, and finalization context inspectable", () => {
  const store = createAgentTuiStore();
  const supervisor = createSupervisorSession({ workspacePath: "/repo" });
  const streamWorker = createWorkerSession({
    branchName: "io/ope-174",
    id: "worker:OPE-174:1",
    issue: {
      id: "issue-174",
      identifier: "OPE-174",
      title: "Ship workflow-aware TUI behavior",
    },
    title: "Ship workflow-aware TUI behavior",
    workerId: "OPE-174",
    workflow: {
      feature: {
        id: "issue-174",
        identifier: "OPE-174",
        title: "Ship workflow-aware TUI behavior",
      },
      stream: {
        id: "issue-121",
        identifier: "OPE-121",
        title: "Run the workflow-aware agent rollout",
      },
    },
    workspacePath: "/repo/tmp/workspace/tree/ope-174",
  });
  const blockedTask = createWorkerSession({
    branchName: "io/ope-174",
    id: "worker:OPE-188:1",
    issue: {
      id: "issue-188",
      identifier: "OPE-188",
      title: "Prove workflow-aware TUI behavior with regression coverage",
    },
    title: "Prove workflow-aware TUI behavior with regression coverage",
    workerId: "OPE-188",
    workflow: {
      feature: {
        id: "issue-174",
        identifier: "OPE-174",
        title: "Ship workflow-aware TUI behavior",
      },
      stream: {
        id: "issue-121",
        identifier: "OPE-121",
        title: "Run the workflow-aware agent rollout",
      },
      task: {
        id: "issue-188",
        identifier: "OPE-188",
        title: "Prove workflow-aware TUI behavior with regression coverage",
      },
    },
    workspacePath: "/repo/tmp/workspace/tree/ope-188",
  });
  const commitSha = "abc1234def567890abc1234def567890abc1234";

  store.observe({
    phase: "started",
    sequence: 1,
    session: supervisor,
    timestamp: "2026-03-10T02:04:00.000Z",
    type: "session",
  });
  store.observe({
    code: "workflow-diagnostic",
    data: {
      workflowDiagnostics: {
        counts: {
          blocked: 1,
          "pending-finalization": 1,
        },
        items: {
          blocked: [
            {
              branchName: "io/ope-174",
              current: {
                id: "issue-188",
                identifier: "OPE-188",
                title: "Prove workflow-aware TUI behavior with regression coverage",
              },
              workflow: blockedTask.workflow ?? {},
            },
          ],
          "pending-finalization": [
            {
              branchName: "io/ope-174",
              current: {
                id: "issue-174",
                identifier: "OPE-174",
                title: "Ship workflow-aware TUI behavior",
              },
              workflow: streamWorker.workflow ?? {},
            },
          ],
        },
        summaryText: "Workflow: 1 blocked, 1 waiting on finalization",
      },
    },
    format: "line",
    sequence: 2,
    session: supervisor,
    text: "Workflow: 1 blocked, 1 waiting on finalization",
    timestamp: "2026-03-10T02:04:00.500Z",
    type: "status",
  });
  store.observe({
    phase: "scheduled",
    sequence: 3,
    session: streamWorker,
    timestamp: "2026-03-10T02:04:01.000Z",
    type: "session",
  });
  store.observe({
    code: "issue-committed",
    data: {
      branchName: streamWorker.branchName,
      commitSha,
    },
    format: "line",
    sequence: 4,
    session: streamWorker,
    text: `OPE-174: committed ${commitSha} on ${streamWorker.branchName}`,
    timestamp: "2026-03-10T02:04:02.000Z",
    type: "status",
  });
  store.observe({
    data: {
      commitSha,
    },
    phase: "completed",
    sequence: 5,
    session: {
      ...streamWorker,
      runtime: {
        finalization: {
          commitSha,
          state: "pending",
        },
        state: "pending-finalization",
      },
    },
    timestamp: "2026-03-10T02:04:03.000Z",
    type: "session",
  });
  store.observe({
    phase: "scheduled",
    sequence: 6,
    session: blockedTask,
    timestamp: "2026-03-10T02:04:04.000Z",
    type: "session",
  });
  store.observe({
    code: "issue-blocked",
    format: "line",
    sequence: 7,
    session: blockedTask,
    text: "OPE-188: blocked",
    timestamp: "2026-03-10T02:04:05.000Z",
    type: "status",
  });
  store.observe({
    data: {
      reason: "Blocked on OPE-187 finalization",
    },
    phase: "failed",
    sequence: 8,
    session: {
      ...blockedTask,
      runtime: {
        blocker: {
          kind: "blocked",
          reason: "Blocked on OPE-187 finalization",
        },
        state: "blocked",
      },
    },
    timestamp: "2026-03-10T02:04:06.000Z",
    type: "session",
  });

  const snapshot = store.getSnapshot();
  const model = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: blockedTask.id,
  });
  const streamColumn = snapshot.columns.find((column) => column.session.id === streamWorker.id);
  const blockedColumn = snapshot.columns.find((column) => column.session.id === blockedTask.id);
  const streamContent =
    model.columns.find((column) => column.id === streamWorker.id)?.content ?? "";
  const blockedContent =
    model.columns.find((column) => column.id === blockedTask.id)?.content ?? "";

  expect(snapshot.columns.map((column) => column.session.id)).toEqual([
    "supervisor",
    "worker:OPE-188:1",
    "worker:OPE-174:1",
  ]);
  expect(snapshot.workflowDiagnostics).toMatchObject({
    counts: {
      blocked: 1,
      "pending-finalization": 1,
    },
    summaryText: "Workflow: 1 blocked, 1 waiting on finalization",
  });
  expect(streamColumn?.status).toMatchObject({
    code: "issue-committed",
    text: `OPE-174: committed ${commitSha} on io/ope-174`,
  });
  expect(streamColumn?.session.runtime).toMatchObject({
    finalization: {
      commitSha,
      state: "pending",
    },
    state: "pending-finalization",
  });
  expect(blockedColumn?.status).toMatchObject({
    code: "issue-blocked",
    text: "OPE-188: blocked",
  });
  expect(blockedColumn?.session.runtime).toMatchObject({
    blocker: {
      kind: "blocked",
      reason: "Blocked on OPE-187 finalization",
    },
    state: "blocked",
  });
  expect(model.summaryLines).toEqual([
    "Workflow: 1 blocked, 1 waiting on finalization",
    "Selected: task OPE-188 | blocked | stream OPE-121 | feature OPE-174 | io/ope-174",
  ]);
  expect(model.columns.find((column) => column.id === streamWorker.id)?.title).toBe(
    "Feature OPE-174 [waiting on finalization]",
  );
  expect(model.columns.find((column) => column.id === blockedTask.id)?.title).toBe(
    "Task OPE-188 [blocked]",
  );
  expect(streamContent).toContain("state: waiting on finalization");
  expect(streamContent).toContain("branch: io/ope-174");
  expect(streamContent).toContain("finalization: pending abc1234");
  expect(streamContent).toContain("stream: OPE-121 Run the workflow-aware agent rollout");
  expect(streamContent).toContain("feature: OPE-174 Ship workflow-aware TUI behavior");
  expect(streamContent).toContain(
    "Session scheduled | io/ope-174 | /repo/tmp/workspace/tree/ope-174",
  );
  expect(streamContent).toContain(`OPE-174: committed ${commitSha} on io/ope-174`);
  expect(streamContent).toContain(
    "Session completed | commit abc1234 | io/ope-174 | /repo/tmp/workspace/tree/ope-174",
  );
  expect(blockedContent).toContain("state: blocked");
  expect(blockedContent).toContain("branch: io/ope-174");
  expect(blockedContent).toContain("blocked: Blocked on OPE-187 finalization");
  expect(blockedContent).toContain("stream: OPE-121 Run the workflow-aware agent rollout");
  expect(blockedContent).toContain("feature: OPE-174 Ship workflow-aware TUI behavior");
  expect(blockedContent).toContain(
    "task: OPE-188 Prove workflow-aware TUI behavior with regression coverage",
  );
  expect(blockedContent).toContain(
    "Session scheduled | io/ope-174 | /repo/tmp/workspace/tree/ope-188",
  );
  expect(blockedContent).toContain("OPE-188: blocked");
  expect(blockedContent).toContain(
    "Session failed | io/ope-174 | /repo/tmp/workspace/tree/ope-188: Blocked on OPE-187 finalization",
  );
});

test("buildAgentTuiRootComponentModel renders a single human-readable block stream", () => {
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
    text: "|  M lib/cli/src/agent/runner/codex.ts",
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
  const model = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: worker.id,
  });
  const content = model.columns.find((column) => column.id === worker.id)?.content ?? "";
  const snapshotColumn = snapshot.columns.find((column) => column.session.id === worker.id);

  expect(content).toContain("$ git status --short --branch");
  expect(content).toContain("output:");
  expect(content).toContain("  ## main");
  expect(content).toContain("   M lib/cli/src/agent/runner/codex.ts");
  expect(content).toContain("Inspecting runtime state");
  expect(content).not.toContain('jsonl: {"method":"thread/started"}');
  expect(content).not.toContain("| ## main");
  expect(snapshotColumn?.blocks.map((entry) => entry.kind)).toEqual([
    "lifecycle",
    "command",
    "agent-message",
    "raw",
  ]);
  expect(snapshotColumn?.blocks.find((entry) => entry.kind === "command")).toMatchObject({
    kind: "command",
    outputLines: ["## main", " M lib/cli/src/agent/runner/codex.ts"],
  });
});

test("content flattens newline-heavy agent message chunks", () => {
  const store = createAgentTuiStore();
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: worker,
    timestamp: "2026-03-10T02:06:00.000Z",
    type: "session",
  });
  store.observe({
    code: "agent-message-delta",
    format: "chunk",
    itemId: "msg-2",
    sequence: 2,
    session: worker,
    text: "I\nread\nthe\nrequired\nrepo",
    timestamp: "2026-03-10T02:06:01.000Z",
    type: "status",
  });

  const snapshot = store.getSnapshot();
  const content =
    buildAgentTuiRootComponentModel(snapshot, {
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.content ?? "";

  expect(content).toContain("I read the required repo");
  expect(content).not.toContain("I\nread\nthe\nrequired\nrepo");
});

test("store renders codex v2 notifications as item blocks", () => {
  const store = createAgentTuiStore();
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: worker,
    timestamp: "2026-03-10T02:07:00.000Z",
    type: "session",
  });
  store.observe({
    method: "turn/started",
    params: {
      turn: { id: "turn-1", status: "in_progress" },
    },
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:07:01.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        id: "call-1",
        command: '/bin/zsh -lc "git status --short --branch"',
        commandActions: [{ command: "git status --short --branch" }],
        cwd: "/Users/dpeek/code/io",
        type: "commandExecution",
      },
    },
    sequence: 3,
    session: worker,
    timestamp: "2026-03-10T02:07:02.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/completed",
    params: {
      item: {
        aggregatedOutput: "## main\n M tui/src/store.ts\n",
        exitCode: 0,
        id: "call-1",
        status: "completed",
        type: "commandExecution",
      },
    },
    sequence: 4,
    session: worker,
    timestamp: "2026-03-10T02:07:03.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/started",
    params: {
      item: { id: "msg-1", phase: "commentary", text: "", type: "agentMessage" },
    },
    sequence: 5,
    session: worker,
    timestamp: "2026-03-10T02:07:04.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/agentMessage/delta",
    params: { delta: "Inspecting ", itemId: "msg-1" },
    sequence: 6,
    session: worker,
    timestamp: "2026-03-10T02:07:05.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/agentMessage/delta",
    params: { delta: "runtime state", itemId: "msg-1" },
    sequence: 7,
    session: worker,
    timestamp: "2026-03-10T02:07:06.000Z",
    type: "codex-notification",
  });

  const snapshot = store.getSnapshot();
  const content =
    buildAgentTuiRootComponentModel(snapshot, {
      animationFrame: 0,
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.content ?? "";

  expect(content).toContain("$ git status --short --branch");
  expect(content).toContain("output:");
  expect(content).toContain("  ## main");
  expect(content).toContain("   M tui/src/store.ts");
  expect(content).toContain("Inspecting runtime state");
});

test("buildAgentTuiRootComponentModel formats tool calls and reasoning as structured blocks", () => {
  const store = createAgentTuiStore();
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: worker,
    timestamp: "2026-03-10T02:08:00.000Z",
    type: "session",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        arguments: {
          id: "OPE-68",
          priority: 2,
          state: "In Progress",
          title: "Run plan",
        },
        id: "tool-1",
        server: "linear",
        tool: "save_issue",
        type: "mcpToolCall",
      },
    },
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:08:01.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        id: "reason-1",
        type: "reasoning",
      },
    },
    sequence: 3,
    session: worker,
    timestamp: "2026-03-10T02:08:02.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/reasoning/summaryTextDelta",
    params: {
      delta: "Checking transcript formatting",
      itemId: "reason-1",
      summaryIndex: 0,
    },
    sequence: 4,
    session: worker,
    timestamp: "2026-03-10T02:08:03.000Z",
    type: "codex-notification",
  });

  const snapshot = store.getSnapshot();
  const frameOne =
    buildAgentTuiRootComponentModel(snapshot, {
      animationFrame: 0,
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.content ?? "";
  const frameTwo =
    buildAgentTuiRootComponentModel(snapshot, {
      animationFrame: 1,
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.content ?? "";
  const selectedTitle =
    buildAgentTuiRootComponentModel(snapshot, {
      animationFrame: 0,
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.title ?? "";

  expect(frameOne).toContain("Tool: linear.save_issue [running]");
  expect(frameOne).toContain("args:");
  expect(frameOne).toContain("  id: OPE-68");
  expect(frameOne).toContain("  state: In Progress");
  expect(frameOne).not.toContain('{"id":"OPE-68"');
  expect(frameOne).toContain("Reasoning [running |]");
  expect(frameTwo).toContain("Reasoning [running /]");
  expect(frameOne).toContain("summary:");
  expect(frameOne).toContain("  Checking transcript formatting");
  expect(selectedTitle).toBe("Worker OPE-68 [running] [thinking]");
});

test("buildAgentTuiRootComponentModel highlights completed Linear writes", () => {
  const store = createAgentTuiStore();
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: worker,
    timestamp: "2026-03-10T02:09:00.000Z",
    type: "session",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        arguments: {
          id: "OPE-68",
          priority: 2,
          state: "In Progress",
          title: "Run plan",
        },
        id: "tool-2",
        server: "linear",
        tool: "save_issue",
        type: "mcpToolCall",
      },
    },
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:09:01.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/completed",
    params: {
      item: {
        arguments: {
          id: "OPE-68",
          priority: 2,
          state: "In Progress",
          title: "Run plan",
        },
        id: "tool-2",
        result: {
          structuredContent: {
            issue: {
              identifier: "OPE-68",
              title: "Run plan",
              url: "https://linear.app/io/issue/OPE-68",
            },
          },
        },
        server: "linear",
        status: "completed",
        tool: "save_issue",
        type: "mcpToolCall",
      },
    },
    sequence: 3,
    session: worker,
    timestamp: "2026-03-10T02:09:02.000Z",
    type: "codex-notification",
  });

  const snapshot = store.getSnapshot();
  const renderedColumn = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: worker.id,
  }).columns.find((column) => column.id === worker.id);
  const snapshotColumn = snapshot.columns.find((column) => column.session.id === worker.id);
  const content = renderedColumn?.content ?? "";

  expect(content).toContain("Linear issue updated: OPE-68");
  expect(content).toContain("  issue: OPE-68");
  expect(content).toContain("  title: Run plan");
  expect(content).toContain("  state: In Progress");
  expect(content).toContain("  url: https://linear.app/io/issue/OPE-68");
  expect(content).not.toContain("Tool: linear.save_issue");
  expect(content).not.toContain("args:");
  expect(snapshotColumn?.status?.text).toBe("Linear issue updated: OPE-68");
  expect(snapshotColumn?.eventHistory.at(-1)?.summary).toBe(
    "item/completed: Linear issue updated: OPE-68",
  );
});

test("buildAgentTuiRootComponentModel keeps failed Linear writes visible", () => {
  const store = createAgentTuiStore();
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: worker,
    timestamp: "2026-03-10T02:09:30.000Z",
    type: "session",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        arguments: {
          id: "OPE-68",
          state: "In Progress",
        },
        id: "tool-3",
        server: "linear",
        tool: "save_issue",
        type: "mcpToolCall",
      },
    },
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:09:31.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/completed",
    params: {
      item: {
        arguments: {
          id: "OPE-68",
          state: "In Progress",
        },
        error: { message: "user cancelled MCP tool call" },
        id: "tool-3",
        server: "linear",
        status: "failed",
        tool: "save_issue",
        type: "mcpToolCall",
      },
    },
    sequence: 3,
    session: worker,
    timestamp: "2026-03-10T02:09:32.000Z",
    type: "codex-notification",
  });

  const content =
    buildAgentTuiRootComponentModel(store.getSnapshot(), {
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.content ?? "";

  expect(content).toContain("Linear issue update failed: OPE-68");
  expect(content).toContain("  state: In Progress");
  expect(content).toContain("error:");
  expect(content).toContain("  user cancelled MCP tool call");
  expect(content).not.toContain("Tool: linear.save_issue [failed]");
});

test("buildAgentTuiRootComponentModel shows successful generic tool results", () => {
  const store = createAgentTuiStore();
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: worker,
    timestamp: "2026-03-10T02:09:35.000Z",
    type: "session",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        arguments: {
          mode: "helper",
          task: "summarize",
        },
        id: "tool-success-1",
        server: "spawned",
        tool: "run",
        type: "mcpToolCall",
      },
    },
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:09:36.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/completed",
    params: {
      item: {
        arguments: {
          mode: "helper",
          task: "summarize",
        },
        id: "tool-success-1",
        result: {
          content: [
            {
              text: "summary ready\nnext: review",
              type: "text",
            },
          ],
        },
        server: "spawned",
        tool: "run",
        type: "mcpToolCall",
      },
    },
    sequence: 3,
    session: worker,
    timestamp: "2026-03-10T02:09:37.000Z",
    type: "codex-notification",
  });

  const snapshot = store.getSnapshot();
  const content =
    buildAgentTuiRootComponentModel(snapshot, {
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.content ?? "";
  const toolEntry = snapshot.columns
    .find((column) => column.session.id === worker.id)
    ?.blocks.find((entry) => entry.kind === "tool");

  expect(content).toContain("Tool: spawned.run");
  expect(content).toContain("args:");
  expect(content).toContain("  mode: helper");
  expect(content).toContain("  task: summarize");
  expect(content).toContain("result:");
  expect(content).toContain("  summary ready");
  expect(content).toContain("  next: review");
  expect(toolEntry).toMatchObject({
    kind: "tool",
    resultText: "summary ready\nnext: review",
    status: "completed",
  });
});

test("buildAgentTuiRootComponentModel keeps live transcript slices readable in replayable snapshots", () => {
  const store = createAgentTuiStore();
  const worker = createWorkerSession();

  store.observe({
    phase: "started",
    sequence: 1,
    session: worker,
    timestamp: "2026-03-10T02:09:40.000Z",
    type: "session",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        commandActions: [{ command: "git diff --stat" }],
        id: "cmd-1",
        type: "commandExecution",
      },
    },
    sequence: 2,
    session: worker,
    timestamp: "2026-03-10T02:09:41.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/commandExecution/outputDelta",
    params: {
      delta:
        "lib/cli/src/agent/runner/codex.ts | 4 ++--\nlib/cli/src/agent/tui/ui.test.ts | 8 ++++++--\n",
      itemId: "cmd-1",
    },
    sequence: 3,
    session: worker,
    timestamp: "2026-03-10T02:09:42.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        id: "reason-2",
        type: "reasoning",
      },
    },
    sequence: 4,
    session: worker,
    timestamp: "2026-03-10T02:09:43.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/reasoning/summaryTextDelta",
    params: {
      delta: "Checking transcript seams",
      itemId: "reason-2",
      summaryIndex: 0,
    },
    sequence: 5,
    session: worker,
    timestamp: "2026-03-10T02:09:44.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/reasoning/textDelta",
    params: {
      contentIndex: 0,
      delta: "Keeping replay readable",
      itemId: "reason-2",
    },
    sequence: 6,
    session: worker,
    timestamp: "2026-03-10T02:09:45.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        arguments: {
          id: "OPE-68",
          state: "In Progress",
          title: "Run plan",
        },
        id: "tool-4",
        server: "linear",
        tool: "save_issue",
        type: "mcpToolCall",
      },
    },
    sequence: 7,
    session: worker,
    timestamp: "2026-03-10T02:09:46.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/started",
    params: {
      item: {
        arguments: {
          mode: "helper",
          task: "summarize",
        },
        id: "tool-5",
        server: "spawned",
        tool: "run",
        type: "mcpToolCall",
      },
    },
    sequence: 8,
    session: worker,
    timestamp: "2026-03-10T02:09:47.000Z",
    type: "codex-notification",
  });

  const liveContent =
    buildAgentTuiRootComponentModel(store.getSnapshot(), {
      animationFrame: 1,
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.content ?? "";

  expect(liveContent).toContain("$ git diff --stat");
  expect(liveContent).toContain("output:");
  expect(liveContent).toContain("  lib/cli/src/agent/runner/codex.ts | 4 ++--");
  expect(liveContent).toContain("Reasoning [running /]");
  expect(liveContent).toContain("summary:");
  expect(liveContent).toContain("  Checking transcript seams");
  expect(liveContent).toContain("content:");
  expect(liveContent).toContain("  Keeping replay readable");
  expect(liveContent).toContain("Tool: linear.save_issue [running]");
  expect(liveContent).toContain("Tool: spawned.run [running]");

  store.observe({
    method: "item/completed",
    params: {
      item: {
        aggregatedOutput:
          "lib/cli/src/agent/runner/codex.ts | 4 ++--\nlib/cli/src/agent/tui/ui.test.ts | 8 ++++++--\n",
        exitCode: 1,
        id: "cmd-1",
        status: "failed",
        type: "commandExecution",
      },
    },
    sequence: 9,
    session: worker,
    timestamp: "2026-03-10T02:09:48.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/completed",
    params: {
      item: {
        arguments: {
          id: "OPE-68",
          state: "In Progress",
          title: "Run plan",
        },
        id: "tool-4",
        result: {
          structuredContent: {
            issue: {
              identifier: "OPE-68",
              title: "Run plan",
              url: "https://linear.app/io/issue/OPE-68",
            },
          },
        },
        server: "linear",
        tool: "save_issue",
        type: "mcpToolCall",
      },
    },
    sequence: 10,
    session: worker,
    timestamp: "2026-03-10T02:09:49.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/completed",
    params: {
      item: {
        content: ["Keeping replay readable", "Retaining fallback output"],
        id: "reason-2",
        summary: ["Checking transcript seams"],
        type: "reasoning",
      },
    },
    sequence: 11,
    session: worker,
    timestamp: "2026-03-10T02:09:50.000Z",
    type: "codex-notification",
  });
  store.observe({
    method: "item/completed",
    params: {
      item: {
        arguments: {
          mode: "helper",
          task: "summarize",
        },
        error: { message: "permission denied" },
        id: "tool-5",
        server: "spawned",
        tool: "run",
        type: "mcpToolCall",
      },
    },
    sequence: 12,
    session: worker,
    timestamp: "2026-03-10T02:09:51.000Z",
    type: "codex-notification",
  });
  store.observe({
    encoding: "text",
    line: "retained stderr line",
    sequence: 13,
    session: worker,
    stream: "stderr",
    timestamp: "2026-03-10T02:09:52.000Z",
    type: "raw-line",
  });

  const snapshot = store.getSnapshot();
  const snapshotColumn = snapshot.columns.find((column) => column.session.id === worker.id);
  const replaySnapshot = JSON.parse(JSON.stringify(snapshot));
  const replayContent =
    buildAgentTuiRootComponentModel(replaySnapshot, {
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.content ?? "";
  const replayTitle =
    buildAgentTuiRootComponentModel(replaySnapshot, {
      selectedColumnId: worker.id,
    }).columns.find((column) => column.id === worker.id)?.title ?? "";

  expect(snapshotColumn?.blocks.map((entry) => entry.kind)).toEqual([
    "lifecycle",
    "command",
    "reasoning",
    "tool",
    "tool",
    "raw",
  ]);
  expect(snapshotColumn?.blocks.find((entry) => entry.kind === "reasoning")).toMatchObject({
    content: ["Keeping replay readable", "Retaining fallback output"],
    status: "completed",
    summary: ["Checking transcript seams"],
  });
  expect(replayContent).toContain("$ git diff --stat");
  expect(replayContent).toContain("Command failed (exit 1)");
  expect(replayContent).toContain("Linear issue updated: OPE-68");
  expect(replayContent).toContain("  issue: OPE-68");
  expect(replayContent).toContain("  title: Run plan");
  expect(replayContent).toContain("  state: In Progress");
  expect(replayContent).toContain("  url: https://linear.app/io/issue/OPE-68");
  expect(replayContent).toContain("Reasoning [completed]");
  expect(replayContent).toContain("summary:");
  expect(replayContent).toContain("  Checking transcript seams");
  expect(replayContent).toContain("content:");
  expect(replayContent).toContain("  Retaining fallback output");
  expect(replayContent).toContain("Tool: spawned.run [failed]");
  expect(replayContent).toContain("  mode: helper");
  expect(replayContent).toContain("  task: summarize");
  expect(replayContent).toContain("error:");
  expect(replayContent).toContain("  permission denied");
  expect(replayContent).toContain("stderr: retained stderr line");
  expect(replayContent).not.toContain("Tool: linear.save_issue");
  expect(replayTitle).toBe("Worker OPE-68 [running]");
});

test("createAgentTui supports keyboard column navigation and content scrolling", async () => {
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
    await act(async () => {
      await tui.start();
    });
    await act(async () => {
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
    });

    let frame = captureCharFrame();
    expect(frame).toContain("/Users/dpeek/code/io");

    await act(async () => {
      mockInput.pressArrow("right");
      await renderOnce();
    });
    frame = captureCharFrame();
    expect(frame).toContain("OPE-68");
    expect(frame).toContain("output line 11");

    await act(async () => {
      mockInput.pressArrow("up");
      await renderOnce();
    });
    frame = captureCharFrame();
    expect(frame).toContain("output line 10");

    await act(async () => {
      mockInput.pressArrow("up");
      await renderOnce();
    });
    frame = captureCharFrame();
    expect(frame).toContain("output line 9");

    await act(async () => {
      await mockInput.typeText("q");
      await Promise.resolve();
    });
    expect(exitRequested).toBe(1);
  } finally {
    await act(async () => {
      await tui.stop();
    });
    renderer.destroy();
  }
});

test("createAgentTui keeps a short recent completed and failed worker tail in live mode", async () => {
  const { renderOnce, renderer } = await createTestRenderer({
    height: 14,
    width: 96,
  });
  const tui = createAgentTui({
    renderer,
    requireTty: false,
  });
  const supervisor = createSupervisorSession();
  const completedWorker = createWorkerSession();
  const failedWorker = createWorkerSession({
    branchName: "ope-69",
    id: "worker:OPE-69:1",
    issue: {
      id: "issue-69",
      identifier: "OPE-69",
      title: "Handle failure path",
    },
    title: "Handle failure path",
    workerId: "OPE-69",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-69",
  });
  const activeWorker = createWorkerSession({
    branchName: "ope-70",
    id: "worker:OPE-70:1",
    issue: {
      id: "issue-70",
      identifier: "OPE-70",
      title: "Keep active work visible",
    },
    title: "Keep active work visible",
    workerId: "OPE-70",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-70",
  });
  const recentCompletedWorker = createWorkerSession({
    branchName: "ope-71",
    id: "worker:OPE-71:1",
    issue: {
      id: "issue-71",
      identifier: "OPE-71",
      title: "Inspect recent completion",
    },
    title: "Inspect recent completion",
    workerId: "OPE-71",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-71",
  });

  try {
    await act(async () => {
      await tui.start();
    });
    await act(async () => {
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
        session: completedWorker,
        timestamp: "2026-03-10T02:12:01.000Z",
        type: "session",
      });
      tui.observe({
        phase: "completed",
        sequence: 3,
        session: completedWorker,
        timestamp: "2026-03-10T02:12:02.000Z",
        type: "session",
      });
      tui.observe({
        phase: "started",
        sequence: 4,
        session: failedWorker,
        timestamp: "2026-03-10T02:12:03.000Z",
        type: "session",
      });
      tui.observe({
        phase: "failed",
        sequence: 5,
        session: failedWorker,
        timestamp: "2026-03-10T02:12:04.000Z",
        type: "session",
      });
      tui.observe({
        phase: "started",
        sequence: 6,
        session: activeWorker,
        timestamp: "2026-03-10T02:12:05.000Z",
        type: "session",
      });
      tui.observe({
        phase: "started",
        sequence: 7,
        session: recentCompletedWorker,
        timestamp: "2026-03-10T02:12:06.000Z",
        type: "session",
      });
      tui.observe({
        phase: "completed",
        sequence: 8,
        session: recentCompletedWorker,
        timestamp: "2026-03-10T02:12:07.000Z",
        type: "session",
      });

      await Promise.resolve();
      await renderOnce();
    });
    expect(tui.getSnapshot().columns.map((column) => column.session.id)).toEqual([
      "supervisor",
      "worker:OPE-70:1",
      "worker:OPE-71:1",
      "worker:OPE-69:1",
    ]);
  } finally {
    await act(async () => {
      await tui.stop();
    });
    renderer.destroy();
  }
});

test("createAgentTui removes finalized workers from the live column set", async () => {
  const { renderOnce, renderer } = await createTestRenderer({
    height: 14,
    width: 96,
  });
  const tui = createAgentTui({
    renderer,
    requireTty: false,
  });
  const supervisor = createSupervisorSession();
  const finalizedWorker = createWorkerSession();
  const activeWorker = createWorkerSession({
    branchName: "ope-69",
    id: "worker:OPE-69:1",
    issue: {
      id: "issue-69",
      identifier: "OPE-69",
      title: "Keep active work visible",
    },
    title: "Keep active work visible",
    workerId: "OPE-69",
    workspacePath: "/Users/dpeek/code/io/tmp/workspace/tree/ope-69",
  });
  const commitSha = "abc1234def567890abc1234def567890abc1234";

  try {
    await act(async () => {
      await tui.start();
    });
    await act(async () => {
      tui.observe({
        phase: "started",
        sequence: 1,
        session: supervisor,
        timestamp: "2026-03-10T02:13:00.000Z",
        type: "session",
      });
      tui.observe({
        phase: "started",
        sequence: 2,
        session: finalizedWorker,
        timestamp: "2026-03-10T02:13:01.000Z",
        type: "session",
      });
      tui.observe({
        phase: "completed",
        sequence: 3,
        session: {
          ...finalizedWorker,
          runtime: {
            finalization: {
              commitSha,
              state: "pending",
            },
            state: "pending-finalization",
          },
        },
        timestamp: "2026-03-10T02:13:02.000Z",
        type: "session",
      });
      tui.observe({
        phase: "started",
        sequence: 4,
        session: activeWorker,
        timestamp: "2026-03-10T02:13:03.000Z",
        type: "session",
      });

      await Promise.resolve();
      await renderOnce();
    });
    expect(tui.getSnapshot().columns.map((column) => column.session.id)).toEqual([
      "supervisor",
      "worker:OPE-69:1",
      "worker:OPE-68:1",
    ]);

    await act(async () => {
      tui.observe({
        phase: "completed",
        sequence: 5,
        session: {
          ...finalizedWorker,
          runtime: {
            finalization: {
              commitSha,
              finalizedAt: "2026-03-10T02:13:04.000Z",
              linearState: "Done",
              state: "finalized",
            },
            state: "finalized",
          },
        },
        timestamp: "2026-03-10T02:13:04.000Z",
        type: "session",
      });

      await Promise.resolve();
      await renderOnce();
    });
    expect(tui.getSnapshot().columns.map((column) => column.session.id)).toEqual([
      "supervisor",
      "worker:OPE-69:1",
    ]);
  } finally {
    await act(async () => {
      await tui.stop();
    });
    renderer.destroy();
  }
});
