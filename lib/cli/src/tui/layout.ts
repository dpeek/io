import type {
  CommitQueueScopeResult,
  ProjectBranchScopeRepositoryObservation,
} from "@io/graph-module-workflow";

import type {
  WorkflowTuiActionModel,
  WorkflowTuiActionRequestStateModel,
  WorkflowTuiPanelModel,
  WorkflowTuiSurfaceModel,
  WorkflowTuiWorkflowSurfaceModel,
} from "./model.js";
import { getWorkflowTuiActionRequestState } from "./model.js";

export interface WorkflowTuiPanelComponentModel {
  body: string;
  id: string;
  title: string;
}

export interface WorkflowTuiRootComponentModel {
  footerLines: readonly string[];
  panels: readonly WorkflowTuiPanelComponentModel[];
  summaryLines: readonly string[];
}

function renderStartupPanelBody(panel: WorkflowTuiPanelModel) {
  return panel.lines.map((line) => `- ${line}`).join("\n");
}

function formatFocusLabel(focus: WorkflowTuiWorkflowSurfaceModel["focus"]) {
  switch (focus) {
    case "branch-board":
      return "Branch board";
    case "branch-detail":
      return "Branch detail";
    case "commit-queue":
      return "Commit queue";
  }
}

function formatTimestamp(value: string | undefined) {
  return value ?? "missing";
}

function getSelectedCommitQueue(model: WorkflowTuiWorkflowSurfaceModel) {
  return model.commitQueues.find(
    (commitQueue) => commitQueue.branch.branch.id === model.selectedBranchId,
  );
}

function getSelectedBranchRow(model: WorkflowTuiWorkflowSurfaceModel) {
  return model.branchBoard.rows.find((row) => row.branch.id === model.selectedBranchId);
}

function getSelectedCommitRow(model: WorkflowTuiWorkflowSurfaceModel) {
  const commitQueue = getSelectedCommitQueue(model);
  if (!commitQueue) {
    return undefined;
  }
  return commitQueue.rows.find((row) => row.commit.id === model.selectedCommitId);
}

function renderRepositoryObservation(
  observation: ProjectBranchScopeRepositoryObservation | undefined,
  fallback = "Not materialized in the attached repository.",
) {
  if (!observation) {
    return fallback;
  }

  return `${observation.repositoryBranch.branchName} [${observation.freshness}]`;
}

