import type {
  CommitQueueScopeResult,
  ProjectBranchScopeQuery,
  ProjectBranchScopeResult,
  WorkflowProjectionIndex,
} from "../graph/modules/ops/workflow/query.js";
import {
  createDefaultWorkflowTuiStartupContract,
  type WorkflowTuiBranchResolution,
  type WorkflowTuiProjectResolution,
  type WorkflowTuiStartupContract,
} from "./startup.js";

export interface WorkflowTuiPanelModel {
  id: string;
  lines: readonly string[];
  title: string;
}

export interface WorkflowTuiStartupSurfaceModel {
  footerLines: readonly string[];
  kind: "startup";
  panels: readonly WorkflowTuiPanelModel[];
  status: "failure" | "loading";
  summaryLines: readonly string[];
}

export const workflowTuiFocusValues = ["branch-board", "branch-detail", "commit-queue"] as const;

export type WorkflowTuiFocus = (typeof workflowTuiFocusValues)[number];

export interface WorkflowTuiWorkflowSurfaceModel {
  readonly branchBoard: ProjectBranchScopeResult;
  readonly commitQueues: readonly CommitQueueScopeResult[];
  readonly focus: WorkflowTuiFocus;
  readonly kind: "workflow";
  readonly selectedBranchId?: string;
  readonly selectedCommitId?: string;
}

export type WorkflowTuiSurfaceModel =
  | WorkflowTuiStartupSurfaceModel
  | WorkflowTuiWorkflowSurfaceModel;

export interface WorkflowTuiStartupModelOptions {
  contract?: WorkflowTuiStartupContract;
  entrypointPath: string;
  legacyCommand?: string;
  workspaceRoot: string;
}

export interface WorkflowTuiStartupFailureModelOptions extends WorkflowTuiStartupModelOptions {
  error: unknown;
}

export interface WorkflowTuiWorkflowModelOptions {
  readonly branchBoard: ProjectBranchScopeResult;
  readonly commitQueues: readonly CommitQueueScopeResult[];
  readonly focus?: WorkflowTuiFocus;
  readonly selectedBranchId?: string;
  readonly selectedCommitId?: string;
}

