import type {
  CommitQueueScopeResult,
  ProjectBranchScopeQuery,
  ProjectBranchScopeResult,
  WorkflowProjectionIndex,
} from "../graph/modules/ops/workflow/query.js";

export interface WorkflowTuiPanelModel {
  id: string;
  lines: readonly string[];
  title: string;
}

export interface WorkflowTuiBootstrapSurfaceModel {
  kind: "bootstrap";
  footerLines: readonly string[];
  panels: readonly WorkflowTuiPanelModel[];
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
  | WorkflowTuiBootstrapSurfaceModel
  | WorkflowTuiWorkflowSurfaceModel;

export interface WorkflowTuiBootstrapModelOptions {
  entrypointPath: string;
  legacyCommand?: string;
  workspaceRoot: string;
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

export function createWorkflowTuiBootstrapModel(
  options: WorkflowTuiBootstrapModelOptions,
): WorkflowTuiBootstrapSurfaceModel {
  const legacyCommand = options.legacyCommand ?? "io agent tui";

  return {
    kind: "bootstrap",
    footerLines: ["Keys: q, esc, ctrl-c exit", `Legacy session monitor: ${legacyCommand}`],
    panels: [
      {
        id: "surface",
        lines: [
          "Workflow shell bootstrap for the graph-backed terminal product surface.",
          `Entrypoint: ${options.entrypointPath}`,
          `Workspace root: ${options.workspaceRoot}`,
          "Status: CLI startup still falls back to bootstrap copy until runtime graph wiring is available.",
        ],
        title: "Surface",
      },
      {
        id: "boundaries",
        lines: [
          "src/tui owns terminal workflow UX and product-shell composition.",
          "src/graph/adapters/react-opentui remains the shared graph/OpenTUI adapter landing root.",
          "src/agent/tui stays in place as the legacy retained session monitor during migration.",
        ],
        title: "Boundaries",
      },
      {
        id: "next",
        lines: [
          "Bind workflow-owned project branch and commit-queue graph scopes.",
          "Keep reusable OpenTUI runtime bindings behind react-opentui.",
          "Launch planning and execution sessions from selected workflow subjects.",
        ],
        title: "Next",
      },
    ],
    summaryLines: [
      "IO Workflow TUI",
      "Bootstrap shell for the graph-backed terminal product surface.",
    ],
  };
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
