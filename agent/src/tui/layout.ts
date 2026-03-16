import type { AgentSessionWorkflowIssueRef, AgentSessionWorkflowRef } from "./session-events.js";
import { formatBlocks, hasStreamingReasoningBlocks } from "./transcript.js";
import type {
  AgentTuiColumnSnapshot,
  AgentTuiSnapshot,
} from "./store.js";

const DEFAULT_FRAME_COLUMNS = 120;
const DEFAULT_FRAME_ROWS = 32;

type AgentTuiColumnRole =
  | "child"
  | "feature"
  | "stream"
  | "supervisor"
  | "task"
  | "worker";

type AgentTuiColumnWorkflowContext = {
  branchName?: string;
  currentIdentifier: string;
  currentTitle?: string;
  feature?: AgentSessionWorkflowIssueRef;
  role: AgentTuiColumnRole;
  stateLabel: string;
  stream?: AgentSessionWorkflowIssueRef;
  task?: AgentSessionWorkflowIssueRef;
};

export interface AgentTuiFrameSize {
  columns?: number;
  rows?: number;
}

export interface AgentTuiLayoutOptions {
  animationFrame?: number;
  selectedColumnId?: string;
  selectedScrollY?: number;
}

export interface AgentTuiColumnComponentModel {
  content: string;
  id: string;
  isSelected: boolean;
  metadataLines: string[];
  title: string;
}

export interface AgentTuiRootComponentModel {
  columns: AgentTuiColumnComponentModel[];
  selectedColumnId?: string;
  summaryLines: string[];
}

export interface AgentTuiRenderedPanel {
  body: string;
  id: string;
  isSelected: boolean;
  lines: string[];
  title: string;
  width: number;
}

function normalizeColumnSnapshot(column: AgentTuiColumnSnapshot): AgentTuiColumnSnapshot {
  return {
    ...column,
    childSessionIds: column.childSessionIds ?? [],
    depth: column.depth ?? 0,
    eventHistory: column.eventHistory ?? [],
    parentSessionId: column.parentSessionId ?? column.session.parentSessionId,
    blocks: column.blocks ?? [],
  };
}

