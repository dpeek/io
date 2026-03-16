import { expect, test } from "bun:test";

import {
  closeAgentSessionDisplayLine,
  createAgentSessionDisplayState,
  renderAgentStatusEvent,
  renderCodexNotificationEvent,
  type AgentSessionRef,
} from "../tui/index.js";
import {
  buildAutomaticUserInputResponse,
  createDefaultTurnSandbox,
  toCodexNotificationEvent,
} from "./codex.js";

type CodexSessionMessage = Parameters<typeof toCodexNotificationEvent>[0];

function createSession(): AgentSessionRef {
  return {
    id: "worker:1",
    issue: {
      identifier: "OPE-41",
      title: "Add predicate-slot subscriptions to graph runtime",
    },
    kind: "worker",
    rootSessionId: "supervisor",
    title: "Add predicate-slot subscriptions to graph runtime",
    workerId: "worker-1",
  };
}

function renderMessages(messages: Array<Record<string, unknown>>) {
  const chunks: string[] = [];
  const session = createSession();
  const state = createAgentSessionDisplayState();
  let sequence = 0;

  for (const message of messages) {
    const event = toCodexNotificationEvent(message as CodexSessionMessage);
    if (!event) {
      continue;
    }
    renderCodexNotificationEvent({
      event: {
        ...event,
        sequence: ++sequence,
        session,
        timestamp: "2026-03-10T00:00:00.000Z",
      },
      state,
      writeDisplay: (text) => {
        chunks.push(text);
      },
    });
  }
  return chunks.join("");
}

test("maps v2 notifications into codex session events", () => {
  expect(
    toCodexNotificationEvent({
      method: "item/completed",
      params: {
        item: {
          aggregatedOutput: "## main\n M agent/src/runner/codex.ts\n",
          exitCode: 1,
          id: "call-1",
          status: "failed",
          type: "commandExecution",
        },
      },
    } as CodexSessionMessage),
  ).toEqual({
    method: "item/completed",
    params: {
      item: {
        aggregatedOutput: "## main\n M agent/src/runner/codex.ts\n",
        exitCode: 1,
        id: "call-1",
        status: "failed",
        type: "commandExecution",
      },
    },
    type: "codex-notification",
  });
});

test("renders agent message deltas as streamed session text", () => {
  const output = renderMessages([
    {
      method: "item/started",
      params: {
        item: { id: "msg-1", type: "agentMessage" },
      },
    },
    {
      method: "item/agentMessage/delta",
      params: { delta: "I’m checking", itemId: "msg-1" },
    },
    {
      method: "item/agentMessage/delta",
      params: { delta: " the current branch.", itemId: "msg-1" },
    },
    {
      method: "item/completed",
      params: {
        item: { id: "msg-1", type: "agentMessage" },
      },
    },
  ]);

  expect(output).toBe(
    "=== worker-1 OPE-41 Add predicate-slot subscriptions to graph runtime ===\n" +
      "I’m checking the current branch.\n",
  );
});

test("renders command executions and output in a readable transcript", () => {
  const output = renderMessages([
    {
      method: "item/started",
      params: {
        item: {
          commandActions: [{ command: "git status --short --branch" }],
          id: "call-1",
          type: "commandExecution",
        },
      },
    },
    {
      method: "item/completed",
      params: {
        item: {
          aggregatedOutput: "## main\n M agent/src/runner/codex.ts\n",
          id: "call-1",
          status: "completed",
          type: "commandExecution",
        },
      },
    },
  ]);

  expect(output).toBe(
    "=== worker-1 OPE-41 Add predicate-slot subscriptions to graph runtime ===\n" +
      "$ git status --short --branch\n" +
      "| ## main\n" +
      "|  M agent/src/runner/codex.ts\n",
  );
});

