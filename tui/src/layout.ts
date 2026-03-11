import { formatBlocks } from "./transcript.js";
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

export interface AgentTuiLayoutOptions {
  animationFrame?: number;
  selectedColumnId?: string;
  selectedScrollY?: number;
}

export interface AgentTuiColumnComponentModel {
  content: string;
  id: string;
  isSelected: boolean;
  title: string;
}

export interface AgentTuiRootComponentModel {
  columns: AgentTuiColumnComponentModel[];
  selectedColumnId?: string;
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

function formatPanelTitle(
  column: AgentTuiColumnSnapshot,
  columnsById: Map<string, AgentTuiColumnSnapshot>,
) {
  if (column.session.kind === "supervisor") {
    return column.session.workspacePath ?? "Supervisor";
  }
  return resolveIssueLabel(column, columnsById);
}

function formatContent(
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
          title: "Agent Sessions",
          content: "Waiting for agent session events...",
        },
      ],
      selectedColumnId: "empty",
    };
  }

  const columnsById = new Map(columns.map((column) => [column.session.id, column]));
  const selectedColumnId =
    options.selectedColumnId && columnsById.has(options.selectedColumnId)
      ? options.selectedColumnId
      : columns[0]?.session.id;

  return {
    columns: columns.map((column) => ({
      id: column.session.id,
      isSelected: column.session.id === selectedColumnId,
      title: formatPanelTitle(column, columnsById),
      content: formatContent(column, options),
    })),
    selectedColumnId,
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

export function buildAgentTuiRenderedPanels(
  snapshot: AgentTuiSnapshot,
  size: AgentTuiFrameSize = {},
  options: AgentTuiLayoutOptions = {},
): AgentTuiRenderedPanel[] {
  const columns = Math.max(1, size.columns ?? DEFAULT_FRAME_COLUMNS);
  const rows = Math.max(1, size.rows ?? DEFAULT_FRAME_ROWS);
  const layout = buildAgentTuiRootComponentModel(snapshot, options);
  const widths = distributeColumnWidths(columns, layout.columns.length);
  const bodyHeight = Math.max(0, rows - 1);

  return layout.columns.map((model, index) => {
    const width = widths[index] ?? 1;
    const wrappedBody = wrapBody(model.content, width);
    const maxScrollY = Math.max(0, wrappedBody.length - bodyHeight);
    const start = model.id === layout.selectedColumnId
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
  const selectedIndex = layout.columns.findIndex((column) => column.id === layout.selectedColumnId);
  const selectedModel = selectedIndex >= 0 ? layout.columns[selectedIndex] : layout.columns[0];
  const selectedWidth = widths[selectedIndex >= 0 ? selectedIndex : 0] ?? 1;
  if (!selectedModel) {
    return { bodyHeight: 0, maxScrollY: 0, totalLines: 0 };
  }
  const rows = Math.max(1, size.rows ?? DEFAULT_FRAME_ROWS);
  const bodyHeight = Math.max(0, rows - 1);
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
  const panels = buildAgentTuiRenderedPanels(snapshot, size, options);
  if (!panels.length) {
    return renderEmptyFrame(columns, rows);
  }
  const lines = Array.from({ length: rows }, (_, rowIndex) =>
    panels
      .map((panel) => panel.lines[rowIndex] ?? "".padEnd(panel.width, " "))
      .join("|"),
  );
  return lines.join("\n");
}