function capitalize(text: string) {
  if (!text.length) {
    return text;
  }
  return `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

function truncateSha(sha: string) {
  return sha.slice(0, 7);
}

function resolveIssueLabel(
  column: AgentTuiColumnSnapshot,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
) {
  const ownIssue = column.session.issue?.identifier ?? column.session.workerId;
  if (ownIssue) {
    return ownIssue;
  }
  if (!column.parentSessionId) {
    return column.session.title;
  }
  const parent = columnsById.get(column.parentSessionId);
  return parent?.session.issue?.identifier ?? parent?.session.workerId ?? column.session.title;
}

function mergeWorkflowIssueRef(
  primary: AgentSessionWorkflowIssueRef | undefined,
  inherited: AgentSessionWorkflowIssueRef | undefined,
) {
  const merged = primary || inherited
    ? {
    ...inherited,
    ...primary,
      }
    : undefined;
  return merged?.identifier ? (merged as AgentSessionWorkflowIssueRef) : undefined;
}

function resolveInheritedWorkflow(
  column: AgentTuiColumnSnapshot,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
  visited = new Set<string>(),
): AgentSessionWorkflowRef | undefined {
  if (visited.has(column.session.id)) {
    return column.session.workflow;
  }
  visited.add(column.session.id);
  const parent =
    column.parentSessionId && column.parentSessionId !== column.session.id
      ? columnsById.get(column.parentSessionId)
      : undefined;
  const inherited: AgentSessionWorkflowRef | undefined = parent
    ? resolveInheritedWorkflow(parent, columnsById, visited)
    : undefined;
  if (!column.session.workflow) {
    return inherited;
  }
  return {
    feature: mergeWorkflowIssueRef(column.session.workflow.feature, inherited?.feature),
    stream: mergeWorkflowIssueRef(column.session.workflow.stream, inherited?.stream),
    task: mergeWorkflowIssueRef(column.session.workflow.task, inherited?.task),
  };
}

function formatColumnStateLabel(column: AgentTuiColumnSnapshot) {
  switch (column.session.runtime?.state) {
    case "blocked":
      return "blocked";
    case "finalized":
      return "finalized";
    case "interrupted":
      return "interrupted";
    case "pending-finalization":
      return "waiting on finalization";
    case "running":
      return "running";
  }

  switch (column.status?.code) {
    case "approval-required":
    case "waiting-on-user-input":
      return "waiting on input";
    case "issue-blocked":
      return "blocked";
  }

  switch (column.phase) {
    case "completed":
      return "waiting on finalization";
    case "failed":
      return "failed";
    case "scheduled":
      return "scheduled";
    case "started":
      return "running";
    case "stopped":
      return "interrupted";
    default:
      return "pending";
  }
}

function resolveColumnRole(
  column: AgentTuiColumnSnapshot,
  workflow: ReturnType<typeof resolveInheritedWorkflow>,
) {
  if (column.session.kind === "supervisor") {
    return "supervisor";
  }
  if (column.session.kind === "child") {
    return "child";
  }
  const currentIdentifier = column.session.issue?.identifier;
  if (!currentIdentifier) {
    return "worker";
  }
  if (workflow?.task?.identifier === currentIdentifier) {
    return "task";
  }
  if (workflow?.feature?.identifier === currentIdentifier) {
    return "feature";
  }
  if (workflow?.stream?.identifier === currentIdentifier) {
    return "stream";
  }
  return "worker";
}

function buildColumnWorkflowContext(
  column: AgentTuiColumnSnapshot,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
): AgentTuiColumnWorkflowContext {
  const workflow = resolveInheritedWorkflow(column, columnsById);
  const role = resolveColumnRole(column, workflow);
  const currentIdentifier = column.session.issue?.identifier ?? resolveIssueLabel(column, columnsById);
  return {
    branchName: column.session.branchName,
    currentIdentifier,
    currentTitle: column.session.issue?.title ?? column.session.title,
    feature: workflow?.feature,
    role,
    stateLabel: role === "supervisor" ? "supervising" : formatColumnStateLabel(column),
    stream: workflow?.stream,
    task: workflow?.task,
  };
}

function formatWorkflowIssueLabel(issue: AgentSessionWorkflowIssueRef | undefined) {
  if (!issue?.identifier) {
    return undefined;
  }
  return issue.title ? `${issue.identifier} ${issue.title}` : issue.identifier;
}

function buildColumnMetadataLines(
  column: AgentTuiColumnSnapshot,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
) {
  const context = buildColumnWorkflowContext(column, columnsById);
  if (context.role === "supervisor") {
    return [];
  }

  const lines = [`state: ${context.stateLabel}`];
  if (context.currentTitle) {
    lines.push(`title: ${context.currentTitle}`);
  }
  if (context.branchName) {
    lines.push(`branch: ${context.branchName}`);
  }
  const blockerReason = column.session.runtime?.blocker?.reason;
  if (blockerReason) {
    lines.push(
      `${context.stateLabel === "interrupted" ? "interrupted" : "blocked"}: ${blockerReason}`,
    );
  }
  const finalization = column.session.runtime?.finalization;
  if (finalization?.state === "pending") {
    lines.push(
      finalization.commitSha
        ? `finalization: pending ${truncateSha(finalization.commitSha)}`
        : "finalization: pending",
    );
  }
  if (finalization?.state === "finalized") {
    lines.push(
      finalization.linearState
        ? `finalized: ${finalization.linearState}`
        : "finalized",
    );
  }
  const streamLabel = formatWorkflowIssueLabel(context.stream);
  if (streamLabel) {
    lines.push(`stream: ${streamLabel}`);
  }
  const featureLabel = formatWorkflowIssueLabel(context.feature);
  if (featureLabel && context.feature?.identifier !== context.stream?.identifier) {
    lines.push(`feature: ${featureLabel}`);
  }
  const taskLabel = formatWorkflowIssueLabel(context.task);
  if (taskLabel && context.task?.identifier !== context.feature?.identifier) {
    lines.push(`task: ${taskLabel}`);
  }
  return lines;
}

function formatPanelTitle(
  column: AgentTuiColumnSnapshot,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
  options: {
    isSelected: boolean;
  },
) {
  const context = buildColumnWorkflowContext(column, columnsById);
  const baseTitle =
    context.role === "supervisor"
      ? column.session.workspacePath ?? "Supervisor"
      : context.role === "child"
        ? `Child ${column.session.title}`
        : `${capitalize(context.role)} ${context.currentIdentifier}`;
  const tags: string[] = [];
  if (context.role !== "supervisor") {
    tags.push(`[${context.stateLabel}]`);
  }
  if (options.isSelected && hasStreamingReasoningBlocks(column.blocks ?? [])) {
    tags.push("[thinking]");
  }
  return [baseTitle, ...tags].join(" ");
}

function formatTranscriptContent(
  column: AgentTuiColumnSnapshot,
  options: AgentTuiLayoutOptions = {},
) {
  if (!(column.blocks ?? []).length) {
    const body = column.body.trimEnd();
    if (body) {
      return body;
    }
  }
  return formatBlocks(column.blocks ?? [], {
    animationFrame: options.animationFrame,
  });
}

function formatContent(
  column: AgentTuiColumnSnapshot,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
  options: AgentTuiLayoutOptions = {},
) {
  const metadataLines = buildColumnMetadataLines(column, columnsById);
  const transcript = formatTranscriptContent(column, options);
  if (!metadataLines.length) {
    return transcript;
  }
  if (!transcript.trim()) {
    return metadataLines.join("\n");
  }
  return `${metadataLines.join("\n")}\n\n${transcript}`;
}

function findWorkflowSummaryLine(
  snapshot: AgentTuiSnapshot,
  column: AgentTuiColumnSnapshot | undefined,
) {
  if (snapshot.workflowDiagnostics?.summaryText) {
    return snapshot.workflowDiagnostics.summaryText;
  }
  if (!column) {
    return undefined;
  }
  for (let index = column.blocks.length - 1; index >= 0; index -= 1) {
    const entry = column.blocks[index];
    if (entry?.kind === "status" && entry.code === "workflow-diagnostic" && entry.text.startsWith("Workflow:")) {
      return entry.text;
    }
  }
  return undefined;
}

function buildSelectedSummaryLine(
  selectedColumn: AgentTuiColumnSnapshot | undefined,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
) {
  if (!selectedColumn) {
    return undefined;
  }
  const context = buildColumnWorkflowContext(selectedColumn, columnsById);
  if (context.role === "supervisor") {
    return `Selected: supervisor | ${selectedColumn.session.workspacePath ?? selectedColumn.session.title}`;
  }
  const parts = [`Selected: ${context.role} ${context.currentIdentifier}`, context.stateLabel];
  if (context.stream?.identifier && context.role !== "stream") {
    parts.push(`stream ${context.stream.identifier}`);
  }
  if (
    context.feature?.identifier &&
    context.role !== "feature" &&
    context.feature.identifier !== context.stream?.identifier
  ) {
    parts.push(`feature ${context.feature.identifier}`);
  }
  if (
    context.task?.identifier &&
    context.role !== "task" &&
    context.task.identifier !== context.feature?.identifier
  ) {
    parts.push(`task ${context.task.identifier}`);
  }
  if (context.branchName) {
    parts.push(context.branchName);
  }
  return parts.join(" | ");
}

function buildRootSummaryLines(
  snapshot: AgentTuiSnapshot,
  columns: AgentTuiColumnSnapshot[],
  columnsById: Map<string, AgentTuiColumnSnapshot>,
  selectedColumnId: string | undefined,
) {
  const supervisor = columns.find((column) => column.session.kind === "supervisor");
  const selectedColumn = selectedColumnId ? columnsById.get(selectedColumnId) : columns[0];
  return [
    findWorkflowSummaryLine(snapshot, supervisor),
    buildSelectedSummaryLine(selectedColumn, columnsById),
  ].filter((line): line is string => Boolean(line));
}

export function buildAgentTuiRootComponentModel(
  snapshot: AgentTuiSnapshot,
  options: AgentTuiLayoutOptions = {},
): AgentTuiRootComponentModel {
  const columns = (snapshot.columns ?? snapshot.sessions ?? []).map(normalizeColumnSnapshot);
  if (!columns.length) {
    return {
      columns: [
        {
          id: "empty",
          isSelected: true,
          metadataLines: [],
          title: "Agent Sessions",
          content: "Waiting for agent session events...",
        },
      ],
      selectedColumnId: "empty",
      summaryLines: [],
    };
  }

  const columnsById = new Map(columns.map((column) => [column.session.id, column]));
  const selectedColumnId =
    options.selectedColumnId && columnsById.has(options.selectedColumnId)
      ? options.selectedColumnId
      : columns[0]?.session.id;

  return {
    columns: columns.map((column) => ({
      content: formatContent(column, columnsById, options),
      id: column.session.id,
      isSelected: column.session.id === selectedColumnId,
      metadataLines: buildColumnMetadataLines(column, columnsById),
      title: formatPanelTitle(column, columnsById, {
        isSelected: column.session.id === selectedColumnId,
      }),
    })),
    selectedColumnId,
    summaryLines: buildRootSummaryLines(snapshot, columns, columnsById, selectedColumnId),
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

function buildRenderedSummaryLines(summaryLines: string[], width: number) {
  return summaryLines.flatMap((line) => wrapLine(line, width));
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

export function buildAgentTuiRenderedPanels(
  snapshot: AgentTuiSnapshot,
  size: AgentTuiFrameSize = {},
  options: AgentTuiLayoutOptions = {},
): AgentTuiRenderedPanel[] {
  const columns = Math.max(1, size.columns ?? DEFAULT_FRAME_COLUMNS);
  const rows = Math.max(1, size.rows ?? DEFAULT_FRAME_ROWS);
  const layout = buildAgentTuiRootComponentModel(snapshot, options);
  const summaryHeight = buildRenderedSummaryLines(layout.summaryLines, columns).length;
  const widths = distributeColumnWidths(columns, layout.columns.length);
  const bodyHeight = Math.max(0, rows - summaryHeight - 1);

  return layout.columns.map((model, index) => {
    const width = widths[index] ?? 1;
    const wrappedBody = wrapBody(model.content, width);
    const maxScrollY = Math.max(0, wrappedBody.length - bodyHeight);
    const start =
      model.id === layout.selectedColumnId
        ? Math.min(Math.max(0, options.selectedScrollY ?? maxScrollY), maxScrollY)
        : maxScrollY;
    const visibleBody = wrappedBody.slice(start, start + bodyHeight);
    const paddedBody = visibleBody
      .map((line) => padCell(line, width))
      .concat(
        Array.from({ length: Math.max(0, bodyHeight - visibleBody.length) }, () =>
          "".padEnd(width, " "),
        ),
      );

    return {
      body: paddedBody.join("\n"),
      id: model.id,
      isSelected: model.isSelected,
      lines: [padCell(model.title, width), ...paddedBody],
      title: model.title,
      width,
    };
  });
}

export function getAgentTuiSelectedContentMetrics(
  snapshot: AgentTuiSnapshot,
  size: AgentTuiFrameSize = {},
  options: AgentTuiLayoutOptions = {},
) {
  const layout = buildAgentTuiRootComponentModel(snapshot, options);
  const widths = distributeColumnWidths(
    Math.max(1, size.columns ?? DEFAULT_FRAME_COLUMNS),
    layout.columns.length,
  );
  const summaryHeight = buildRenderedSummaryLines(
    layout.summaryLines,
    Math.max(1, size.columns ?? DEFAULT_FRAME_COLUMNS),
  ).length;
  const selectedIndex = layout.columns.findIndex((column) => column.id === layout.selectedColumnId);
  const selectedModel = selectedIndex >= 0 ? layout.columns[selectedIndex] : layout.columns[0];
  const selectedWidth = widths[selectedIndex >= 0 ? selectedIndex : 0] ?? 1;
  if (!selectedModel) {
    return { bodyHeight: 0, maxScrollY: 0, totalLines: 0 };
  }
  const rows = Math.max(1, size.rows ?? DEFAULT_FRAME_ROWS);
  const bodyHeight = Math.max(0, rows - summaryHeight - 1);
  const totalLines = wrapBody(selectedModel.content, selectedWidth).length;
  return {
    bodyHeight,
    maxScrollY: Math.max(0, totalLines - bodyHeight),
    totalLines,
  };
}

export function renderAgentTuiFrame(
  snapshot: AgentTuiSnapshot,
  size: AgentTuiFrameSize = {},
  options: AgentTuiLayoutOptions = {},
) {
  const columns = Math.max(1, size.columns ?? DEFAULT_FRAME_COLUMNS);
  const rows = Math.max(1, size.rows ?? DEFAULT_FRAME_ROWS);
  const layout = buildAgentTuiRootComponentModel(snapshot, options);
  const summaryLines = buildRenderedSummaryLines(layout.summaryLines, columns)
    .map((line) => padCell(line, columns))
    .slice(0, rows);
  const panels = buildAgentTuiRenderedPanels(snapshot, size, options);
  if (!panels.length) {
    return renderEmptyFrame(columns, rows);
  }
  const panelRows = Math.max(0, rows - summaryLines.length);
  const lines = [
    ...summaryLines,
    ...Array.from({ length: panelRows }, (_, rowIndex) =>
      panels
        .map((panel) => panel.lines[rowIndex] ?? "".padEnd(panel.width, " "))
        .join("|"),
    ),
  ].slice(0, rows);
  return lines.join("\n");
}
