import { expect, test } from "bun:test";

import {
  buildAutomaticUserInputResponse,
  createDefaultTurnSandbox,
  renderCodexSessionMessage,
  type SessionDisplayState,
} from "./codex.js";

function createState(): SessionDisplayState {
  return {
    headerPrinted: false,
    lineOpen: false,
  };
}

function renderMessages(messages: Array<Record<string, unknown>>) {
  const chunks: string[] = [];
  const state = createState();
  for (const message of messages) {
    renderCodexSessionMessage({
      issueIdentifier: "OPE-41",
      issueTitle: "Add predicate-slot subscriptions to graph runtime",
      message,
      state,
      workerId: "worker-1",
      writeDisplay: (text) => {
        chunks.push(text);
      },
    });
  }
  return chunks.join("");
}

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
    ],
  });
});
