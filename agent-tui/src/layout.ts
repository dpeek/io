import { basename } from "node:path";

import type { AgentSessionRef, AgentStatusCode } from "./session-events.js";
import { formatTranscriptEntries } from "./transcript.js";
import type {
  AgentTuiColumnSnapshot,
  AgentTuiSnapshot,
} from "./store.js";

const DEFAULT_FRAME_COLUMNS = 120;
const DEFAULT_FRAME_ROWS = 32;

export interface AgentTuiFrameSize {
  columns?: number;
  rows?: number;
}

export type AgentTuiViewMode = "raw" | "status";

export interface AgentTuiLayoutOptions {
  selectedColumnId?: string;
  viewMode?: AgentTuiViewMode;
}

export interface AgentTuiColumnComponentModel {
  badgeLine: string;
  childrenLine: string;
  id: string;
  isSelected: boolean;
  latestEventLine: string;
  metaLine: string;
  parentLine: string;
  statusLine: string;
  title: string;
  transcript: string;
}

export interface AgentTuiRootComponentModel {
  columns: AgentTuiColumnComponentModel[];
  selectedColumnId?: string;
  viewMode: AgentTuiViewMode;
}

function normalizeColumnSnapshot(column: AgentTuiColumnSnapshot): AgentTuiColumnSnapshot {
  return {
    ...column,
    childSessionIds: column.childSessionIds ?? [],
    depth: column.depth ?? 0,
    eventHistory: column.eventHistory ?? [],
    parentSessionId: column.parentSessionId ?? column.session.parentSessionId,
    transcriptEntries: column.transcriptEntries ?? [],
  };
}

function formatTitle(session: AgentSessionRef) {
  if (session.kind === "supervisor") {
    return "Supervisor";
  }
  const identifier = session.issue?.identifier ?? session.workerId;
  return `${identifier} ${session.title}`;
}

function formatWorkspaceLabel(workspacePath: string | undefined) {
  if (!workspacePath) {
    return undefined;
  }
  const label = basename(workspacePath);
  return label || workspacePath;
}

function formatMetaLine(column: AgentTuiColumnSnapshot) {
  const parts: string[] = [];
  if (column.session.kind !== "supervisor") {
    parts.push(`worker ${column.session.workerId}`);
  }
  if (column.session.branchName) {
    parts.push(`branch ${column.session.branchName}`);
  }
  const workspaceLabel = formatWorkspaceLabel(column.session.workspacePath);
  if (workspaceLabel) {
    parts.push(`path ${workspaceLabel}`);
  }
  return parts.join(" | ") || "No session metadata yet";
}

function formatStatusText(column: AgentTuiColumnSnapshot) {
  const text = column.status?.text?.trim();
  if (text) {
    return text;
  }
  if (column.status) {
    return column.status.code;
  }
  return "waiting for runtime events";
}

function formatStatusLine(column: AgentTuiColumnSnapshot) {
  return `Status: ${formatStatusText(column)}`;
}

function formatParentLine(
  column: AgentTuiColumnSnapshot,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
) {
  if (!column.parentSessionId) {
    return "Parent: none";
  }
  const parent = columnsById.get(column.parentSessionId);
  return `Parent: ${parent ? formatTitle(parent.session) : column.parentSessionId}`;
}

function formatChildrenLine(
  column: AgentTuiColumnSnapshot,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
) {
  const childSessionIds = column.childSessionIds ?? [];
  if (!childSessionIds.length) {
    return "Children: none";
  }
  const labels = childSessionIds.map((childId) => {
    const child = columnsById.get(childId);
    return child ? formatTitle(child.session) : childId;
  });
  return `Children: ${labels.join(", ")}`;
}

function formatLatestEventLine(column: AgentTuiColumnSnapshot) {
  const eventHistory = column.eventHistory ?? [];
  const latest =
    [...eventHistory]
      .reverse()
      .find(
        (event) => event.type !== "raw-line" || !event.summary.startsWith("stdout jsonl:"),
      ) ?? eventHistory[eventHistory.length - 1];
  if (!latest) {
    return "Latest: waiting for events";
  }
  return `Latest: ${latest.summary}`;
}

