import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
} from "@opentui/core";

import {
  buildAgentTuiRootComponentModel,
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
const APP_COLUMNS_ID = "agent-tui-columns";
const APP_HEADER_ID = "agent-tui-header";

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

type AgentTuiColumnRenderRef = {
  transcript: TextRenderable;
};

type AgentTuiColumnScrollState = {
  scrollY: number;
  stickToBottom: boolean;
};

type AgentTuiRenderableView = {
  destroy: () => void;
  render: (snapshot: AgentTuiSnapshot) => void;
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

function createColumnRenderable(
  renderer: CliRenderer,
  model: ReturnType<typeof buildAgentTuiRootComponentModel>["columns"][number],
  scrollState: AgentTuiColumnScrollState | undefined,
) {
  const box = new BoxRenderable(renderer, {
    backgroundColor: model.isSelected ? "#111827" : "#0f172a",
    border: true,
    borderColor: model.isSelected ? "#f59e0b" : "#475569",
    borderStyle: "single",
    flexBasis: 0,
    flexDirection: "column",
    flexGrow: 1,
    focusedBorderColor: "#f59e0b",
    height: "100%",
    id: `column:${model.id}`,
    minWidth: 24,
    paddingX: 1,
    title: model.title,
  });

  box.add(
    new TextRenderable(renderer, {
      content: [
        model.badgeLine,
        model.metaLine,
        model.statusLine,
        model.parentLine,
        model.childrenLine,
        model.latestEventLine,
      ].join("\n"),
      id: `summary:${model.id}`,
      wrapMode: "char",
    }),
  );

  box.add(
    new TextRenderable(renderer, {
      content: "Transcript",
      id: `transcript-label:${model.id}`,
      marginTop: 1,
      wrapMode: "char",
    }),
  );

  const transcript = new TextRenderable(renderer, {
    content: model.transcript,
    flexGrow: 1,
    id: `transcript:${model.id}`,
    marginTop: 1,
    wrapMode: "char",
  });
  let appliedInitialScroll = false;
  const applyScrollState = () => {
    if (appliedInitialScroll) {
      return;
    }
    appliedInitialScroll = true;
    const nextScrollY =
      scrollState?.stickToBottom === false
        ? clamp(scrollState.scrollY, 0, transcript.maxScrollY)
        : transcript.maxScrollY;
    transcript.scrollY = nextScrollY;
    renderer.requestRender();
  };
  transcript.onSizeChange = applyScrollState;
  box.add(transcript);
  queueMicrotask(applyScrollState);

  return {
    box,
    transcript,
  };
}

function createAgentTuiRenderableView(
  renderer: CliRenderer,
  requestExit: () => void | Promise<void>,
): AgentTuiRenderableView {
  const columnRefs = new Map<string, AgentTuiColumnRenderRef>();
  const scrollStateByColumnId = new Map<string, AgentTuiColumnScrollState>();
  let latestSnapshot: AgentTuiSnapshot = { columns: [], sessions: [] };
  let selectedColumnId: string | undefined;
  let viewMode: AgentTuiViewMode = "status";

  const removeRoot = () => {
    if (!renderer.root.findDescendantById(APP_ROOT_ID)) {
      return;
    }
    renderer.root.remove(APP_ROOT_ID);
  };

  const saveScrollState = () => {
    for (const [columnId, ref] of columnRefs) {
      scrollStateByColumnId.set(columnId, {
        scrollY: ref.transcript.scrollY,
        stickToBottom: ref.transcript.scrollY >= ref.transcript.maxScrollY - 1,
      });
    }
    columnRefs.clear();
  };

  const selectColumn = (nextColumnId: string | undefined) => {
    if (!nextColumnId || nextColumnId === selectedColumnId) {
      return;
    }
    selectedColumnId = nextColumnId;
    renderCurrentSnapshot();
  };

  const moveColumnSelection = (delta: number) => {
    const columns = latestSnapshot.columns ?? latestSnapshot.sessions ?? [];
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
    const ref = selectedColumnId ? columnRefs.get(selectedColumnId) : undefined;
    if (!ref) {
      return;
    }
    ref.transcript.scrollY = clamp(ref.transcript.scrollY + delta, 0, ref.transcript.maxScrollY);
    renderer.requestRender();
  };

  const jumpSelectedTranscript = (position: "top" | "bottom") => {
    const ref = selectedColumnId ? columnRefs.get(selectedColumnId) : undefined;
    if (!ref) {
      return;
    }
    ref.transcript.scrollY = position === "top" ? 0 : ref.transcript.maxScrollY;
    renderer.requestRender();
  };

  const toggleViewMode = (nextViewMode?: AgentTuiViewMode) => {
    const resolvedViewMode =
      nextViewMode ?? (viewMode === "status" ? ("raw" as const) : ("status" as const));
    if (resolvedViewMode === viewMode) {
      return;
    }
    viewMode = resolvedViewMode;
    renderCurrentSnapshot();
  };

  const handleKeyPress = (key: {
    ctrl?: boolean;
    name: string;
    preventDefault: () => void;
    shift: boolean;
  }) => {
    if (isQuitKey(key)) {
      key.preventDefault();
      void requestExit();
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

  const buildHeaderText = () => {
    const columns = latestSnapshot.columns ?? latestSnapshot.sessions ?? [];
    const selectedColumn =
      columns.find((column) => column.session.id === selectedColumnId) ?? columns[0];
    const selectedTitle = selectedColumn ? selectedColumn.session.title : "Agent Sessions";
    return [
      `View: ${viewMode.toUpperCase()} | Focus: ${selectedTitle}`,
      "Keys: left/right or h/l move columns | up/down or j/k scroll | 1 status | 2 raw | v toggle | q/esc/Ctrl+C quit",
    ].join("\n");
  };

  const renderCurrentSnapshot = () => {
    saveScrollState();
    removeRoot();

    const layout = buildAgentTuiRootComponentModel(latestSnapshot, {
      selectedColumnId,
      viewMode,
    });
    selectedColumnId = layout.selectedColumnId;

    const root = new BoxRenderable(renderer, {
      backgroundColor: "#020617",
      flexDirection: "column",
      height: "100%",
      id: APP_ROOT_ID,
      paddingX: 1,
      paddingY: 1,
      width: "100%",
    });
    root.add(
      new TextRenderable(renderer, {
        content: buildHeaderText(),
        id: APP_HEADER_ID,
        wrapMode: "char",
      }),
    );

    const columnsRow = new BoxRenderable(renderer, {
      flexDirection: "row",
      flexGrow: 1,
      gap: 1,
      id: APP_COLUMNS_ID,
      marginTop: 1,
      width: "100%",
    });
    for (const column of layout.columns) {
      const renderRef = createColumnRenderable(
        renderer,
        column,
        scrollStateByColumnId.get(column.id),
      );
      columnRefs.set(column.id, {
        transcript: renderRef.transcript,
      });
      columnsRow.add(renderRef.box);
    }

    root.add(columnsRow);
    renderer.root.add(root);
    renderer.requestRender();
  };

  renderer.keyInput.on("keypress", handleKeyPress);

  return {
    destroy() {
      renderer.keyInput.off("keypress", handleKeyPress);
      saveScrollState();
      removeRoot();
      renderer.requestRender();
    },
    render(snapshot) {
      latestSnapshot = snapshot;
      const columns = snapshot.columns ?? snapshot.sessions ?? [];
      if (!columns.find((column) => column.session.id === selectedColumnId)) {
        selectedColumnId = columns[0]?.session.id;
      }
      renderCurrentSnapshot();
    },
  };
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
    });
  let active = false;
  let renderScheduled = false;
  let renderer = options.renderer;
  let startPromise: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined;
  let view: AgentTuiRenderableView | undefined;

  const ownsRenderer = !options.renderer;

  const render = () => {
    renderScheduled = false;
    if (!active || !view) {
      return;
    }
    view.render(store.getSnapshot());
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

      view = createAgentTuiRenderableView(renderer, onExitRequest);
      if (ownsRenderer) {
        renderer.start();
      }
      view.render(store.getSnapshot());
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

      view?.destroy();
      view = undefined;
      startPromise = undefined;

      if (renderer && ownsRenderer) {
        renderer.destroy();
        renderer = undefined;
      }
    },
  };
}