test("renders approval prompts and tool failures", () => {
  const output = renderMessages([
    {
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          {
            header: "Approve app tool call?",
            question:
              'The linear MCP server wants to run the tool "Save issue", which may modify or delete data. Allow this action?',
          },
        ],
      },
    },
    {
      method: "item/started",
      params: {
        item: {
          arguments: { id: "OPE-41", state: "In Progress" },
          server: "linear",
          tool: "save_issue",
          type: "mcpToolCall",
        },
      },
    },
    {
      method: "item/completed",
      params: {
        item: {
          error: { message: "user cancelled MCP tool call" },
          server: "linear",
          tool: "save_issue",
          type: "mcpToolCall",
        },
      },
    },
  ]);

  expect(output).toBe(
    "=== worker-1 OPE-41 Add predicate-slot subscriptions to graph runtime ===\n" +
      'Approval required: Approve app tool call?: The linear MCP server wants to run the tool "Save issue", which may modify or delete data. Allow this action?\n' +
      "Linear issue update: OPE-41\n" +
      "Tool failed: user cancelled MCP tool call\n",
  );
});

test("renders successful Linear writes as readable summaries", () => {
  const output = renderMessages([
    {
      method: "item/started",
      params: {
        item: {
          arguments: { id: "OPE-41", state: "In Progress", title: "Run plan" },
          server: "linear",
          tool: "save_issue",
          type: "mcpToolCall",
        },
      },
    },
    {
      method: "item/completed",
      params: {
        item: {
          arguments: { id: "OPE-41", state: "In Progress", title: "Run plan" },
          result: {
            structuredContent: {
              issue: {
                identifier: "OPE-41",
                title: "Run plan",
              },
            },
          },
          server: "linear",
          tool: "save_issue",
          type: "mcpToolCall",
        },
      },
    },
  ]);

  expect(output).toBe(
    "=== worker-1 OPE-41 Add predicate-slot subscriptions to graph runtime ===\n" +
      "Linear issue update: OPE-41\n" +
      'Tool: linear.save_issue {"id":"OPE-41","state":"In Progress","title":"Run plan"}\n',
  );
});

test("closes streamed agent lines before raw output is appended", () => {
  const chunks: string[] = [];
  const session = createSession();
  const state = createAgentSessionDisplayState();

  renderAgentStatusEvent({
    event: {
      code: "agent-message-delta",
      format: "chunk",
      itemId: "msg-1",
      sequence: 1,
      session,
      text: "Inspecting runtime state",
      timestamp: "2026-03-10T00:00:00.000Z",
      type: "status",
    },
    state,
    writeDisplay: (text) => {
      chunks.push(text);
    },
  });

  closeAgentSessionDisplayLine({
    state,
    writeDisplay: (text) => {
      chunks.push(text);
    },
  });
  chunks.push("[OPE-41 stderr] failed to parse\n");

  expect(chunks.join("")).toBe(
    "=== worker-1 OPE-41 Add predicate-slot subscriptions to graph runtime ===\n" +
      "Inspecting runtime state\n" +
      "[OPE-41 stderr] failed to parse\n",
  );
});

test("auto-approves requestUserInput prompts for the session", () => {
  const response = buildAutomaticUserInputResponse({
    questions: [
      {
        id: "approval-1",
        header: "Approve app tool call?",
        isOther: false,
        isSecret: false,
        options: [
          { description: "Run once", label: "Approve Once" },
          { description: "Remember choice", label: "Approve this Session" },
          { description: "Decline", label: "Deny" },
        ],
        question: "Allow this action?",
      },
    ],
  });

  expect(response).toEqual({
    answers: {
      "approval-1": {
        answers: ["Approve this Session"],
      },
    },
  });
});

test("default turn sandbox includes checkout and local origin", () => {
  const sandbox = createDefaultTurnSandbox({
    branchName: "ope-43",
    controlPath: "/Users/dpeek/code/io",
    createdNow: false,
    originPath: "/Users/dpeek/code/io",
    path: "/Users/dpeek/code/io/tmp/workspace/workers/worker-1/repo",
    sourceRepoPath: "/Users/dpeek/code/io",
    workerId: "worker-1",
  });

  expect(sandbox).toMatchObject({
    type: "workspaceWrite",
    writableRoots: [
      "/Users/dpeek/code/io/tmp/workspace/workers/worker-1/repo",
      "/Users/dpeek/code/io",
      "/Users/dpeek/code/io/.git",
    ],
  });
});