function renderBranchBoardBody(model: WorkflowTuiWorkflowSurfaceModel) {
  const lines = [
    `Managed branches: ${model.branchBoard.rows.length}`,
    `Observed repository branches: ${model.branchBoard.unmanagedRepositoryBranches.length}`,
    "",
  ];

  if (model.branchBoard.rows.length === 0) {
    lines.push("No workflow branches are currently available in scope.");
  } else {
    for (const row of model.branchBoard.rows) {
      const selected = row.branch.id === model.selectedBranchId ? ">" : " ";
      lines.push(
        `${selected} [${row.branch.state}] ${row.branch.title}${row.branch.queueRank !== undefined ? ` (#${row.branch.queueRank})` : ""}`,
      );
      lines.push(`  key: ${row.branch.branchKey}`);
      lines.push(`  repo: ${renderRepositoryObservation(row.repositoryBranch)}`);
    }
  }

  if (model.branchBoard.unmanagedRepositoryBranches.length > 0) {
    lines.push("");
    lines.push("Observed repository branches:");
    for (const observation of model.branchBoard.unmanagedRepositoryBranches) {
      lines.push(`  - ${observation.repositoryBranch.branchName} [${observation.freshness}]`);
    }
  }

  return lines.join("\n");
}

function renderLatestSession(commitQueue: CommitQueueScopeResult | undefined) {
  const latestSession = commitQueue?.branch.latestSession;
  if (!latestSession) {
    return "No retained session recorded for the selected branch.";
  }

  return `${latestSession.kind} / ${latestSession.runtimeState} / ${latestSession.sessionKey}`;
}

function formatActionRequestState(state: WorkflowTuiActionRequestStateModel | undefined) {
  if (!state) {
    return undefined;
  }

  return `${state.status}: ${state.message}`;
}

function formatActionPresentation(
  action: WorkflowTuiActionModel,
  requestState: WorkflowTuiActionRequestStateModel | undefined,
) {
  if (requestState) {
    return requestState.status;
  }
  return action.availability === "available" ? "available" : "disabled";
}

function renderActionLines(
  model: WorkflowTuiWorkflowSurfaceModel,
  actions: readonly WorkflowTuiActionModel[],
) {
  const lines = ["Actions:"];

  for (const action of actions) {
    const requestState = getWorkflowTuiActionRequestState(model, action);
    const presentation = formatActionPresentation(action, requestState);
    lines.push(`- ${action.label} [${presentation}] (${action.subject.kind})`);
    lines.push(`  ${action.description}`);
    if (action.reason) {
      lines.push(`  Why disabled: ${action.reason}`);
    }
    if (requestState) {
      lines.push(`  State: ${formatActionRequestState(requestState)}`);
    }
  }

  return lines;
}

function renderBranchDetailBody(model: WorkflowTuiWorkflowSurfaceModel) {
  const selectedRow = getSelectedBranchRow(model);
  const selectedQueue = getSelectedCommitQueue(model);
  const repository = model.branchBoard.repository;

  if (!selectedRow || !selectedQueue) {
    return "No workflow branch is currently selected.";
  }

  const lines = [
    `Title: ${selectedRow.branch.title}`,
    `State: ${selectedRow.branch.state}`,
    `Key: ${selectedRow.branch.branchKey}`,
    `Queue rank: ${selectedRow.branch.queueRank ?? "unranked"}`,
    `Goal: ${selectedRow.branch.goalSummary ?? "Not recorded"}`,
    `Repository branch: ${renderRepositoryObservation(selectedRow.repositoryBranch)}`,
    `Latest session: ${renderLatestSession(selectedQueue)}`,
    `Projected at: ${formatTimestamp(model.branchBoard.freshness.projectedAt)}`,
    `Repository freshness: ${model.branchBoard.freshness.repositoryFreshness}`,
  ];

  if (repository) {
    lines.splice(
      5,
      0,
      `Repository: ${repository.title} (${repository.repositoryKey}) -> ${repository.defaultBaseBranch}`,
    );
  }
  if (model.branchBoard.freshness.repositoryReconciledAt) {
    lines.push(
      `Repository reconciled at: ${formatTimestamp(model.branchBoard.freshness.repositoryReconciledAt)}`,
    );
  }
  lines.push("");
  lines.push(...renderActionLines(model, model.actions.branch));

  return lines.join("\n");
}

function renderRepositoryCommitSummary(commitQueue: CommitQueueScopeResult, commitId: string) {
  const repositoryCommit = commitQueue.rows.find(
    (row) => row.commit.id === commitId,
  )?.repositoryCommit;
  if (!repositoryCommit) {
    return "No repository commit attached.";
  }

  const fields = [`state ${repositoryCommit.state}`];
  if (repositoryCommit.sha) {
    fields.push(`sha ${repositoryCommit.sha}`);
  }
  if (repositoryCommit.worktree.branchName) {
    fields.push(`branch ${repositoryCommit.worktree.branchName}`);
  }
  if (repositoryCommit.worktree.path) {
    fields.push(`worktree ${repositoryCommit.worktree.path}`);
  }
  fields.push(`lease ${repositoryCommit.worktree.leaseState}`);
  return fields.join(" | ");
}

function renderCommitQueueBody(model: WorkflowTuiWorkflowSurfaceModel) {
  const selectedQueue = getSelectedCommitQueue(model);
  if (!selectedQueue) {
    return "No commit queue is available for the current selection.";
  }

  const lines = [
    `Branch: ${selectedQueue.branch.branch.title}`,
    `Active commit: ${selectedQueue.branch.activeCommit?.commit.title ?? "None"}`,
    "",
  ];

  if (selectedQueue.rows.length === 0) {
    lines.push("No logical commits are currently queued for this branch.");
    return lines.join("\n");
  }

  for (const row of selectedQueue.rows) {
    const selected = row.commit.id === model.selectedCommitId ? ">" : " ";
    const active = row.commit.id === selectedQueue.branch.branch.activeCommitId ? "*" : " ";
    lines.push(
      `${selected}${active} ${row.commit.order}. [${row.commit.state}] ${row.commit.title}`,
    );
    lines.push(`   key: ${row.commit.commitKey}`);
    lines.push(`   repo: ${renderRepositoryCommitSummary(selectedQueue, row.commit.id)}`);
  }

  if (selectedQueue.nextCursor) {
    lines.push("");
    lines.push("More commit rows remain beyond the current page.");
  }

  lines.push("");
  lines.push(...renderActionLines(model, model.actions.commit));

  return lines.join("\n");
}

function buildWorkflowPanels(
  model: WorkflowTuiWorkflowSurfaceModel,
): WorkflowTuiPanelComponentModel[] {
  return [
    {
      body: renderBranchBoardBody(model),
      id: "branch-board",
      title: model.focus === "branch-board" ? "Branches [focused]" : "Branches",
    },
    {
      body: renderBranchDetailBody(model),
      id: "branch-detail",
      title: model.focus === "branch-detail" ? "Branch Detail [focused]" : "Branch Detail",
    },
    {
      body: renderCommitQueueBody(model),
      id: "commit-queue",
      title: model.focus === "commit-queue" ? "Commit Queue [focused]" : "Commit Queue",
    },
  ];
}

function buildWorkflowSummaryLines(model: WorkflowTuiWorkflowSurfaceModel) {
  const selectedRow = getSelectedBranchRow(model);
  const selectedCommit = getSelectedCommitRow(model);
  const repository = model.branchBoard.repository;

  return [
    "IO Workflow TUI",
    `Project: ${model.branchBoard.project.title} (${model.branchBoard.project.projectKey})${repository ? ` | Repository: ${repository.title} -> ${repository.defaultBaseBranch}` : ""} | Focus: ${formatFocusLabel(model.focus)}`,
    `Selected branch: ${selectedRow ? `${selectedRow.branch.title} [${selectedRow.branch.state}]` : "none"}${selectedCommit ? ` | Selected commit: ${selectedCommit.commit.title} [${selectedCommit.commit.state}]` : ""}`,
  ];
}

function buildWorkflowFooterLines(model: WorkflowTuiWorkflowSurfaceModel) {
  const actionItems = [...model.actions.branch, ...model.actions.commit].map((action) => {
    const selected = action.id === model.actionSurface.selectedActionId ? ">" : " ";
    const requestState = getWorkflowTuiActionRequestState(model, action);
    const presentation = formatActionPresentation(action, requestState);
    return `${selected} ${action.label} [${presentation}]`;
  });
  const selectedAction = [...model.actions.branch, ...model.actions.commit].find(
    (action) => action.id === model.actionSurface.selectedActionId,
  );
  const selectedActionState = selectedAction
    ? getWorkflowTuiActionRequestState(model, selectedAction)
    : undefined;
  const selectedActionStateLine = selectedActionState
    ? `${selectedAction?.label ?? "Selected action"} ${selectedActionState.status}: ${selectedActionState.message}`
    : "No action triggered for the selected branch or commit.";

  return [
    model.actionSurface.open
      ? `Actions: ${actionItems.join(" | ")}`
      : "Actions: press a to open the action bar for the selected branch or commit",
    model.actionSurface.open
      ? "Keys: left/right focus | up/down select | a close actions | n/p cycle actions | enter trigger | q, esc, ctrl-c exit"
      : "Keys: left/right focus | up/down select | a open actions | q, esc, ctrl-c exit",
    `Action state: ${selectedActionStateLine}`,
    `Board freshness: ${model.branchBoard.freshness.repositoryFreshness} | projected ${formatTimestamp(model.branchBoard.freshness.projectedAt)}${model.branchBoard.freshness.repositoryReconciledAt ? ` | repository reconciled ${formatTimestamp(model.branchBoard.freshness.repositoryReconciledAt)}` : ""}`,
  ];
}

export function buildWorkflowTuiRootComponentModel(
  model: WorkflowTuiSurfaceModel,
): WorkflowTuiRootComponentModel {
  if (model.kind === "workflow") {
    return {
      footerLines: buildWorkflowFooterLines(model),
      panels: buildWorkflowPanels(model),
      summaryLines: buildWorkflowSummaryLines(model),
    };
  }

  return {
    footerLines: model.footerLines,
    panels: model.panels.map((panel) => ({
      body: renderStartupPanelBody(panel),
      id: panel.id,
      title: panel.title,
    })),
    summaryLines: model.summaryLines,
  };
}
