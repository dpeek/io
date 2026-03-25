import type {
  WorkflowBranchStateValue,
  WorkflowCommitStateValue,
} from "../graph/modules/ops/workflow/command.js";
import type {
  CommitQueueScopeResult,
  CommitQueueScopeSessionSummary,
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

export const workflowTuiActionValues = ["branch-session", "commit-session"] as const;

export type WorkflowTuiAction = (typeof workflowTuiActionValues)[number];

export interface WorkflowTuiBranchSubjectStateModel {
  readonly branchId: string;
  readonly branchState: WorkflowBranchStateValue;
  readonly latestSession?: CommitQueueScopeSessionSummary;
}

export interface WorkflowTuiCommitSubjectStateModel {
  readonly branchId: string;
  readonly branchState: WorkflowBranchStateValue;
  readonly commitId?: string;
  readonly commitState?: WorkflowCommitStateValue;
  readonly hasRunningSession: boolean;
  readonly isActiveCommit: boolean;
  readonly latestSession?: CommitQueueScopeSessionSummary;
}

export interface WorkflowTuiActionModel {
  readonly availability: "available" | "unavailable";
  readonly description: string;
  readonly id: WorkflowTuiAction;
  readonly label: string;
  readonly reason?: string;
  readonly subject: {
    readonly branchId: string;
    readonly commitId?: string;
    readonly kind: "branch" | "commit";
  };
}

export interface WorkflowTuiActionRequestStateModel {
  readonly actionId: WorkflowTuiAction;
  readonly message: string;
  readonly status: "failure" | "pending" | "success";
  readonly subject: WorkflowTuiActionModel["subject"];
}

export interface WorkflowTuiActionSetModel {
  readonly branch: readonly WorkflowTuiActionModel[];
  readonly commit: readonly WorkflowTuiActionModel[];
}

export interface WorkflowTuiActionSurfaceModel {
  readonly open: boolean;
  readonly selectedActionId?: WorkflowTuiAction;
  readonly states?: readonly WorkflowTuiActionRequestStateModel[];
}

export interface WorkflowTuiWorkflowSurfaceModel {
  readonly actions: WorkflowTuiActionSetModel;
  readonly actionSurface: WorkflowTuiActionSurfaceModel;
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

function getSelectedCommitRow(
  commitQueue: CommitQueueScopeResult | undefined,
  selectedCommitId: string | undefined,
) {
  if (!commitQueue) {
    return undefined;
  }

  return commitQueue.rows.find((row) => row.workflowCommit.id === selectedCommitId);
}

function getSelectedBranchSubjectState(
  branchBoard: ProjectBranchScopeResult,
  commitQueue: CommitQueueScopeResult | undefined,
  selectedBranchId: string | undefined,
): WorkflowTuiBranchSubjectStateModel | undefined {
  if (!selectedBranchId) {
    return undefined;
  }

  const selectedBranch = branchBoard.rows.find((row) => row.workflowBranch.id === selectedBranchId);
  if (!selectedBranch) {
    return undefined;
  }

  return {
    branchId: selectedBranchId,
    branchState: selectedBranch.workflowBranch.state,
    latestSession: commitQueue?.branch.latestSession,
  };
}

function getSelectedCommitSubjectState(
  branchState: WorkflowBranchStateValue | undefined,
  commitQueue: CommitQueueScopeResult | undefined,
  selectedCommitId: string | undefined,
): WorkflowTuiCommitSubjectStateModel | undefined {
  if (!commitQueue || !branchState) {
    return undefined;
  }

  const latestSession = commitQueue.branch.latestSession;
  const selectedCommit = getSelectedCommitRow(commitQueue, selectedCommitId);

  return {
    branchId: commitQueue.branch.workflowBranch.id,
    branchState,
    ...(selectedCommitId ? { commitId: selectedCommitId } : {}),
    ...(selectedCommit ? { commitState: selectedCommit.workflowCommit.state } : {}),
    hasRunningSession:
      latestSession?.runtimeState === "running" &&
      latestSession.subject.kind === "commit" &&
      latestSession.subject.commitId === selectedCommitId,
    isActiveCommit:
      selectedCommitId !== undefined &&
      commitQueue.branch.workflowBranch.activeCommitId === selectedCommitId,
    latestSession,
  };
}

function createActionModel(
  action: Omit<WorkflowTuiActionModel, "availability"> & {
    readonly reason?: string;
  },
): WorkflowTuiActionModel {
  return {
    ...action,
    availability: action.reason ? "unavailable" : "available",
  };
}

function buildBranchSessionAction(
  subject: WorkflowTuiBranchSubjectStateModel | undefined,
): WorkflowTuiActionModel {
  if (!subject) {
    return createActionModel({
      description: "Start a branch-scoped planning session from the selected workflow branch.",
      id: "branch-session",
      label: "Launch branch session",
      reason: "Select a workflow branch first.",
      subject: {
        branchId: "",
        kind: "branch",
      },
    });
  }

  const latestSession = subject.latestSession;
  const hasRunningBranchSession =
    latestSession?.runtimeState === "running" && latestSession.subject.kind === "branch";

  let reason: string | undefined;
  if (subject.branchState === "done" || subject.branchState === "archived") {
    reason = "Completed and archived branches do not accept new branch sessions.";
  } else if (latestSession?.runtimeState === "running" && latestSession.subject.kind === "commit") {
    reason = "The selected branch already has a running commit-scoped session.";
  }

  return createActionModel({
    description: hasRunningBranchSession
      ? "Reuse the running branch-scoped session for the selected workflow branch."
      : "Start a branch-scoped planning session from the selected workflow branch.",
    id: "branch-session",
    label: hasRunningBranchSession ? "Attach branch session" : "Launch branch session",
    ...(reason ? { reason } : {}),
    subject: {
      branchId: subject.branchId,
      kind: "branch",
    },
  });
}

function buildCommitSessionAction(
  subject: WorkflowTuiCommitSubjectStateModel | undefined,
): WorkflowTuiActionModel {
  if (!subject) {
    return createActionModel({
      description: "Start a commit-scoped execution session from the selected workflow commit.",
      id: "commit-session",
      label: "Launch commit session",
      reason: "Select a workflow branch first.",
      subject: {
        branchId: "",
        kind: "commit",
      },
    });
  }

  const latestSession = subject.latestSession;
  const runningBranchSession =
    latestSession?.runtimeState === "running" && latestSession.subject.kind === "branch";
  const runningOtherCommitSession =
    latestSession?.runtimeState === "running" &&
    latestSession.subject.kind === "commit" &&
    latestSession.subject.commitId !== subject.commitId;

  let reason: string | undefined;
  if (!subject.commitId || !subject.commitState) {
    reason = "Select a workflow commit first.";
  } else if (subject.hasRunningSession) {
    reason = undefined;
  } else if (
    subject.branchState === "backlog" ||
    subject.branchState === "done" ||
    subject.branchState === "archived"
  ) {
    reason = "The selected branch is not in a launchable state for commit execution.";
  } else if (!subject.isActiveCommit) {
    reason = "Select the branch active commit to launch commit execution.";
  } else if (subject.commitState === "planned") {
    reason = "Planned commits must be promoted before execution can launch.";
  } else if (subject.commitState === "committed" || subject.commitState === "dropped") {
    reason = "Committed and dropped commits do not accept execution sessions.";
  } else if (runningBranchSession) {
    reason = "The selected branch already has a running branch-scoped session.";
  } else if (runningOtherCommitSession) {
    reason = "Another commit on the selected branch already has a running session.";
  }

  return createActionModel({
    description: subject.hasRunningSession
      ? "Reuse the running commit-scoped session for the selected workflow commit."
      : "Start a commit-scoped execution session from the selected workflow commit.",
    id: "commit-session",
    label: subject.hasRunningSession ? "Attach commit session" : "Launch commit session",
    ...(reason ? { reason } : {}),
    subject: {
      branchId: subject.branchId,
      ...(subject.commitId ? { commitId: subject.commitId } : {}),
      kind: "commit",
    },
  });
}

function buildWorkflowActionSet(
  branchBoard: ProjectBranchScopeResult,
  commitQueues: readonly CommitQueueScopeResult[],
  selectedBranchId: string | undefined,
  selectedCommitId: string | undefined,
): WorkflowTuiActionSetModel {
  const selectedCommitQueue = getCommitQueueForBranch(commitQueues, selectedBranchId);
  const branchSubject = getSelectedBranchSubjectState(
    branchBoard,
    selectedCommitQueue,
    selectedBranchId,
  );
  const commitSubject = getSelectedCommitSubjectState(
    branchSubject?.branchState,
    selectedCommitQueue,
    selectedCommitId,
  );

  return {
    branch: [buildBranchSessionAction(branchSubject)],
    commit: [buildCommitSessionAction(commitSubject)],
  };
}

function listWorkflowActions(actions: WorkflowTuiActionSetModel) {
  return [...actions.branch, ...actions.commit];
}

function getWorkflowTuiActionStateKey(
  subject: WorkflowTuiActionModel["subject"],
  actionId: WorkflowTuiAction,
) {
  return `${subject.kind}:${subject.branchId}:${subject.commitId ?? ""}:${actionId}`;
}

function isKnownActionSubject(
  branchBoard: ProjectBranchScopeResult,
  commitQueues: readonly CommitQueueScopeResult[],
  subject: WorkflowTuiActionModel["subject"],
) {
  if (!subject.branchId) {
    return false;
  }

  const branchExists = branchBoard.rows.some((row) => row.workflowBranch.id === subject.branchId);
  if (!branchExists) {
    return false;
  }

  if (subject.kind === "branch") {
    return true;
  }

  if (!subject.commitId) {
    return false;
  }

  return (
    getCommitQueueForBranch(commitQueues, subject.branchId)?.rows.some(
      (row) => row.workflowCommit.id === subject.commitId,
    ) ?? false
  );
}

function normalizeWorkflowTuiActionRequestStates(
  branchBoard: ProjectBranchScopeResult,
  commitQueues: readonly CommitQueueScopeResult[],
  states: readonly WorkflowTuiActionRequestStateModel[] | undefined,
) {
  if (!states?.length) {
    return undefined;
  }

  const deduped = new Map<string, WorkflowTuiActionRequestStateModel>();
  for (const state of states) {
    if (!isKnownActionSubject(branchBoard, commitQueues, state.subject)) {
      continue;
    }
    deduped.set(getWorkflowTuiActionStateKey(state.subject, state.actionId), state);
  }

  return deduped.size > 0 ? [...deduped.values()] : undefined;
}

function upsertWorkflowTuiActionRequestState(
  states: readonly WorkflowTuiActionRequestStateModel[] | undefined,
  nextState: WorkflowTuiActionRequestStateModel,
) {
  const nextStates = [...(states ?? [])];
  const stateKey = getWorkflowTuiActionStateKey(nextState.subject, nextState.actionId);
  const existingIndex = nextStates.findIndex(
    (state) => getWorkflowTuiActionStateKey(state.subject, state.actionId) === stateKey,
  );
  if (existingIndex >= 0) {
    nextStates.splice(existingIndex, 1, nextState);
  } else {
    nextStates.push(nextState);
  }
  return nextStates;
}

function resolveSelectedActionId(
  actions: readonly WorkflowTuiActionModel[],
  selectedActionId: WorkflowTuiAction | undefined,
) {
  if (!actions.length) {
    return undefined;
  }
  if (selectedActionId && actions.some((action) => action.id === selectedActionId)) {
    return selectedActionId;
  }
  return actions.find((action) => action.availability === "available")?.id ?? actions[0]?.id;
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
    actions: {
      branch: [],
      commit: [],
    },
    actionSurface: {
      open: false,
    },
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
  const actions = buildWorkflowActionSet(
    model.branchBoard,
    commitQueues,
    selectedBranchId,
    selectedCommitId,
  );
  const flatActions = listWorkflowActions(actions);
  const resolvedSelectedActionId = resolveSelectedActionId(
    flatActions,
    model.actionSurface?.selectedActionId,
  );
  const states = normalizeWorkflowTuiActionRequestStates(
    model.branchBoard,
    commitQueues,
    model.actionSurface?.states,
  );

  return {
    kind: "workflow",
    actions,
    actionSurface: {
      open: Boolean(model.actionSurface?.open),
      ...(resolvedSelectedActionId ? { selectedActionId: resolvedSelectedActionId } : {}),
      ...(states ? { states } : {}),
    },
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

export function toggleWorkflowTuiActionSurface(
  model: WorkflowTuiSurfaceModel,
): WorkflowTuiSurfaceModel {
  if (model.kind !== "workflow") {
    return model;
  }

  return normalizeWorkflowTuiSurfaceModel({
    ...model,
    actionSurface: {
      ...model.actionSurface,
      open: !model.actionSurface.open,
    },
  });
}

export function moveWorkflowTuiActionSelection(
  model: WorkflowTuiSurfaceModel,
  delta: number,
): WorkflowTuiSurfaceModel {
  if (model.kind !== "workflow" || delta === 0 || !model.actionSurface.open) {
    return model;
  }

  const actions = listWorkflowActions(model.actions);
  if (!actions.length) {
    return model;
  }

  const selectedActionId = resolveSelectedActionId(actions, model.actionSurface.selectedActionId);
  const nextActionId = moveSelection(
    selectedActionId,
    actions.map((action) => action.id),
    delta,
  ) as WorkflowTuiAction | undefined;
  if (!nextActionId || nextActionId === model.actionSurface.selectedActionId) {
    return model;
  }

  return normalizeWorkflowTuiSurfaceModel({
    ...model,
    actionSurface: {
      ...model.actionSurface,
      selectedActionId: nextActionId,
    },
  });
}

export function getSelectedWorkflowTuiAction(
  model: WorkflowTuiSurfaceModel,
): WorkflowTuiActionModel | undefined {
  if (model.kind !== "workflow") {
    return undefined;
  }

  const selectedActionId = resolveSelectedActionId(
    listWorkflowActions(model.actions),
    model.actionSurface.selectedActionId,
  );
  if (!selectedActionId) {
    return undefined;
  }

  return listWorkflowActions(model.actions).find((action) => action.id === selectedActionId);
}

export function getWorkflowTuiActionRequestState(
  model: WorkflowTuiSurfaceModel,
  action: WorkflowTuiActionModel,
): WorkflowTuiActionRequestStateModel | undefined {
  if (model.kind !== "workflow") {
    return undefined;
  }

  const stateKey = getWorkflowTuiActionStateKey(action.subject, action.id);
  return model.actionSurface.states?.find(
    (state) => getWorkflowTuiActionStateKey(state.subject, state.actionId) === stateKey,
  );
}

export function setWorkflowTuiActionRequestState(
  model: WorkflowTuiSurfaceModel,
  state: WorkflowTuiActionRequestStateModel,
): WorkflowTuiSurfaceModel {
  if (model.kind !== "workflow") {
    return model;
  }

  return normalizeWorkflowTuiSurfaceModel({
    ...model,
    actionSurface: {
      ...model.actionSurface,
      states: upsertWorkflowTuiActionRequestState(model.actionSurface.states, state),
    },
  });
}
