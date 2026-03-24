/** @jsxImportSource @opentui/react */

import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, flushSync, useTerminalDimensions, type Root } from "@opentui/react";
import { useMemo } from "react";

import { buildWorkflowTuiRootComponentModel } from "./layout.js";
import {
  createWorkflowTuiBootstrapModel,
  moveWorkflowTuiFocus,
  moveWorkflowTuiSelection,
  normalizeWorkflowTuiSurfaceModel,
  type WorkflowTuiBootstrapModelOptions,
  type WorkflowTuiSurfaceModel,
} from "./model.js";

const APP_ROOT_ID = "workflow-tui-root";
const WIDE_LAYOUT_MIN_COLUMNS = 132;

export type WorkflowTuiTerminal = NodeJS.WriteStream;

export interface WorkflowTuiOptions {
  bootstrap?: WorkflowTuiBootstrapModelOptions;
  input?: NodeJS.ReadStream;
  onExitRequest?: () => void | Promise<void>;
  output?: WorkflowTuiTerminal;
  renderer?: CliRenderer;
  requireTty?: boolean;
  surfaceModel?: WorkflowTuiSurfaceModel;
}

export interface WorkflowTui {
  getSurfaceModel(): WorkflowTuiSurfaceModel;
  setSurfaceModel(model: WorkflowTuiSurfaceModel): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type WorkflowTuiAppProps = {
  model: WorkflowTuiSurfaceModel;
};

function isQuitKey(key: { ctrl?: boolean; name: string }) {
  return (key.ctrl && key.name === "c") || key.name === "escape" || key.name === "q";
}

function isNextFocusKey(key: { name: string; shift?: boolean }) {
  return key.name === "right" || (key.name === "tab" && !key.shift);
}

function isPreviousFocusKey(key: { name: string; shift?: boolean }) {
  return key.name === "left" || (key.name === "tab" && Boolean(key.shift));
}

function WorkflowTuiApp({ model }: WorkflowTuiAppProps) {
  const { width } = useTerminalDimensions();
  const layout = useMemo(() => buildWorkflowTuiRootComponentModel(model), [model]);
  const panelWidth = Math.max(
    24,
    Math.floor(
      (width - 2 - Math.max(0, layout.panels.length - 1) - layout.panels.length * 2) /
        Math.max(1, layout.panels.length),
    ),
  );
  const wide = width >= WIDE_LAYOUT_MIN_COLUMNS;

  return (
    <box flexDirection="column" height="100%" id={APP_ROOT_ID} width="100%">
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <text content={layout.summaryLines.join("\n")} />
      </box>
      <box
        flexDirection={wide ? "row" : "column"}
        flexGrow={1}
        gap={1}
        paddingLeft={1}
        paddingRight={1}
        width="100%"
      >
        {layout.panels.map((panel) => (
          <box
            border
            borderColor="white"
            flexDirection="column"
            flexGrow={wide ? 0 : 1}
            key={panel.id}
            padding={1}
            title={panel.title}
            width={wide ? panelWidth : "100%"}
          >
            <text content={panel.body} />
          </box>
        ))}
      </box>
      <box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <text content={layout.footerLines.join("\n")} />
      </box>
    </box>
  );
}

export function createWorkflowTui(options: WorkflowTuiOptions): WorkflowTui;
export function createWorkflowTui(options?: WorkflowTuiOptions): WorkflowTui {
  const input = options?.input ?? process.stdin;
  const onExitRequest =
    options?.onExitRequest ??
    (() => {
      process.kill(process.pid, "SIGINT");
    });
  const output = options?.output ?? process.stdout;
  const requireTty = options?.requireTty ?? true;
  let surfaceModel =
    options?.surfaceModel ??
    createWorkflowTuiBootstrapModel(
      options?.bootstrap ?? {
        entrypointPath: process.cwd(),
        workspaceRoot: process.cwd(),
      },
    );
  surfaceModel = normalizeWorkflowTuiSurfaceModel(surfaceModel);
  let active = false;
  let renderScheduled = false;
  let renderer = options?.renderer;
  let root: Root | undefined;
  let startPromise: Promise<void> | undefined;

  const ownsRenderer = !options?.renderer;

  const render = () => {
    renderScheduled = false;
    if (!active || !renderer || !root) {
      return;
    }
    const currentRoot = root;
    flushSync(() => {
      currentRoot.render(<WorkflowTuiApp model={surfaceModel} />);
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

  const handleKeyPress = (key: {
    ctrl?: boolean;
    name: string;
    preventDefault: () => void;
    shift?: boolean;
  }) => {
    if (!isQuitKey(key)) {
      if (isNextFocusKey(key)) {
        key.preventDefault();
        const nextModel = moveWorkflowTuiFocus(surfaceModel, 1);
        if (nextModel !== surfaceModel) {
          surfaceModel = nextModel;
          scheduleRender();
        }
        return;
      }
      if (isPreviousFocusKey(key)) {
        key.preventDefault();
        const nextModel = moveWorkflowTuiFocus(surfaceModel, -1);
        if (nextModel !== surfaceModel) {
          surfaceModel = nextModel;
          scheduleRender();
        }
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        const nextModel = moveWorkflowTuiSelection(surfaceModel, 1);
        if (nextModel !== surfaceModel) {
          surfaceModel = nextModel;
          scheduleRender();
        }
        return;
      }
      if (key.name === "up") {
        key.preventDefault();
        const nextModel = moveWorkflowTuiSelection(surfaceModel, -1);
        if (nextModel !== surfaceModel) {
          surfaceModel = nextModel;
          scheduleRender();
        }
        return;
      }
      return;
    }
    key.preventDefault();
    void onExitRequest();
  };

  const ensureStarted = async () => {
    if (startPromise) {
      await startPromise;
      return;
    }

    startPromise = (async () => {
      if (!renderer) {
        if (requireTty && !output.isTTY) {
          throw new Error("io tui requires a TTY");
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
    getSurfaceModel() {
      return surfaceModel;
    },
    setSurfaceModel(model) {
      surfaceModel = normalizeWorkflowTuiSurfaceModel(model);
      scheduleRender();
    },
    async start() {
      if (active) {
        await ensureStarted();
        return;
      }
      active = true;
      try {
        await ensureStarted();
      } catch (error) {
        active = false;
        throw error;
      }
    },
    async stop() {
      if (!active && !startPromise) {
        return;
      }
      active = false;
      renderScheduled = false;

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
