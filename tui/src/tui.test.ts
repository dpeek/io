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
  expect(columns[1]?.body).toContain("Session started");
  expect(columns[1]?.blocks.map((entry) => entry.kind)).toEqual(["lifecycle", "status"]);
  expect(columns[2]?.blocks.at(-1)).toMatchObject({
    kind: "status",
    text: 'Tool: helper.spawn {"mode":"plan"}',
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
  const model = buildAgentTuiRootComponentModel(snapshot, {
    selectedColumnId: worker.id,
  });
  const content = model.columns.find((column) => column.id === worker.id)?.content ?? "";

  expect(content).toContain("$ git status --short --branch");
  expect(content).toContain("output:");
  expect(content).toContain("  ## main");
  expect(content).toContain("   M agent/src/runner/codex.ts");
  expect(content).toContain("Inspecting runtime state");
  expect(content).not.toContain('jsonl: {"method":"thread/started"}');
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
  expect(selectedTitle).toBe("OPE-68 [thinking]");
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
  const renderedColumn =
    buildAgentTuiRootComponentModel(snapshot, {
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
      delta: "agent/src/runner/codex.ts | 4 ++--\ntui/src/tui.test.ts | 8 ++++++--\n",
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
  expect(liveContent).toContain("  agent/src/runner/codex.ts | 4 ++--");
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
        aggregatedOutput: "agent/src/runner/codex.ts | 4 ++--\ntui/src/tui.test.ts | 8 ++++++--\n",
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
  expect(
    snapshotColumn?.blocks.find((entry) => entry.kind === "reasoning"),
  ).toMatchObject({
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
  expect(replayTitle).toBe("OPE-68");
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
    expect(frame).toContain("/Users/dpeek/code/io");

    mockInput.pressArrow("right");
    await renderOnce();
    frame = captureCharFrame();
    expect(frame).toContain("OPE-68");
    expect(frame).toContain("output line 11");

    mockInput.pressArrow("up");
    await renderOnce();
    frame = captureCharFrame();
    expect(frame).toContain("output line 10");

    mockInput.pressArrow("up");
    await renderOnce();
    frame = captureCharFrame();
    expect(frame).toContain("output line 9");

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
