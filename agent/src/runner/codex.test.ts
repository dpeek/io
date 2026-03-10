import { expect, test } from "bun:test";

import {
  buildAutomaticUserInputResponse,
  createDefaultTurnSandbox,
  normalizeCodexSessionMessage,
} from "./codex.js";
import {
  createAgentSessionDisplayState,
  renderAgentStatusEvent,
  type AgentSessionRef,
} from "../session-events.js";

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
    for (const event of normalizeCodexSessionMessage(message)) {
      renderAgentStatusEvent({
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
  };
  return chunks.join("");
}

test("normalizes codex messages into typed status events", () => {
  expect(
    normalizeCodexSessionMessage({
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
    }),
  ).toEqual([
    {
      code: "command-output",
      format: "line",
      text: "| ## main",
      type: "status",
    },
    {
      code: "command-output",
      format: "line",
      text: "|  M agent/src/runner/codex.ts",
      type: "status",
    },
    {
      code: "command-failed",
      format: "line",
      text: "Command failed (exit 1)",
      type: "status",
    },
  ]);
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
      'Tool: linear.save_issue {"id":"OPE-41","state":"In Progress"}\n' +
      "Tool failed: user cancelled MCP tool call\n",
  );
});

test("auto-approves requestUserInput prompts for the session", () => {
  const response = buildAutomaticUserInputResponse({
    questions: [
      {
        id: "approval-1",
        options: [
          { description: "Run once", label: "Approve Once" },
          { description: "Remember choice", label: "Approve this Session" },
          { description: "Decline", label: "Deny" },
        ],
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
