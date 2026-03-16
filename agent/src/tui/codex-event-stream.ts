import type {
  AgentCodexNotificationEvent,
  AgentSessionDisplayState,
  AgentStatusEvent,
} from "./session-events.js";
import { summarizeLinearToolCall } from "./linear-tool-format.js";
import type { AgentTuiBlock, AgentTuiStatusSummary } from "./transcript.js";

type CodexBlockAdapter = {
  appendEntry: (entry: AgentTuiBlock) => void;
  findEntryByItemId: (itemId: string | undefined) => AgentTuiBlock | undefined;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getReasoningItemText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  return asString(asRecord(value)?.text);
}

function getReasoningItemLines(
  item: Record<string, unknown> | undefined,
  field: "content" | "summary",
) {
  const values = Array.isArray(item?.[field]) ? item[field] : [];
  return values.map((value) => getReasoningItemText(value) ?? "").filter(Boolean);
}

function formatQuestionSummary(question: unknown) {
  const record = asRecord(question);
  const header = asString(record?.header);
  const prompt = asString(record?.question);
  return [header, prompt].filter(Boolean).join(": ");
}

function getCodexCommandText(item: Record<string, unknown> | undefined) {
  const command = asString(item?.command);
  const actions = Array.isArray(item?.commandActions) ? item.commandActions : [];
  const actionCommand = actions
    .map((action) => asString(asRecord(action)?.command))
    .find((candidate): candidate is string => Boolean(candidate));
  return actionCommand ?? command ?? "command";
}

function getCodexToolText(server: string | undefined, tool: string | undefined, args: unknown) {
  if (!server || !tool) {
    return undefined;
  }
  const argumentsText = args && typeof args === "object" ? ` ${JSON.stringify(args)}` : "";
  return `Tool: ${server}.${tool}${argumentsText}`;
}

function getCodexOutputLines(text: string | undefined) {
  if (!text) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return normalized ? normalized.split("\n") : [];
}