function formatStatusBadge(code: AgentStatusCode | undefined) {
  switch (code) {
    case "approval-required":
      return "APPROVAL";
    case "command":
      return "COMMAND";
    case "command-failed":
      return "COMMAND FAIL";
    case "error":
      return "ERROR";
    case "issue-assigned":
      return "ASSIGNED";
    case "issue-blocked":
      return "BLOCKED";
    case "issue-committed":
      return "COMMITTED";
    case "ready":
      return "READY";
    case "thread-started":
      return "THREAD";
    case "tool":
      return "TOOL";
    case "tool-failed":
      return "TOOL FAIL";
    case "turn-cancelled":
      return "TURN CANCELLED";
    case "turn-completed":
      return "TURN DONE";
    case "turn-failed":
      return "TURN FAIL";
    case "turn-started":
      return "TURN";
    case "waiting-on-user-input":
      return "WAITING";
    case "idle":
      return "IDLE";
    default:
      return "QUIET";
  }
}

function resolveActivity(
  column: AgentTuiColumnSnapshot,
  latestSequence: number,
): { label: string; marker: string } {
  if (
    column.phase === "failed" ||
    column.status?.code === "command-failed" ||
    column.status?.code === "tool-failed" ||
    column.status?.code === "error" ||
    column.status?.code === "turn-failed"
  ) {
    return { label: "FAIL", marker: "!" };
  }
  if (
    column.status?.code === "approval-required" ||
    column.status?.code === "waiting-on-user-input" ||
    column.status?.code === "issue-blocked"
  ) {
    return { label: "WAIT", marker: "?" };
  }
  if (
    latestSequence > 0 &&
    column.lastSequence === latestSequence &&
    column.phase !== "completed" &&
    column.phase !== "stopped"
  ) {
    return { label: "LIVE", marker: "*" };
  }
  if (column.phase === "completed" || column.phase === "stopped") {
    return { label: "DONE", marker: "=" };
  }
  return { label: "IDLE", marker: "." };
}

function formatBadgeLine(
  column: AgentTuiColumnSnapshot,
  latestSequence: number,
  selectedColumnId: string | undefined,
) {
  const activity = resolveActivity(column, latestSequence);
  const parts = [
    column.session.kind.toUpperCase(),
    column.phase.toUpperCase(),
    formatStatusBadge(column.status?.code),
    activity.label,
  ];
  if (selectedColumnId === column.session.id) {
    parts.push("FOCUS");
  }
  return parts.join(" | ");
}

function formatColumnTitle(
  column: AgentTuiColumnSnapshot,
  latestSequence: number,
  selectedColumnId: string | undefined,
) {
  const activity = resolveActivity(column, latestSequence);
  const prefix = selectedColumnId === column.session.id ? ">" : " ";
  return `${prefix} ${activity.marker} ${formatTitle(column.session)}`;
}

function formatTranscript(
  column: AgentTuiColumnSnapshot,
  viewMode: AgentTuiViewMode,
) {
  if (!(column.transcriptEntries ?? []).length) {
    const body = column.body.trimEnd();
    if (body) {
      return body;
    }
  }
  return formatTranscriptEntries(column.transcriptEntries ?? [], viewMode);
}

export function buildAgentTuiRootComponentModel(
  snapshot: AgentTuiSnapshot,
  options: AgentTuiLayoutOptions = {},
): AgentTuiRootComponentModel {
  const viewMode = options.viewMode ?? "status";
  const columns = (snapshot.columns ?? snapshot.sessions ?? []).map(normalizeColumnSnapshot);
  if (!columns.length) {
    return {
      columns: [
        {
          badgeLine: "SYSTEM | IDLE | QUIET | IDLE",
          childrenLine: "Children: none",
          id: "empty",
          isSelected: true,
          latestEventLine: "Latest: waiting for events",
          metaLine: "No active sessions",
          parentLine: "Parent: none",
          statusLine: "Status: waiting for runtime events",
          title: "> . Agent Sessions",
          transcript: "Waiting for agent session events...",
        },
      ],
      selectedColumnId: "empty",
      viewMode,
    };
  }

  const columnsById = new Map(columns.map((column) => [column.session.id, column]));
  const latestSequence = Math.max(...columns.map((column) => column.lastSequence), 0);
  const selectedColumnId =
    options.selectedColumnId && columnsById.has(options.selectedColumnId)
      ? options.selectedColumnId
      : columns[0]?.session.id;

  return {
    columns: columns.map((column) => ({
      badgeLine: formatBadgeLine(column, latestSequence, selectedColumnId),
      childrenLine: formatChildrenLine(column, columnsById),
      id: column.session.id,
      isSelected: column.session.id === selectedColumnId,
      latestEventLine: formatLatestEventLine(column),
      metaLine: formatMetaLine(column),
      parentLine: formatParentLine(column, columnsById),
      statusLine: formatStatusLine(column),
      title: formatColumnTitle(column, latestSequence, selectedColumnId),
      transcript: formatTranscript(column, viewMode),
    })),
    selectedColumnId,
    viewMode,
  };
}

