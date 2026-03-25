/** @jsxImportSource @opentui/react */

import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, flushSync, useTerminalDimensions, type Root } from "@opentui/react";
import { useMemo } from "react";

import { buildWorkflowTuiRootComponentModel } from "./layout.js";
import {
  createWorkflowTuiStartupFailureModel,
  createWorkflowTuiStartupLoadingModel,
  getWorkflowTuiActionRequestState,
  getSelectedWorkflowTuiAction,
  moveWorkflowTuiActionSelection,
  moveWorkflowTuiFocus,
  moveWorkflowTuiSelection,
  normalizeWorkflowTuiSurfaceModel,
  setWorkflowTuiActionRequestState,
  toggleWorkflowTuiActionSurface,
  type WorkflowTuiActionModel,
  type WorkflowTuiStartupModelOptions,
  type WorkflowTuiSurfaceModel,
  type WorkflowTuiWorkflowSurfaceModel,
} from "./model.js";

const APP_ROOT_ID = "workflow-tui-root";
const WIDE_LAYOUT_MIN_COLUMNS = 132;

export type WorkflowTuiTerminal = NodeJS.WriteStream;

export interface WorkflowTuiOptions {
  input?: NodeJS.ReadStream;
  onAction?: (action: WorkflowTuiActionModel) => void | Promise<void>;
  onExitRequest?: () => void | Promise<void>;
  output?: WorkflowTuiTerminal;
  renderer?: CliRenderer;
  requireTty?: boolean;
  surfaceModel?: WorkflowTuiSurfaceModel;
  startup?: WorkflowTuiStartupOptions;
}

export interface WorkflowTuiStartupOptions extends WorkflowTuiStartupModelOptions {
  hydrate?: () => Promise<WorkflowTuiWorkflowSurfaceModel>;
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

function isOpenActionKey(key: { name: string }) {
  return key.name === "a";
}

function isNextActionKey(key: { name: string }) {
  return key.name === "n";
}

function isPreviousActionKey(key: { name: string }) {
  return key.name === "p";
}

function formatActionSubjectLabel(model: WorkflowTuiSurfaceModel, action: WorkflowTuiActionModel) {
  if (model.kind !== "workflow") {
    return action.subject.commitId ?? action.subject.branchId;
  }

  if (action.subject.kind === "commit") {
    const commitQueue = model.commitQueues.find(
      (queue) => queue.branch.workflowBranch.id === action.subject.branchId,
    );
    const commitRow = commitQueue?.rows.find(
      (row) => row.workflowCommit.id === action.subject.commitId,
    );
    return (
      commitRow?.workflowCommit.commitKey ?? action.subject.commitId ?? action.subject.branchId
    );
  }

  const branchRow = model.branchBoard.rows.find(
    (row) => row.workflowBranch.id === action.subject.branchId,
  );
  return branchRow?.workflowBranch.branchKey ?? action.subject.branchId;
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
  const onAction = options?.onAction;
  const onExitRequest =
    options?.onExitRequest ??
    (() => {
      process.kill(process.pid, "SIGINT");
    });
  const output = options?.output ?? process.stdout;
  const requireTty = options?.requireTty ?? true;
  const startup =
    options?.startup ??
    ({
      entrypointPath: process.cwd(),
      workspaceRoot: process.cwd(),
    } satisfies WorkflowTuiStartupOptions);
  let surfaceModel = options?.surfaceModel ?? createWorkflowTuiStartupLoadingModel(startup);
  surfaceModel = normalizeWorkflowTuiSurfaceModel(surfaceModel);
  let active = false;
  let renderScheduled = false;
  let renderer = options?.renderer;
  let root: Root | undefined;
  let startPromise: Promise<void> | undefined;
  let startupHydrationPromise: Promise<void> | undefined;
  let startupHydrated = surfaceModel.kind === "workflow" || !startup.hydrate;

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

  const hydrateStartup = async () => {
    if (options?.surfaceModel || !startup.hydrate || startupHydrated) {
      return;
    }
    if (startupHydrationPromise) {
      await startupHydrationPromise;
      return;
    }
    const hydrate = startup.hydrate;

    surfaceModel = createWorkflowTuiStartupLoadingModel(startup);
    scheduleRender();
    startupHydrationPromise = (async () => {
      try {
        const hydratedModel = await hydrate();
        startupHydrated = true;
        surfaceModel = normalizeWorkflowTuiSurfaceModel(hydratedModel);
      } catch (error) {
        startupHydrated = false;
        surfaceModel = createWorkflowTuiStartupFailureModel({
          ...startup,
          error,
        });
      } finally {
        scheduleRender();
        startupHydrationPromise = undefined;
      }
    })();

    await startupHydrationPromise;
  };

  const handleKeyPress = (key: {
    ctrl?: boolean;
    name: string;
    preventDefault: () => void;
    shift?: boolean;
  }) => {
    if (!isQuitKey(key)) {
      if (isOpenActionKey(key)) {
        key.preventDefault();
        surfaceModel = toggleWorkflowTuiActionSurface(surfaceModel);
        scheduleRender();
        return;
      }
      if (isNextActionKey(key)) {
        key.preventDefault();
        const nextModel = moveWorkflowTuiActionSelection(surfaceModel, 1);
        if (nextModel !== surfaceModel) {
          surfaceModel = nextModel;
          scheduleRender();
        }
        return;
      }
      if (isPreviousActionKey(key)) {
        key.preventDefault();
        const nextModel = moveWorkflowTuiActionSelection(surfaceModel, -1);
        if (nextModel !== surfaceModel) {
          surfaceModel = nextModel;
          scheduleRender();
        }
        return;
      }
      if (key.name === "return") {
        key.preventDefault();
        const action = getSelectedWorkflowTuiAction(surfaceModel);
        if (!action) {
          return;
        }

        const subjectKey = formatActionSubjectLabel(surfaceModel, action);
        const actionState =
          surfaceModel.kind === "workflow"
            ? getWorkflowTuiActionRequestState(surfaceModel, action)
            : undefined;

        if (actionState?.status === "pending") {
          return;
        }

        if (action.availability !== "available") {
          scheduleRender();
          return;
        }

        surfaceModel = setWorkflowTuiActionRequestState(surfaceModel, {
          actionId: action.id,
          message: `Requested ${action.label.toLowerCase()} for ${subjectKey}.`,
          status: "pending",
          subject: action.subject,
        });
        scheduleRender();

        if (onAction) {
          void Promise.resolve(onAction(action))
            .then(() => {
              surfaceModel = setWorkflowTuiActionRequestState(surfaceModel, {
                actionId: action.id,
                message: `${action.label} completed for ${subjectKey}.`,
                status: "success",
                subject: action.subject,
              });
              scheduleRender();
            })
            .catch((error) => {
              surfaceModel = setWorkflowTuiActionRequestState(surfaceModel, {
                actionId: action.id,
                message: error instanceof Error ? error.message : String(error),
                status: "failure",
                subject: action.subject,
              });
              scheduleRender();
            });
          return;
        }

        surfaceModel = setWorkflowTuiActionRequestState(surfaceModel, {
          actionId: action.id,
          message: `${action.label} completed for ${subjectKey}.`,
          status: "success",
          subject: action.subject,
        });
        scheduleRender();
        return;
      }
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
      await hydrateStartup();
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
      startupHydrated = surfaceModel.kind === "workflow" || !startup.hydrate;
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
