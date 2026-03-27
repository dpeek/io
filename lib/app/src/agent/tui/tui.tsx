/** @jsxImportSource @opentui/react */

import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, flushSync, useTerminalDimensions, type Root } from "@opentui/react";
import { useMemo } from "react";

import {
  buildAgentTuiRenderedPanels,
  buildAgentTuiRootComponentModel,
  getAgentTuiSelectedContentMetrics,
} from "./layout.js";
import type { AgentSessionEventObserver } from "./session-events.js";
import {
  createAgentTuiStore,
  type AgentTuiSnapshot,
  type AgentTuiStore,
  type AgentTuiStoreOptions,
} from "./store.js";
import { hasStreamingReasoningBlocks } from "./transcript.js";

const APP_ROOT_ID = "tui-root";
const DEFAULT_LIVE_RECENT_TERMINAL_WORKER_LIMIT = 2;
const REASONING_SPINNER_INTERVAL_MS = 120;

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
  stickToBottom: boolean;
};

type AgentTuiAppProps = {
  animationFrame?: number;
  onExitRequest: () => void | Promise<void>;
  selectedColumnId?: string;
  selectedScrollY?: number;
  snapshot: AgentTuiSnapshot;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isNextColumnKey(key: { name: string }) {
  return key.name === "right";
}

function isPreviousColumnKey(key: { name: string }) {
  return key.name === "left";
}

function isQuitKey(key: { ctrl?: boolean; name: string }) {
  return (key.ctrl && key.name === "c") || key.name === "escape" || key.name === "q";
}

function AgentTuiApp({
  animationFrame = 0,
  selectedColumnId,
  selectedScrollY = 0,
  snapshot,
}: AgentTuiAppProps) {
  const { height, width } = useTerminalDimensions();
  const snapshotColumns = snapshot.columns ?? snapshot.sessions ?? [];
  const resolvedSelectedColumnId = snapshotColumns.find(
    (column) => column.session.id === selectedColumnId,
  )
    ? selectedColumnId
    : snapshotColumns[0]?.session.id;
  const frameSize = useMemo(
    () => ({
      columns: Math.max(
        1,
        width - 2 - Math.max(0, snapshotColumns.length - 1) - snapshotColumns.length * 2,
      ),
      rows: Math.max(1, height - 4),
    }),
    [height, snapshotColumns.length, width],
  );

  const panels = useMemo(
    () =>
      buildAgentTuiRenderedPanels(snapshot, frameSize, {
        animationFrame,
        selectedColumnId: resolvedSelectedColumnId,
        selectedScrollY,
      }),
    [animationFrame, frameSize, resolvedSelectedColumnId, selectedScrollY, snapshot],
  );
  const layout = useMemo(
    () =>
      buildAgentTuiRootComponentModel(snapshot, {
        animationFrame,
        selectedColumnId: resolvedSelectedColumnId,
        selectedScrollY,
      }),
    [animationFrame, resolvedSelectedColumnId, selectedScrollY, snapshot],
  );

  return (
    <box flexDirection="column" height="100%" id={APP_ROOT_ID} width="100%">
      {layout.summaryLines.length ? (
        <box flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text content={layout.summaryLines.join("\n")} />
        </box>
      ) : null}
      <box flexDirection="row" flexGrow={1} gap={1} paddingLeft={1} paddingRight={1} width="100%">
        {panels.map((panel) => (
          <box
            border
            borderColor={panel.isSelected ? "white" : "gray"}
            flexDirection="column"
            height="100%"
            key={panel.id}
            title={panel.title}
            width={panel.width}
            padding={1}
          >
            <text content={panel.body} wrapMode="none" />
          </box>
        ))}
      </box>
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
      maxRetainedTerminalWorkers:
        options.maxRetainedTerminalWorkers ?? DEFAULT_LIVE_RECENT_TERMINAL_WORKER_LIMIT,
      removeFinalizedSessions: options.removeFinalizedSessions ?? true,
      retainTerminalSessions: options.retainTerminalSessions ?? true,
    });
  let active = false;
  let renderScheduled = false;
  let renderer = options.renderer;
  let root: Root | undefined;
  let reasoningSpinnerInterval: ReturnType<typeof setInterval> | undefined;
  let selectedColumnId: string | undefined;
  let startPromise: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined;
  const scrollStateByColumnId = new Map<string, AgentTuiColumnScrollState>();

  const ownsRenderer = !options.renderer;

  const getFrameSize = () => {
    const columnCount = Math.max(
      1,
      (store.getSnapshot().columns ?? store.getSnapshot().sessions ?? []).length,
    );
    return {
      columns: Math.max(
        1,
        (renderer?.width ?? 1) - 2 - Math.max(0, columnCount - 1) - columnCount * 2,
      ),
      rows: Math.max(1, (renderer?.height ?? 4) - 4),
    };
  };

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

  const scrollSelectedContent = (delta: number) => {
    if (!selectedColumnId) {
      return;
    }
    const metrics = getAgentTuiSelectedContentMetrics(store.getSnapshot(), getFrameSize(), {
      selectedColumnId,
    });
    const currentState = scrollStateByColumnId.get(selectedColumnId);
    const current = currentState?.stickToBottom
      ? metrics.maxScrollY
      : (currentState?.scrollY ?? metrics.maxScrollY);
    const next = clamp(current + delta, 0, metrics.maxScrollY);
    scrollStateByColumnId.set(selectedColumnId, {
      scrollY: next,
      stickToBottom: next >= metrics.maxScrollY,
    });
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
    if (key.name === "down") {
      key.preventDefault();
      scrollSelectedContent(1);
      return;
    }
    if (key.name === "up") {
      key.preventDefault();
      scrollSelectedContent(-1);
      return;
    }
  };

  const clearReasoningSpinnerInterval = () => {
    if (reasoningSpinnerInterval) {
      clearInterval(reasoningSpinnerInterval);
      reasoningSpinnerInterval = undefined;
    }
  };

  const syncReasoningSpinnerInterval = (snapshot: AgentTuiSnapshot) => {
    const columns = snapshot.columns ?? snapshot.sessions ?? [];
    const hasStreamingReasoning = columns.some((column) =>
      hasStreamingReasoningBlocks(column.blocks ?? []),
    );
    if (!active || !hasStreamingReasoning) {
      clearReasoningSpinnerInterval();
      return;
    }
    if (!reasoningSpinnerInterval) {
      reasoningSpinnerInterval = setInterval(() => {
        scheduleRender();
      }, REASONING_SPINNER_INTERVAL_MS);
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
    const selectedScrollY = selectedColumnId
      ? (() => {
          const metrics = getAgentTuiSelectedContentMetrics(snapshot, getFrameSize(), {
            selectedColumnId,
          });
          const state = scrollStateByColumnId.get(selectedColumnId);
          if (!state || state.stickToBottom) {
            return metrics.maxScrollY;
          }
          return clamp(state.scrollY, 0, metrics.maxScrollY);
        })()
      : 0;
    flushSync(() => {
      currentRoot.render(
        <AgentTuiApp
          animationFrame={Math.floor(Date.now() / REASONING_SPINNER_INTERVAL_MS)}
          onExitRequest={onExitRequest}
          selectedColumnId={selectedColumnId}
          selectedScrollY={selectedScrollY}
          snapshot={snapshot}
        />,
      );
    });
    syncReasoningSpinnerInterval(snapshot);
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
      clearReasoningSpinnerInterval();

      if (renderer && ownsRenderer) {
        renderer.destroy();
        renderer = undefined;
      }
    },
  };
}