function truncateEnd(text: string, width: number) {
  if (width <= 0) {
    return "";
  }
  if (text.length <= width) {
    return text;
  }
  if (width <= 3) {
    return text.slice(0, width);
  }
  return `${text.slice(0, width - 3)}...`;
}

function padCell(text: string, width: number) {
  return truncateEnd(text, width).padEnd(Math.max(width, 0), " ");
}

function wrapLine(text: string, width: number) {
  if (width <= 0) {
    return [];
  }
  if (!text.length) {
    return [""];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += width) {
    chunks.push(text.slice(index, index + width));
  }
  return chunks;
}

function wrapBody(text: string, width: number) {
  if (width <= 0) {
    return [];
  }
  const sourceLines = text.split("\n");
  if (text.endsWith("\n")) {
    sourceLines.pop();
  }
  return sourceLines.flatMap((line) => wrapLine(line, width));
}

function distributeColumnWidths(totalWidth: number, columnCount: number) {
  if (columnCount <= 0) {
    return [];
  }
  const separatorWidth = Math.max(0, columnCount - 1);
  const availableWidth = Math.max(columnCount, totalWidth - separatorWidth);
  const baseWidth = Math.floor(availableWidth / columnCount);
  let remainder = availableWidth % columnCount;
  return Array.from({ length: columnCount }, () => {
    const width = baseWidth + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return width;
  });
}

function renderEmptyFrame(columns: number, rows: number) {
  const safeColumns = Math.max(1, columns);
  const safeRows = Math.max(1, rows);
  const lines = Array.from({ length: safeRows }, (_, index) =>
    index === 0
      ? padCell("Waiting for agent session events...", safeColumns)
      : "".padEnd(safeColumns, " "),
  );
  return lines.join("\n");
}

function renderColumn(model: AgentTuiColumnComponentModel, width: number, rows: number) {
  const fixedLines = [
    padCell(model.title, width),
    padCell(model.badgeLine, width),
    padCell(model.metaLine, width),
    padCell(model.statusLine, width),
    padCell(model.parentLine, width),
    padCell(model.childrenLine, width),
    padCell(model.latestEventLine, width),
    "".padEnd(Math.max(width, 0), "-"),
  ];
  const bodyHeight = Math.max(0, rows - fixedLines.length);
  const wrappedBody = wrapBody(model.transcript, width);
  const visibleBody = wrappedBody.slice(-bodyHeight);
  const paddedBody = visibleBody
    .map((line) => padCell(line, width))
    .concat(
      Array.from({ length: Math.max(0, bodyHeight - visibleBody.length) }, () =>
        "".padEnd(width, " "),
      ),
    );
  return fixedLines.concat(paddedBody);
}

export function renderAgentTuiFrame(
  snapshot: AgentTuiSnapshot,
  size: AgentTuiFrameSize = {},
  options: AgentTuiLayoutOptions = {},
) {
  const columns = Math.max(1, size.columns ?? DEFAULT_FRAME_COLUMNS);
  const rows = Math.max(1, size.rows ?? DEFAULT_FRAME_ROWS);
  const layout = buildAgentTuiRootComponentModel(snapshot, options);
  if (!layout.columns.length) {
    return renderEmptyFrame(columns, rows);
  }

  const widths = distributeColumnWidths(columns, layout.columns.length);
  const columnsByModel = layout.columns.map((model, index) =>
    renderColumn(model, widths[index] ?? 1, rows),
  );
  const lines = Array.from({ length: rows }, (_, rowIndex) =>
    columnsByModel
      .map((column, index) => column[rowIndex] ?? "".padEnd(widths[index] ?? 1, " "))
      .join("|"),
  );
  return lines.join("\n");
}
