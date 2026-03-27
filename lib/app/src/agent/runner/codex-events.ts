import type {
  RequestId,
  ServerNotification,
  ServerRequest,
} from "../plugin/codex/server/api/index.js";
import type { AgentCodexNotificationEventInit, AgentStatusEventInit } from "../tui/index.js";

export type JsonRpcError = {
  code?: number;
  message?: string;
};

export type JsonRpcSuccessResponse<TResult = unknown> = {
  id: RequestId;
  result: TResult;
};

export type JsonRpcErrorResponse = {
  error: JsonRpcError;
  id?: RequestId;
};

export type MalformedJsonRpcMessage = {
  error: { message: string };
  method: "malformed";
};

export type LegacyCodexEventMessage = {
  method: `codex/event/${string}`;
  params?: {
    conversationId?: string;
    id?: string;
    msg?: {
      type?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

export type CodexSessionMessage =
  | JsonRpcErrorResponse
  | JsonRpcSuccessResponse
  | LegacyCodexEventMessage
  | MalformedJsonRpcMessage
  | ServerNotification
  | ServerRequest;

type CodexStatusEvent = Omit<AgentStatusEventInit, "session">;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function toCodexNotificationEvent(
  message: CodexSessionMessage,
): Omit<AgentCodexNotificationEventInit, "session"> | undefined {
  if (!isServerNotificationMessage(message)) {
    return undefined;
  }
  return {
    method: message.method,
    params: asRecord(message.params) ?? {},
    type: "codex-notification",
  };
}

function renderCommandOutputLines(output: string) {
  const normalized = output.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return normalized ? normalized.split("\n") : [];
}

export function isJsonRpcSuccessResponse(
  message: CodexSessionMessage,
): message is JsonRpcSuccessResponse {
  return "id" in message && "result" in message;
}

export function isJsonRpcErrorResponse(
  message: CodexSessionMessage,
): message is JsonRpcErrorResponse {
  return !("method" in message) && "error" in message;
}

export function isServerRequestMessage(message: CodexSessionMessage): message is ServerRequest {
  return "method" in message && "id" in message;
}

export function isServerNotificationMessage(
  message: CodexSessionMessage,
): message is ServerNotification {
  return "method" in message && !("id" in message) && message.method !== "malformed";
}

function isLegacyCodexEventMessage(
  message: CodexSessionMessage,
): message is LegacyCodexEventMessage {
  return "method" in message && message.method.startsWith("codex/event/");
}

export function summarizeCodexMessage(message: CodexSessionMessage) {
  if ("method" in message) {
    return message.method;
  }
  if (isJsonRpcErrorResponse(message) && message.id !== undefined) {
    return `response:error:${message.id}`;
  }
  if (isJsonRpcSuccessResponse(message)) {
    return `response:ok:${message.id}`;
  }
  return "message:unknown";
}

export function summarizeCodexParams(params: unknown) {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const record = params as Record<string, unknown>;
  return {
    itemId: typeof record.itemId === "string" ? record.itemId : undefined,
    threadId: typeof record.threadId === "string" ? record.threadId : undefined,
    turnId: typeof record.turnId === "string" ? record.turnId : undefined,
  };
}

function summarizeCommandExecution(item: {
  command: string;
  commandActions: Array<{ command: string }>;
}) {
  return (
    item.commandActions.map((action) => action.command).find(Boolean) ?? item.command ?? "command"
  );
}

function normalizeLegacyCodexEventMessage(message: LegacyCodexEventMessage): CodexStatusEvent[] {
  const params = asRecord(message.params);
  const payload = asRecord(params?.msg);
  const eventType =
    typeof payload?.type === "string"
      ? payload.type
      : message.method.startsWith("codex/event/")
        ? message.method.slice("codex/event/".length)
        : undefined;

  switch (eventType) {
    case "task_started":
      return [{ code: "turn-started", format: "line", type: "status" }];
    case "task_complete":
      return [{ code: "turn-completed", format: "line", type: "status" }];
    case "agent_message_delta":
      // Ignore the legacy alias. The v2 item/agentMessage/delta stream carries the
      // same text with a stable itemId and avoids fragmenting the transcript.
      return [];
    case "agent_message": {
      const text = typeof payload?.message === "string" ? payload.message : undefined;
      if (!text) {
        return [{ code: "agent-message-completed", format: "close", type: "status" }];
      }
      return [
        {
          code: "agent-message-delta",
          format: "chunk",
          text,
          type: "status",
        },
        {
          code: "agent-message-completed",
          format: "close",
          type: "status",
        },
      ];
    }
    default:
      return [];
  }
}

export function normalizeCodexSessionMessage(message: CodexSessionMessage): CodexStatusEvent[] {
  if (!("method" in message)) {
    return [];
  }

  if (isLegacyCodexEventMessage(message)) {
    return normalizeLegacyCodexEventMessage(message);
  }

  switch (message.method) {
    case "thread/started":
      return [{ code: "thread-started", format: "line", type: "status" }];
    case "turn/started":
      return [{ code: "turn-started", format: "line", type: "status" }];
    case "turn/completed": {
      const params = "params" in message ? asRecord(message.params) : undefined;
      const turn = asRecord(params?.turn);
      const status = typeof turn?.status === "string" ? turn.status : undefined;
      const error = asRecord(turn?.error);
      if (status === "failed") {
        return [
          {
            code: "turn-failed",
            data: {
              message: typeof error?.message === "string" ? error.message : undefined,
            },
            format: "line",
            type: "status",
          },
        ];
      }
      if (status === "interrupted") {
        return [{ code: "turn-cancelled", format: "line", type: "status" }];
      }
      return [{ code: "turn-completed", format: "line", type: "status" }];
    }
    case "thread/status/changed":
      if (
        message.params.status.type !== "active" ||
        !message.params.status.activeFlags.includes("waitingOnUserInput")
      ) {
        return [];
      }
      return [{ code: "waiting-on-user-input", format: "line", type: "status" }];
    case "item/started":
      switch (message.params.item.type) {
        case "commandExecution":
          return [
            {
              code: "command",
              data: { command: summarizeCommandExecution(message.params.item) },
              format: "line",
              type: "status",
            },
          ];
        case "mcpToolCall":
          return [
            {
              code: "tool",
              data: {
                arguments: message.params.item.arguments,
                server: message.params.item.server,
                tool: message.params.item.tool,
              },
              format: "line",
              type: "status",
            },
          ];
        default:
          return [];
      }
    case "item/agentMessage/delta":
      if (!message.params.delta) {
        return [];
      }
      return [
        {
          code: "agent-message-delta",
          format: "chunk",
          itemId: message.params.itemId,
          text: message.params.delta,
          type: "status",
        },
      ];
    case "item/tool/requestUserInput":
      return [
        {
          code: "approval-required",
          data: {
            questions: message.params.questions.map((question) => ({
              header: question.header,
              question: question.question,
            })),
          },
          format: "line",
          type: "status",
        },
      ];
    case "item/completed":
      switch (message.params.item.type) {
        case "agentMessage":
          return [
            {
              code: "agent-message-completed",
              format: "close",
              itemId: message.params.item.id,
              type: "status",
            },
          ];
        case "commandExecution": {
          const events: CodexStatusEvent[] = [];
          const lines = renderCommandOutputLines(message.params.item.aggregatedOutput ?? "");
          if (lines.length) {
            events.push({
              code: "command-output",
              data: { lines },
              format: "line",
              type: "status",
            });
          }
          if (message.params.item.status === "failed") {
            events.push({
              code: "command-failed",
              data: {
                exitCode: message.params.item.exitCode ?? undefined,
              },
              format: "line",
              type: "status",
            });
          }
          return events;
        }
        case "mcpToolCall":
          if (!message.params.item.error?.message) {
            return [];
          }
          return [
            {
              code: "tool-failed",
              data: {
                message: message.params.item.error.message,
              },
              format: "line",
              type: "status",
            },
          ];
        default:
          return [];
      }
    case "error":
      return [
        {
          code: "error",
          data: {
            additionalDetails: message.params.error.additionalDetails,
            message: message.params.error.message,
          },
          format: "line",
          type: "status",
        },
      ];
    case "malformed":
      return [
        {
          code: "error",
          data: {
            message: message.error.message,
          },
          format: "line",
          type: "status",
        },
      ];
    default:
      return [];
  }
}
