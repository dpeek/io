import { createCliRenderer, type CliRenderer } from "@opentui/core";
import {
  createRoot,
  flushSync,
  useTerminalDimensions,
  type Root,
} from "@opentui/react";
import { useMemo } from "react";

import {
  getAgentTuiSelectedTranscriptMetrics,
  renderAgentTuiFrame,
  type AgentTuiViewMode,
} from "./layout.js";
import type { AgentSessionEventObserver } from "./session-events.js";
import {
  createAgentTuiStore,
  type AgentTuiSnapshot,
  type AgentTuiStore,
  type AgentTuiStoreOptions,
} from "./store.js";

const APP_ROOT_ID = "agent-tui-root";

export type AgentTuiTerminal = NodeJS.WriteStream;

export interface AgentTuiOptions extends AgentTuiStoreOptions {
  input?: NodeJS.ReadStream;
  onExitRequest?: () => void | Promise<void>;
  output?: AgentTuiTerminal;
  renderer?: CliRenderer;
  requireTty?: boolean;
  store?: AgentTuiStore;
}

export interface AgentTui {
  getSnapshot(): AgentTuiSnapshot;
  observe: AgentSessionEventObserver;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type AgentTuiColumnScrollState = {
  scrollY: number;
};

type AgentTuiAppProps = {
  onExitRequest: () => void | Promise<void>;
  selectedColumnId?: string;
  selectedTranscriptScrollY?: number;
  snapshot: AgentTuiSnapshot;
  viewMode: AgentTuiViewMode;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isNextColumnKey(key: { name: string; shift: boolean }) {
  return key.name === "right" || key.name === "l" || (key.name === "tab" && !key.shift);
}

function isPreviousColumnKey(key: { name: string; shift: boolean }) {
  return key.name === "left" || key.name === "h" || (key.name === "tab" && key.shift);
}

function isTopKey(key: { name: string; shift: boolean }) {
  return key.name === "home" || key.name === "g" || key.name === "G";
}

function isBottomKey(key: { name: string; shift: boolean }) {
  return key.name === "end" || key.name === "G" || (key.name === "g" && key.shift);
}

function isQuitKey(key: { ctrl?: boolean; name: string }) {
  return (key.ctrl && key.name === "c") || key.name === "escape" || key.name === "q";
}

function buildHeaderText(
  snapshot: AgentTuiSnapshot,
  selectedColumnId: string | undefined,
  viewMode: AgentTuiViewMode,
) {
  const columns = snapshot.columns ?? snapshot.sessions ?? [];
  const selectedColumn =
    columns.find((column) => column.session.id === selectedColumnId) ?? columns[0];
  const selectedTitle = selectedColumn ? selectedColumn.session.title : "Agent Sessions";
  return [
    `View: ${viewMode.toUpperCase()} | Focus: ${selectedTitle}`,
    "Keys: left/right or h/l move columns | up/down or j/k scroll | 1 status | 2 raw | v toggle | q/esc/Ctrl+C quit",
  ].join("\n");
}

function AgentTuiApp({
  selectedColumnId,
  selectedTranscriptScrollY = 0,
  snapshot,
  viewMode,
}: AgentTuiAppProps) {
  const { height, width } = useTerminalDimensions();
  const columns = snapshot.columns ?? snapshot.sessions ?? [];
  const resolvedSelectedColumnId = columns.find((column) => column.session.id === selectedColumnId)
    ? selectedColumnId
    : columns[0]?.session.id;
  const frameSize = useMemo(
    () => ({
      columns: Math.max(1, width),
      rows: Math.max(1, height - 3),
    }),
    [height, width],
  );

  const frame = useMemo(
    () =>
      renderAgentTuiFrame(snapshot, frameSize, {
        selectedColumnId: resolvedSelectedColumnId,
        selectedTranscriptScrollY: selectedTranscriptScrollY,
        viewMode,
      }),
    [frameSize, resolvedSelectedColumnId, selectedTranscriptScrollY, snapshot, viewMode],
  );

  return (
    <box height="100%" id={APP_ROOT_ID} width="100%">
      <text
        content={`${buildHeaderText(snapshot, resolvedSelectedColumnId, viewMode)}\n\n${frame}`}
        wrapMode="none"
      />
    </box>
  );
}

export function createAgentTui(options: AgentTuiOptions = {}): AgentTui {
  const input = options.input ?? process.stdin;
  const onExitRequest =
    options.onExitRequest ??
    (() => {
      process.kill(process.pid, "SIGINT");
    });
  const output = options.output ?? process.stdout;
  const requireTty = options.requireTty ?? true;
  const store =
    options.store ??
    createAgentTuiStore({
      maxEventHistory: options.maxEventHistory,
      maxTranscriptChars: options.maxTranscriptChars,
      retainTerminalSessions: options.retainTerminalSessions ?? false,
    });
  let active = false;
  let renderScheduled = false;
  let renderer = options.renderer;
  let root: Root | undefined;
  let selectedColumnId: string | undefined;
  let startPromise: Promise<void> | undefined;
  let viewMode: AgentTuiViewMode = "status";
  let unsubscribe: (() => void) | undefined;
  const scrollStateByColumnId = new Map<string, AgentTuiColumnScrollState>();

  const ownsRenderer = !options.renderer;

  const getFrameSize = () => ({
    columns: Math.max(1, renderer?.width ?? 1),
    rows: Math.max(1, (renderer?.height ?? 4) - 3),
  });

  const selectColumn = (nextColumnId: string | undefined) => {
    if (!nextColumnId || nextColumnId === selectedColumnId) {
      return;
    }
    selectedColumnId = nextColumnId;
    scheduleRender();
  };

  const moveColumnSelection = (delta: number) => {
    const columns = store.getSnapshot().columns ?? store.getSnapshot().sessions ?? [];
    if (!columns.length) {
      return;
    }
    const currentIndex = columns.findIndex((column) => column.session.id === selectedColumnId);
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + delta + columns.length) % columns.length
        : delta > 0
          ? 0
          : columns.length - 1;
    selectColumn(columns[nextIndex]?.session.id);
  };

  const scrollSelectedTranscript = (delta: number) => {
    if (!selectedColumnId) {
      return;
    }
    const metrics = getAgentTuiSelectedTranscriptMetrics(store.getSnapshot(), getFrameSize(), {
      selectedColumnId,
      viewMode,
    });
    const current = scrollStateByColumnId.get(selectedColumnId)?.scrollY ?? 0;
    scrollStateByColumnId.set(selectedColumnId, {
      scrollY: clamp(current + delta, 0, metrics.maxScrollY),
    });
    scheduleRender();
  };

  const jumpSelectedTranscript = (position: "top" | "bottom") => {
    if (!selectedColumnId) {
      return;
    }
    const metrics = getAgentTuiSelectedTranscriptMetrics(store.getSnapshot(), getFrameSize(), {
      selectedColumnId,
      viewMode,
    });
    scrollStateByColumnId.set(selectedColumnId, {
      scrollY: position === "top" ? 0 : metrics.maxScrollY,
    });
    scheduleRender();
  };

  const toggleViewMode = (nextViewMode?: AgentTuiViewMode) => {
    const resolvedViewMode =
      nextViewMode ?? (viewMode === "status" ? ("raw" as const) : ("status" as const));
    if (resolvedViewMode === viewMode) {
      return;
    }
    viewMode = resolvedViewMode;
    scheduleRender();
  };

  const handleKeyPress = (key: {
    ctrl?: boolean;
    name: string;
    preventDefault: () => void;
    shift: boolean;
  }) => {
    if (isQuitKey(key)) {
      key.preventDefault();
      void onExitRequest();
      return;
    }
    if (isNextColumnKey(key)) {
      key.preventDefault();
      moveColumnSelection(1);
      return;
    }
    if (isPreviousColumnKey(key)) {
      key.preventDefault();
      moveColumnSelection(-1);
      return;
    }
    if (key.name === "j" || key.name === "down") {
      key.preventDefault();
      scrollSelectedTranscript(1);
      return;
    }
    if (key.name === "k" || key.name === "up") {
      key.preventDefault();
      scrollSelectedTranscript(-1);
      return;
    }
    if (key.name === "pagedown" || key.name === "space") {
      key.preventDefault();
      scrollSelectedTranscript(8);
      return;
    }
    if (key.name === "pageup") {
      key.preventDefault();
      scrollSelectedTranscript(-8);
      return;
    }
    if (isTopKey(key) && !isBottomKey(key)) {
      key.preventDefault();
      jumpSelectedTranscript("top");
      return;
    }
    if (isBottomKey(key)) {
      key.preventDefault();
      jumpSelectedTranscript("bottom");
      return;
    }
    if (key.name === "v") {
      key.preventDefault();
      toggleViewMode();
      return;
    }
    if (key.name === "1") {
      key.preventDefault();
      toggleViewMode("status");
      return;
    }
    if (key.name === "2") {
      key.preventDefault();
      toggleViewMode("raw");
    }
  };

  const render = () => {
    renderScheduled = false;
    if (!active || !root || !renderer) {
      return;
    }
    const currentRoot = root;
    const snapshot = store.getSnapshot();
    const columns = snapshot.columns ?? snapshot.sessions ?? [];
    if (!columns.find((column) => column.session.id === selectedColumnId)) {
      selectedColumnId = columns[0]?.session.id;
    }
    const selectedTranscriptScrollY = selectedColumnId
      ? (scrollStateByColumnId.get(selectedColumnId)?.scrollY ?? 0)
      : 0;
    flushSync(() => {
      currentRoot.render(
        <AgentTuiApp
          onExitRequest={onExitRequest}
          selectedColumnId={selectedColumnId}
          selectedTranscriptScrollY={selectedTranscriptScrollY}
          snapshot={snapshot}
          viewMode={viewMode}
        />,
      );
    });
    renderer.requestRender();
  };

  const scheduleRender = () => {
    if (!active || renderScheduled) {
      return;
    }
    renderScheduled = true;
    queueMicrotask(render);
  };

  const ensureStarted = async () => {
    if (startPromise) {
      await startPromise;
      return;
    }

    startPromise = (async () => {
      if (!renderer) {
        if (requireTty && !output.isTTY) {
          throw new Error("io agent tui requires a TTY");
        }
        renderer = await createCliRenderer({
          autoFocus: false,
          exitOnCtrlC: false,
          stdin: input,
          stdout: output,
          useAlternateScreen: true,
          useConsole: false,
          useMouse: false,
        });
      }

      root = createRoot(renderer);
      renderer.keyInput.on("keypress", handleKeyPress);
      if (ownsRenderer) {
        renderer.start();
      }
      render();
    })();

    try {
      await startPromise;
    } catch (error) {
      startPromise = undefined;
      throw error;
    }
  };

  return {
    getSnapshot() {
      return store.getSnapshot();
    },
    observe(event) {
      store.observe(event);
    },
    async start() {
      if (active) {
        await ensureStarted();
        return;
      }
      active = true;
      unsubscribe = store.subscribe(scheduleRender);
      try {
        await ensureStarted();
      } catch (error) {
        active = false;
        unsubscribe?.();
        unsubscribe = undefined;
        throw error;
      }
    },
    async stop() {
      if (!active && !startPromise) {
        return;
      }
      active = false;
      renderScheduled = false;
      unsubscribe?.();
      unsubscribe = undefined;

      try {
        await startPromise;
      } catch {
        // Ignore startup failures while tearing down the wrapper.
      }

      root?.unmount();
      root = undefined;
      startPromise = undefined;
      renderer?.keyInput.off("keypress", handleKeyPress);

      if (renderer && ownsRenderer) {
        renderer.destroy();
        renderer = undefined;
      }
    },
  };
}