function getCodexToolResultData(result: unknown) {
  const record = asRecord(result);
  if (!record) {
    return undefined;
  }

  if (record.structuredContent !== undefined && record.structuredContent !== null) {
    return record.structuredContent;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  for (const entry of content) {
    const contentRecord = asRecord(entry);
    if (!contentRecord) {
      continue;
    }
    if (contentRecord.type === "text" && typeof contentRecord.text === "string") {
      try {
        return JSON.parse(contentRecord.text);
      } catch {
        continue;
      }
    }
    return contentRecord;
  }

  return undefined;
}

function getCodexToolResultText(result: unknown) {
  const record = asRecord(result);
  if (!record) {
    return undefined;
  }

  if (typeof record.structuredContent === "string") {
    return record.structuredContent;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  const textParts = content
    .map((entry) => {
      const contentRecord = asRecord(entry);
      return contentRecord?.type === "text" ? asString(contentRecord.text) : undefined;
    })
    .filter((entry): entry is string => Boolean(entry));

  return textParts.length ? textParts.join("\n\n") : undefined;
}

function getLinearToolSummaryText(options: {
  argumentsData?: unknown;
  resultData?: unknown;
  server?: string;
  status: "completed" | "failed" | "running";
  tool?: string;
}) {
  if (options.server !== "linear") {
    return undefined;
  }
  return summarizeLinearToolCall(options)?.summaryText;
}

function getLinearFailureText(summaryText: string | undefined, message: string) {
  return summaryText ? `${summaryText} (${message})` : `Tool failed: ${message}`;
}

function getCodexApprovalText(params: Record<string, unknown>) {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const summary = questions.map(formatQuestionSummary).filter(Boolean).join(" | ");
  return summary ? `Approval required: ${summary}` : "Approval required";
}

function toDisplayStatusEventsForCodexNotification(
  event: AgentCodexNotificationEvent,
): AgentStatusEvent[] {
  const base = {
    sequence: event.sequence,
    session: event.session,
    timestamp: event.timestamp,
    type: "status" as const,
  };

  switch (event.method) {
    case "thread/started":
      return [{ ...base, code: "thread-started", format: "line" }];
    case "turn/started":
      return [{ ...base, code: "turn-started", format: "line" }];
    case "turn/completed": {
      const turn = asRecord(event.params.turn);
      const status = asString(turn?.status);
      const error = asRecord(turn?.error);
      if (status === "failed") {
        return [
          {
            ...base,
            code: "turn-failed",
            data: { message: asString(error?.message) },
            format: "line",
          },
        ];
      }
      if (status === "interrupted") {
        return [{ ...base, code: "turn-cancelled", format: "line" }];
      }
      return [{ ...base, code: "turn-completed", format: "line" }];
    }
    case "thread/status/changed": {
      const status = asRecord(event.params.status);
      const activeFlags = Array.isArray(status?.activeFlags) ? status.activeFlags : [];
      if (asString(status?.type) !== "active" || !activeFlags.includes("waitingOnUserInput")) {
        return [];
      }
      return [{ ...base, code: "waiting-on-user-input", format: "line" }];
    }
    case "item/tool/requestUserInput":
      return [
        {
          ...base,
          code: "approval-required",
          data: { questions: event.params.questions },
          format: "line",
          text: getCodexApprovalText(event.params),
        },
      ];
    case "item/started": {
      const item = asRecord(event.params.item);
      switch (asString(item?.type)) {
        case "commandExecution":
          return [
            {
              ...base,
              code: "command",
              data: { command: getCodexCommandText(item), cwd: asString(item?.cwd) },
              format: "line",
            },
          ];
        case "mcpToolCall": {
          const server = asString(item?.server);
          const tool = asString(item?.tool);
          const summaryText = getLinearToolSummaryText({
            argumentsData: item?.arguments,
            server,
            status: "running",
            tool,
          });
          return server && tool
            ? [
                {
                  ...base,
                  code: "tool",
                  data: summaryText ? undefined : { arguments: item?.arguments, server, tool },
                  format: "line",
                  text: summaryText ?? getCodexToolText(server, tool, item?.arguments),
                },
              ]
            : [];
        }
        default:
          return [];
      }
    }
    case "item/agentMessage/delta":
      return event.params.delta
        ? [
            {
              ...base,
              code: "agent-message-delta",
              format: "chunk",
              itemId: asString(event.params.itemId),
              text: asString(event.params.delta),
            },
          ]
        : [];
    case "item/completed": {
      const item = asRecord(event.params.item);
      switch (asString(item?.type)) {
        case "agentMessage":
          return [
            {
              ...base,
              code: "agent-message-completed",
              format: "close",
              itemId: asString(item?.id),
            },
          ];
        case "commandExecution": {
          const outputLines = getCodexOutputLines(asString(item?.aggregatedOutput));
          const events: AgentStatusEvent[] = [];
          if (outputLines.length) {
            events.push({
              ...base,
              code: "command-output",
              data: { lines: outputLines },
              format: "line",
            });
          }
          if (asString(item?.status) === "failed") {
            events.push({
              ...base,
              code: "command-failed",
              data: { exitCode: asNumber(item?.exitCode) },
              format: "line",
            });
          }
          return events;
        }
        case "mcpToolCall": {
          const error = asRecord(item?.error);
          const message = asString(error?.message);
          const server = asString(item?.server);
          const tool = asString(item?.tool);
          const resultData = getCodexToolResultData(item?.result);
          const resultText = getCodexToolResultText(item?.result);
          const summaryText = getLinearToolSummaryText({
            argumentsData: item?.arguments,
            resultData,
            server,
            status: message ? "failed" : "completed",
            tool,
          });

          if (message) {
            return [
              {
                ...base,
                code: "tool-failed",
                data: {
                  arguments: item?.arguments,
                  message,
                  result: resultData,
                  resultText,
                  server,
                  tool,
                },
                format: "line",
                text: getLinearFailureText(summaryText, message),
              },
            ];
          }
          if (summaryText) {
            return [
              {
                ...base,
                code: "tool",
                data: { arguments: item?.arguments, result: resultData, resultText, server, tool },
                format: "line",
                text: summaryText,
              },
            ];
          }
          return [];
        }
        default:
          return [];
      }
    }
    case "error":
      return [
        {
          ...base,
          code: "error",
          data: {
            additionalDetails: asString(asRecord(event.params.error)?.additionalDetails),
            message: asString(asRecord(event.params.error)?.message),
          },
          format: "line",
        },
      ];
    default:
      return [];
  }
}

export function renderCodexNotificationEvent(options: {
  event: AgentCodexNotificationEvent;
  renderStatusEvent: (options: {
    event: AgentStatusEvent;
    state: AgentSessionDisplayState;
    writeDisplay: (text: string) => void;
  }) => void;
  state: AgentSessionDisplayState;
  writeDisplay: (text: string) => void;
}) {
  for (const statusEvent of toDisplayStatusEventsForCodexNotification(options.event)) {
    options.renderStatusEvent({
      event: statusEvent,
      state: options.state,
      writeDisplay: options.writeDisplay,
    });
  }
}

function appendCodexMessageEntry(adapter: CodexBlockAdapter, event: AgentCodexNotificationEvent) {
  const itemId = asString(event.params.itemId) ?? asString(asRecord(event.params.item)?.id);
  const text = asString(event.params.delta) ?? "";
  if (!text) {
    return;
  }

  const existing = adapter.findEntryByItemId(itemId);
  if (existing?.kind === "agent-message") {
    existing.count += 1;
    existing.sequenceEnd = event.sequence;
    existing.segments.push(text);
    existing.text += text;
    existing.timestamp = event.timestamp;
    return;
  }

  adapter.appendEntry({
    count: 1,
    itemId,
    kind: "agent-message",
    segments: [text],
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    text,
    timestamp: event.timestamp,
  });
}

function completeCodexMessageEntry(adapter: CodexBlockAdapter, event: AgentCodexNotificationEvent) {
  const item = asRecord(event.params.item);
  const itemId = asString(item?.id);
  const existing = adapter.findEntryByItemId(itemId);
  if (existing?.kind === "agent-message") {
    existing.sequenceEnd = event.sequence;
    existing.timestamp = event.timestamp;
    const completedText = asString(item?.text);
    if (completedText && !existing.text) {
      existing.text = completedText;
      existing.segments = [completedText];
    }
    return;
  }

  const completedText = asString(item?.text);
  if (!completedText) {
    return;
  }

  adapter.appendEntry({
    count: 1,
    itemId,
    kind: "agent-message",
    segments: [completedText],
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    text: completedText,
    timestamp: event.timestamp,
  });
}

function appendCodexApprovalEntry(adapter: CodexBlockAdapter, event: AgentCodexNotificationEvent) {
  adapter.appendEntry({
    count: 1,
    kind: "approval",
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    text: getCodexApprovalText(event.params),
    timestamp: event.timestamp,
  });
}

function appendCodexCommandEntry(adapter: CodexBlockAdapter, event: AgentCodexNotificationEvent) {
  const item = asRecord(event.params.item);
  const itemId = asString(item?.id) ?? asString(event.params.itemId);
  const existing = adapter.findEntryByItemId(itemId);
  const command = getCodexCommandText(item);
  const cwd = asString(item?.cwd);

  if (existing?.kind === "command") {
    existing.command = command;
    existing.cwd = cwd ?? existing.cwd;
    existing.count += 1;
    existing.sequenceEnd = event.sequence;
    existing.timestamp = event.timestamp;
    return;
  }

  adapter.appendEntry({
    command,
    count: 1,
    cwd,
    itemId,
    kind: "command",
    outputLines: [],
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    status: "running",
    timestamp: event.timestamp,
  });
}

function appendCodexCommandOutputDeltaEntry(
  adapter: CodexBlockAdapter,
  event: AgentCodexNotificationEvent,
) {
  const itemId = asString(event.params.itemId);
  const outputLines = getCodexOutputLines(asString(event.params.delta));
  const existing = adapter.findEntryByItemId(itemId);
  if (existing?.kind === "command") {
    existing.count += Math.max(1, outputLines.length);
    existing.outputLines.push(...outputLines);
    existing.sequenceEnd = event.sequence;
    existing.timestamp = event.timestamp;
    return;
  }
  adapter.appendEntry({
    command: "command",
    count: Math.max(1, outputLines.length),
    itemId,
    kind: "command",
    outputLines,
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    status: "running",
    timestamp: event.timestamp,
  });
}

function appendCodexCommandCompletionEntry(
  adapter: CodexBlockAdapter,
  event: AgentCodexNotificationEvent,
) {
  const item = asRecord(event.params.item);
  const itemId = asString(item?.id);
  const existing = adapter.findEntryByItemId(itemId);
  const outputLines = getCodexOutputLines(asString(item?.aggregatedOutput));
  const status = asString(item?.status) === "failed" ? "failed" : "completed";
  const exitCode = asNumber(item?.exitCode);

  if (existing?.kind === "command") {
    existing.count += Math.max(1, outputLines.length);
    if (outputLines.length) {
      existing.outputLines = outputLines;
    }
    existing.exitCode = exitCode ?? existing.exitCode;
    existing.status = status;
    existing.sequenceEnd = event.sequence;
    existing.timestamp = event.timestamp;
    return;
  }

  adapter.appendEntry({
    command: getCodexCommandText(item),
    count: Math.max(1, outputLines.length),
    cwd: asString(item?.cwd),
    exitCode,
    itemId,
    kind: "command",
    outputLines,
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    status,
    timestamp: event.timestamp,
  });
}

function appendCodexToolEntry(adapter: CodexBlockAdapter, event: AgentCodexNotificationEvent) {
  const item = asRecord(event.params.item);
  const itemId = asString(item?.id) ?? asString(event.params.itemId);
  const server = asString(item?.server) ?? "tool";
  const tool = asString(item?.tool) ?? "call";
  const existing = adapter.findEntryByItemId(itemId);

  if (existing?.kind === "tool") {
    existing.argumentsData = item?.arguments ?? existing.argumentsData;
    existing.count += 1;
    existing.sequenceEnd = event.sequence;
    existing.timestamp = event.timestamp;
    return;
  }

  adapter.appendEntry({
    argumentsData: item?.arguments,
    argumentsText:
      item?.arguments && typeof item.arguments === "object"
        ? JSON.stringify(item.arguments)
        : undefined,
    count: 1,
    itemId,
    kind: "tool",
    server,
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    status: "running",
    timestamp: event.timestamp,
    tool,
  });
}

function appendCodexToolCompletionEntry(
  adapter: CodexBlockAdapter,
  event: AgentCodexNotificationEvent,
) {
  const item = asRecord(event.params.item);
  const itemId = asString(item?.id);
  const existing = adapter.findEntryByItemId(itemId);
  const server = asString(item?.server) ?? "tool";
  const tool = asString(item?.tool) ?? "call";
  const errorText = asString(asRecord(item?.error)?.message);
  const result = asRecord(item?.result);
  const resultData = getCodexToolResultData(result);
  const resultText = getCodexToolResultText(result);

  if (existing?.kind === "tool") {
    existing.argumentsData = item?.arguments ?? existing.argumentsData;
    existing.count += 1;
    existing.errorText = errorText ?? existing.errorText;
    existing.resultData = resultData ?? existing.resultData;
    existing.resultText = resultText ?? existing.resultText;
    existing.sequenceEnd = event.sequence;
    existing.status = errorText ? "failed" : "completed";
    existing.timestamp = event.timestamp;
    return;
  }

  adapter.appendEntry({
    argumentsData: item?.arguments,
    argumentsText:
      item?.arguments && typeof item.arguments === "object"
        ? JSON.stringify(item.arguments)
        : undefined,
    count: 1,
    errorText,
    itemId,
    kind: "tool",
    resultData,
    resultText,
    server,
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    status: errorText ? "failed" : "completed",
    timestamp: event.timestamp,
    tool,
  });
}

function appendCodexReasoningEntry(adapter: CodexBlockAdapter, event: AgentCodexNotificationEvent) {
  const itemId = asString(event.params.itemId) ?? asString(asRecord(event.params.item)?.id);
  const existing = adapter.findEntryByItemId(itemId);
  const delta = asString(event.params.delta);

  if (existing?.kind === "reasoning") {
    existing.count += 1;
    existing.sequenceEnd = event.sequence;
    existing.status = event.method === "item/completed" ? "completed" : "streaming";
    existing.timestamp = event.timestamp;
    if (event.method === "item/reasoning/summaryTextDelta" && delta) {
      const index = asNumber(event.params.summaryIndex) ?? 0;
      existing.summary[index] = `${existing.summary[index] ?? ""}${delta}`;
    } else if (event.method === "item/reasoning/summaryPartAdded") {
      const index = asNumber(event.params.summaryIndex) ?? existing.summary.length;
      existing.summary[index] = existing.summary[index] ?? "";
    } else if (event.method === "item/reasoning/textDelta" && delta) {
      const index = asNumber(event.params.contentIndex) ?? 0;
      existing.content[index] = `${existing.content[index] ?? ""}${delta}`;
    } else if (event.method === "item/completed") {
      const item = asRecord(event.params.item);
      if (Array.isArray(item?.summary)) {
        existing.summary = getReasoningItemLines(item, "summary");
      }
      if (Array.isArray(item?.content)) {
        existing.content = getReasoningItemLines(item, "content");
      }
    }
    return;
  }

  const item = asRecord(event.params.item);
  adapter.appendEntry({
    content: getReasoningItemLines(item, "content"),
    count: 1,
    itemId,
    kind: "reasoning",
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    status: event.method === "item/completed" ? "completed" : "streaming",
    summary: getReasoningItemLines(item, "summary"),
    timestamp: event.timestamp,
  });
}

function appendCodexPlanEntry(adapter: CodexBlockAdapter, event: AgentCodexNotificationEvent) {
  const itemId = asString(event.params.itemId) ?? asString(asRecord(event.params.item)?.id);
  const existing = adapter.findEntryByItemId(itemId);
  const delta = asString(event.params.delta) ?? "";

  if (existing?.kind === "plan") {
    existing.count += 1;
    existing.sequenceEnd = event.sequence;
    existing.status = event.method === "item/completed" ? "completed" : existing.status;
    existing.text += delta;
    existing.timestamp = event.timestamp;
    return;
  }

  adapter.appendEntry({
    count: 1,
    itemId,
    kind: "plan",
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    status: event.method === "item/completed" ? "completed" : "streaming",
    text: delta || asString(asRecord(event.params.item)?.text) || "",
    timestamp: event.timestamp,
  });
}

export function appendCodexNotificationToBlocks(
  adapter: CodexBlockAdapter,
  event: AgentCodexNotificationEvent,
) {
  switch (event.method) {
    case "item/agentMessage/delta":
      appendCodexMessageEntry(adapter, event);
      return;
    case "item/tool/requestUserInput":
      appendCodexApprovalEntry(adapter, event);
      return;
    case "item/commandExecution/outputDelta":
      appendCodexCommandOutputDeltaEntry(adapter, event);
      return;
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      appendCodexReasoningEntry(adapter, event);
      return;
    case "item/plan/delta":
      appendCodexPlanEntry(adapter, event);
      return;
    case "item/started": {
      const item = asRecord(event.params.item);
      switch (asString(item?.type)) {
        case "commandExecution":
          appendCodexCommandEntry(adapter, event);
          return;
        case "mcpToolCall":
          appendCodexToolEntry(adapter, event);
          return;
        case "reasoning":
          appendCodexReasoningEntry(adapter, event);
          return;
        case "plan":
          appendCodexPlanEntry(adapter, event);
          return;
        default:
          return;
      }
    }
    case "item/completed": {
      const item = asRecord(event.params.item);
      switch (asString(item?.type)) {
        case "agentMessage":
          completeCodexMessageEntry(adapter, event);
          return;
        case "commandExecution":
          appendCodexCommandCompletionEntry(adapter, event);
          return;
        case "mcpToolCall":
          appendCodexToolCompletionEntry(adapter, event);
          return;
        case "reasoning":
          appendCodexReasoningEntry(adapter, event);
          return;
        case "plan":
          appendCodexPlanEntry(adapter, event);
          return;
        default:
          return;
      }
    }
  }
}

export function formatCodexNotificationSummary(event: AgentCodexNotificationEvent) {
  switch (event.method) {
    case "thread/started":
      return "Session started";
    case "turn/started":
      return "Turn started";
    case "turn/completed": {
      const turn = asRecord(event.params.turn);
      const status = asString(turn?.status);
      const errorMessage = asString(asRecord(turn?.error)?.message);
      if (status === "failed") {
        return errorMessage ? `Turn failed: ${errorMessage}` : "Turn failed";
      }
      if (status === "interrupted") {
        return "Turn interrupted";
      }
      return "Turn completed";
    }
    case "thread/status/changed": {
      const status = asRecord(event.params.status);
      const activeFlags = Array.isArray(status?.activeFlags) ? status.activeFlags : [];
      if (asString(status?.type) === "active" && activeFlags.includes("waitingOnUserInput")) {
        return "Waiting for user input";
      }
      return undefined;
    }
    case "item/tool/requestUserInput":
      return getCodexApprovalText(event.params);
    case "item/started": {
      const item = asRecord(event.params.item);
      switch (asString(item?.type)) {
        case "commandExecution":
          return `$ ${getCodexCommandText(item)}`;
        case "mcpToolCall":
          return (
            getLinearToolSummaryText({
              argumentsData: item?.arguments,
              server: asString(item?.server),
              status: "running",
              tool: asString(item?.tool),
            }) ?? getCodexToolText(asString(item?.server), asString(item?.tool), item?.arguments)
          );
        case "plan":
          return "Plan started";
        case "reasoning":
          return "Reasoning started";
        default:
          return undefined;
      }
    }
    case "item/completed": {
      const item = asRecord(event.params.item);
      switch (asString(item?.type)) {
        case "commandExecution": {
          const status = asString(item?.status);
          const exitCode = asNumber(item?.exitCode);
          if (status === "failed") {
            return `Command failed${typeof exitCode === "number" ? ` (exit ${exitCode})` : ""}`;
          }
          return `$ ${getCodexCommandText(item)}`;
        }
        case "mcpToolCall": {
          const errorMessage = asString(asRecord(item?.error)?.message);
          const summaryText = getLinearToolSummaryText({
            argumentsData: item?.arguments,
            resultData: getCodexToolResultData(item?.result),
            server: asString(item?.server),
            status: errorMessage ? "failed" : "completed",
            tool: asString(item?.tool),
          });
          if (errorMessage) {
            return getLinearFailureText(summaryText, errorMessage);
          }
          return (
            summaryText ??
            getCodexToolText(asString(item?.server), asString(item?.tool), item?.arguments)
          );
        }
        case "plan":
          return asString(item?.text)
            ? `Plan: ${truncateSummary(asString(item?.text) ?? "")}`
            : "Plan updated";
        default:
          return undefined;
      }
    }
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      return undefined;
    case "error": {
      const error = asRecord(event.params.error);
      const message = [asString(error?.message), asString(error?.additionalDetails)]
        .filter(Boolean)
        .join(" ");
      return message ? `Error: ${message}` : "Error";
    }
    case "thread/compacted":
      return "Context compacted";
    case "model/rerouted":
      return "Model rerouted";
    default:
      return event.method;
  }
}

export function createStatusSummaryFromCodexNotification(
  event: AgentCodexNotificationEvent,
): AgentTuiStatusSummary | undefined {
  switch (event.method) {
    case "thread/started":
      return {
        code: "thread-started",
        format: "line",
        text: "Session started",
        timestamp: event.timestamp,
      };
    case "turn/started":
      return {
        code: "turn-started",
        format: "line",
        text: "Turn started",
        timestamp: event.timestamp,
      };
    case "turn/completed": {
      const turn = asRecord(event.params.turn);
      const status = asString(turn?.status);
      const error = asRecord(turn?.error);
      if (status === "failed") {
        return {
          code: "turn-failed",
          data: { message: asString(error?.message) },
          format: "line",
          text: asString(error?.message)
            ? `Turn failed: ${asString(error?.message)}`
            : "Turn failed",
          timestamp: event.timestamp,
        };
      }
      if (status === "interrupted") {
        return {
          code: "turn-cancelled",
          format: "line",
          text: "Turn interrupted",
          timestamp: event.timestamp,
        };
      }
      return {
        code: "turn-completed",
        format: "line",
        text: "Turn completed",
        timestamp: event.timestamp,
      };
    }
    case "thread/status/changed": {
      const status = asRecord(event.params.status);
      const activeFlags = Array.isArray(status?.activeFlags) ? status.activeFlags : [];
      if (asString(status?.type) !== "active" || !activeFlags.includes("waitingOnUserInput")) {
        return undefined;
      }
      return {
        code: "waiting-on-user-input",
        format: "line",
        text: "Waiting for user input",
        timestamp: event.timestamp,
      };
    }
    case "item/tool/requestUserInput":
      return {
        code: "approval-required",
        data: { questions: event.params.questions },
        format: "line",
        text: getCodexApprovalText(event.params),
        timestamp: event.timestamp,
      };
    case "item/started": {
      const item = asRecord(event.params.item);
      switch (asString(item?.type)) {
        case "commandExecution":
          return {
            code: "command",
            data: { command: getCodexCommandText(item), cwd: asString(item?.cwd) },
            format: "line",
            itemId: asString(item?.id),
            text: `$ ${getCodexCommandText(item)}`,
            timestamp: event.timestamp,
          };
        case "mcpToolCall": {
          const server = asString(item?.server);
          const tool = asString(item?.tool);
          const text =
            getLinearToolSummaryText({
              argumentsData: item?.arguments,
              server,
              status: "running",
              tool,
            }) ?? getCodexToolText(server, tool, item?.arguments);
          return server && tool
            ? {
                code: "tool",
                data: text?.startsWith("Linear ")
                  ? undefined
                  : { arguments: item?.arguments, server, tool },
                format: "line",
                itemId: asString(item?.id),
                text,
                timestamp: event.timestamp,
              }
            : undefined;
        }
        default:
          return undefined;
      }
    }
    case "item/completed": {
      const item = asRecord(event.params.item);
      if (asString(item?.type) === "commandExecution" && asString(item?.status) === "failed") {
        const exitCode = asNumber(item?.exitCode);
        return {
          code: "command-failed",
          data: { exitCode },
          format: "line",
          itemId: asString(item?.id),
          text: `Command failed${typeof exitCode === "number" ? ` (exit ${exitCode})` : ""}`,
          timestamp: event.timestamp,
        };
      }
      if (asString(item?.type) === "mcpToolCall") {
        const error = asString(asRecord(item?.error)?.message);
        const resultData = getCodexToolResultData(item?.result);
        const resultText = getCodexToolResultText(item?.result);
        const summaryText = getLinearToolSummaryText({
          argumentsData: item?.arguments,
          resultData,
          server: asString(item?.server),
          status: error ? "failed" : "completed",
          tool: asString(item?.tool),
        });
        if (error) {
          return {
            code: "tool-failed",
            data: {
              arguments: item?.arguments,
              message: error,
              result: resultData,
              resultText,
              server: asString(item?.server),
              tool: asString(item?.tool),
            },
            format: "line",
            itemId: asString(item?.id),
            text: getLinearFailureText(summaryText, error),
            timestamp: event.timestamp,
          };
        }
        if (summaryText) {
          return {
            code: "tool",
            data: {
              arguments: item?.arguments,
              result: resultData,
              resultText,
              server: asString(item?.server),
              tool: asString(item?.tool),
            },
            format: "line",
            itemId: asString(item?.id),
            text: summaryText,
            timestamp: event.timestamp,
          };
        }
      }
      return undefined;
    }
    case "error": {
      const error = asRecord(event.params.error);
      const text = [asString(error?.message), asString(error?.additionalDetails)]
        .filter(Boolean)
        .join(" ");
      return {
        code: "error",
        data: {
          additionalDetails: asString(error?.additionalDetails),
          message: asString(error?.message),
        },
        format: "line",
        text: text ? `Error: ${text}` : "Error",
        timestamp: event.timestamp,
      };
    }
    default:
      return undefined;
  }
}

function truncateSummary(text: string, maxChars = 120) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
}