export interface WorkflowTuiProjectionModelOptions {
  readonly commitQueueLimit?: number;
  readonly focus?: WorkflowTuiFocus;
  readonly projectBranchQuery?: Omit<ProjectBranchScopeQuery, "projectId">;
  readonly projectId: string;
  readonly projection: WorkflowProjectionIndex;
  readonly selectedBranchId?: string;
  readonly selectedCommitId?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isWorkflowFocus(value: string): value is WorkflowTuiFocus {
  return workflowTuiFocusValues.includes(value as WorkflowTuiFocus);
}

function getBranchIds(branchBoard: ProjectBranchScopeResult) {
  return branchBoard.rows.map((row) => row.workflowBranch.id);
}

function getCommitQueueForBranch(
  commitQueues: readonly CommitQueueScopeResult[],
  branchId: string | undefined,
) {
  if (!branchId) {
    return undefined;
  }
  return commitQueues.find((commitQueue) => commitQueue.branch.workflowBranch.id === branchId);
}

function dedupeCommitQueues(
  branchBoard: ProjectBranchScopeResult,
  commitQueues: readonly CommitQueueScopeResult[],
) {
  const branchIds = new Set(getBranchIds(branchBoard));
  const seenBranchIds = new Set<string>();

  return commitQueues.filter((commitQueue) => {
    const branchId = commitQueue.branch.workflowBranch.id;
    if (!branchIds.has(branchId) || seenBranchIds.has(branchId)) {
      return false;
    }
    seenBranchIds.add(branchId);
    return true;
  });
}

function resolveSelectedBranchId(
  branchBoard: ProjectBranchScopeResult,
  selectedBranchId: string | undefined,
) {
  const branchIds = getBranchIds(branchBoard);
  if (selectedBranchId && branchIds.includes(selectedBranchId)) {
    return selectedBranchId;
  }
  return branchIds[0];
}

function resolveSelectedCommitId(
  commitQueue: CommitQueueScopeResult | undefined,
  selectedCommitId: string | undefined,
) {
  if (!commitQueue) {
    return undefined;
  }

  const commitIds = commitQueue.rows.map((row) => row.workflowCommit.id);
  if (selectedCommitId && commitIds.includes(selectedCommitId)) {
    return selectedCommitId;
  }

  const activeCommitId =
    commitQueue.branch.activeCommit?.workflowCommit.id ??
    commitQueue.branch.workflowBranch.activeCommitId;
  if (activeCommitId && commitIds.includes(activeCommitId)) {
    return activeCommitId;
  }

  return commitIds[0];
}

function moveSelection(currentId: string | undefined, ids: readonly string[], delta: number) {
  if (!ids.length) {
    return undefined;
  }

  const currentIndex = currentId ? ids.indexOf(currentId) : -1;
  if (currentIndex < 0) {
    return ids[delta >= 0 ? 0 : ids.length - 1];
  }

  return ids[clamp(currentIndex + delta, 0, ids.length - 1)];
}

function formatWorkflowTuiGraphScope(contract: WorkflowTuiStartupContract) {
  const scope = contract.graph.requestedScope;
  return `${scope.moduleId} / ${scope.scopeId}`;
}

function formatWorkflowTuiProjectResolution(resolution: WorkflowTuiProjectResolution) {
  return resolution.kind === "configured"
    ? `${resolution.projectId} (configured)`
    : "infer the one visible WorkflowProject in the synced workflow scope";
}

function formatWorkflowTuiBranchResolution(resolution: WorkflowTuiBranchResolution) {
  return resolution.kind === "configured"
    ? `${resolution.branchId} (configured)`
    : "select the first branch-board row in the resolved project";
}

function formatWorkflowTuiStartupError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildWorkflowTuiStartupModel(
  options: WorkflowTuiStartupModelOptions,
  status: WorkflowTuiStartupSurfaceModel["status"],
  error?: unknown,
): WorkflowTuiStartupSurfaceModel {
  const legacyCommand = options.legacyCommand ?? "io agent tui";
  const contract =
    options.contract ??
    createDefaultWorkflowTuiStartupContract({
      entrypointPath: options.entrypointPath,
      workspaceRoot: options.workspaceRoot,
    });
  const loading = status === "loading";
  const errorMessage = error === undefined ? undefined : formatWorkflowTuiStartupError(error);

  return {
    footerLines: [
      "Keys: q, esc, ctrl-c exit",
      loading
        ? "Status: loading the first branch board and commit queues from the synced workflow graph."
        : "Status: startup failed. Review the error below, then quit or rerun io tui.",
      `Legacy session monitor: ${legacyCommand}`,
    ],
    kind: "startup",
    panels: [
      {
        id: "surface",
        lines: [
          loading
            ? "Workflow shell startup is waiting for the first graph-backed workflow surface."
            : "Workflow shell startup could not hydrate the first graph-backed workflow surface.",
          `Entrypoint: ${contract.entrypointPath}`,
          `Workspace root: ${contract.workspaceRoot}`,
          `Graph source: ${contract.graph.kind} ${contract.graph.url}`,
          `Sync scope: ${formatWorkflowTuiGraphScope(contract)}`,
          loading
            ? "Hydration reads the first project branch board and commit queues from the synced workflow projection."
            : "Hydration stays read-only and does not fall back to legacy bootstrap copy.",
        ],
        title: "Surface",
      },
      {
        id: "startup",
        lines: [
          `Initial project: ${formatWorkflowTuiProjectResolution(contract.initialScope.project)}`,
          `Initial branch: ${formatWorkflowTuiBranchResolution(contract.initialScope.branch)}`,
          loading
            ? "Startup owns graph location and the first branch-board plus commit-queue selection only."
            : "Startup stopped before the read-only branch-board and commit-queue shell became available.",
        ],
        title: "Startup",
      },
      {
        id: loading ? "boundaries" : "failure",
        lines: loading
          ? [
              "src/tui owns terminal workflow UX and product-shell composition.",
              "src/graph/adapters/react-opentui remains the shared graph/OpenTUI adapter landing root.",
              "The first contract does not launch sessions, reconcile git, or perform workflow writes.",
              "src/agent/tui stays in place as the legacy retained session monitor during migration.",
            ]
          : [
              `Error: ${errorMessage ?? "Unknown startup failure."}`,
              "The rendered shell remains read-only; startup does not attempt workflow writes or session launch.",
              "Startup failure is presented in the TUI instead of falling back to static bootstrap copy.",
              "Use the legacy session monitor only for retained agent output, not workflow hydration.",
            ],
        title: loading ? "Boundaries" : "Failure",
      },
    ],
    status,
    summaryLines: [
      "IO Workflow TUI",
      loading
        ? "Loading the graph-backed workflow shell."
        : "Unable to load the graph-backed workflow shell.",
    ],
  };
}

export function createWorkflowTuiStartupLoadingModel(
  options: WorkflowTuiStartupModelOptions,
): WorkflowTuiStartupSurfaceModel {
  return buildWorkflowTuiStartupModel(options, "loading");
}

export function createWorkflowTuiStartupFailureModel(
  options: WorkflowTuiStartupFailureModelOptions,
): WorkflowTuiStartupSurfaceModel {
  return buildWorkflowTuiStartupModel(options, "failure", options.error);
}

export function createWorkflowTuiWorkflowModel(
  options: WorkflowTuiWorkflowModelOptions,
): WorkflowTuiWorkflowSurfaceModel {
  return normalizeWorkflowTuiSurfaceModel({
    kind: "workflow",
    branchBoard: options.branchBoard,
    commitQueues: options.commitQueues,
    focus: options.focus ?? "branch-board",
    ...(options.selectedBranchId ? { selectedBranchId: options.selectedBranchId } : {}),
    ...(options.selectedCommitId ? { selectedCommitId: options.selectedCommitId } : {}),
  }) as WorkflowTuiWorkflowSurfaceModel;
}

export function createWorkflowTuiWorkflowModelFromProjection(
  options: WorkflowTuiProjectionModelOptions,
): WorkflowTuiWorkflowSurfaceModel {
  const branchBoard = options.projection.readProjectBranchScope({
    projectId: options.projectId,
    ...options.projectBranchQuery,
    filter: {
      showUnmanagedRepositoryBranches: true,
      ...options.projectBranchQuery?.filter,
    },
  });
  const commitQueues = branchBoard.rows.map((row) =>
    options.projection.readCommitQueueScope({
      branchId: row.workflowBranch.id,
      ...(options.commitQueueLimit ? { limit: options.commitQueueLimit } : {}),
    }),
  );

  return createWorkflowTuiWorkflowModel({
    branchBoard,
    commitQueues,
    focus: options.focus,
    selectedBranchId: options.selectedBranchId,
    selectedCommitId: options.selectedCommitId,
  });
}

export function normalizeWorkflowTuiSurfaceModel(
  model: WorkflowTuiSurfaceModel,
): WorkflowTuiSurfaceModel {
  if (model.kind !== "workflow") {
    return model;
  }

  const commitQueues = dedupeCommitQueues(model.branchBoard, model.commitQueues);
  const selectedBranchId = resolveSelectedBranchId(model.branchBoard, model.selectedBranchId);
  const selectedCommitId = resolveSelectedCommitId(
    getCommitQueueForBranch(commitQueues, selectedBranchId),
    model.selectedCommitId,
  );

  return {
    kind: "workflow",
    branchBoard: model.branchBoard,
    commitQueues,
    focus: isWorkflowFocus(model.focus) ? model.focus : "branch-board",
    ...(selectedBranchId ? { selectedBranchId } : {}),
    ...(selectedCommitId ? { selectedCommitId } : {}),
  };
}

export function moveWorkflowTuiFocus(
  model: WorkflowTuiSurfaceModel,
  delta: number,
): WorkflowTuiSurfaceModel {
  if (model.kind !== "workflow" || delta === 0) {
    return model;
  }

  const currentIndex = workflowTuiFocusValues.indexOf(model.focus);
  const nextIndex =
    currentIndex >= 0
      ? (currentIndex + delta + workflowTuiFocusValues.length) % workflowTuiFocusValues.length
      : 0;

  return normalizeWorkflowTuiSurfaceModel({
    ...model,
    focus: workflowTuiFocusValues[nextIndex] ?? workflowTuiFocusValues[0],
  });
}

export function moveWorkflowTuiSelection(
  model: WorkflowTuiSurfaceModel,
  delta: number,
): WorkflowTuiSurfaceModel {
  if (model.kind !== "workflow" || delta === 0) {
    return model;
  }

  if (model.focus === "commit-queue") {
    const selectedQueue = getCommitQueueForBranch(model.commitQueues, model.selectedBranchId);
    const nextCommitId = moveSelection(
      model.selectedCommitId,
      selectedQueue?.rows.map((row) => row.workflowCommit.id) ?? [],
      delta,
    );
    if (!nextCommitId || nextCommitId === model.selectedCommitId) {
      return model;
    }

    return normalizeWorkflowTuiSurfaceModel({
      ...model,
      selectedCommitId: nextCommitId,
    });
  }

  const nextBranchId = moveSelection(
    model.selectedBranchId,
    getBranchIds(model.branchBoard),
    delta,
  );
  if (!nextBranchId || nextBranchId === model.selectedBranchId) {
    return model;
  }

  return normalizeWorkflowTuiSurfaceModel({
    ...model,
    selectedBranchId: nextBranchId,
    selectedCommitId: undefined,
  });
}
