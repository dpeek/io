import type {
  CommitQueueScopeResult,
  ProjectBranchScopeRepositoryObservation,
} from "../graph/modules/ops/workflow/query.js";
import type {
  WorkflowTuiPanelModel,
  WorkflowTuiSurfaceModel,
  WorkflowTuiWorkflowSurfaceModel,
} from "./model.js";

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

function renderBootstrapPanelBody(panel: WorkflowTuiPanelModel) {
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
    (commitQueue) => commitQueue.branch.workflowBranch.id === model.selectedBranchId,
  );
}

function getSelectedBranchRow(model: WorkflowTuiWorkflowSurfaceModel) {
  return model.branchBoard.rows.find((row) => row.workflowBranch.id === model.selectedBranchId);
}

function getSelectedCommitRow(model: WorkflowTuiWorkflowSurfaceModel) {
  const commitQueue = getSelectedCommitQueue(model);
  if (!commitQueue) {
    return undefined;
  }
  return commitQueue.rows.find((row) => row.workflowCommit.id === model.selectedCommitId);
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
      const selected = row.workflowBranch.id === model.selectedBranchId ? ">" : " ";
      lines.push(
        `${selected} [${row.workflowBranch.state}] ${row.workflowBranch.title}${row.workflowBranch.queueRank !== undefined ? ` (#${row.workflowBranch.queueRank})` : ""}`,
      );
      lines.push(`  key: ${row.workflowBranch.branchKey}`);
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

function renderBranchDetailBody(model: WorkflowTuiWorkflowSurfaceModel) {
  const selectedRow = getSelectedBranchRow(model);
  const selectedQueue = getSelectedCommitQueue(model);
  const repository = model.branchBoard.repository;

  if (!selectedRow || !selectedQueue) {
    return "No workflow branch is currently selected.";
  }

  const lines = [
    `Title: ${selectedRow.workflowBranch.title}`,
    `State: ${selectedRow.workflowBranch.state}`,
    `Key: ${selectedRow.workflowBranch.branchKey}`,
    `Queue rank: ${selectedRow.workflowBranch.queueRank ?? "unranked"}`,
    `Goal: ${selectedRow.workflowBranch.goalSummary}`,
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

  return lines.join("\n");
}

function renderRepositoryCommitSummary(commitQueue: CommitQueueScopeResult, commitId: string) {
  const repositoryCommit = commitQueue.rows.find(
    (row) => row.workflowCommit.id === commitId,
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
    `Branch: ${selectedQueue.branch.workflowBranch.title}`,
    `Active commit: ${selectedQueue.branch.activeCommit?.workflowCommit.title ?? "None"}`,
    "",
  ];

  if (selectedQueue.rows.length === 0) {
    lines.push("No logical commits are currently queued for this branch.");
    return lines.join("\n");
  }

  for (const row of selectedQueue.rows) {
    const selected = row.workflowCommit.id === model.selectedCommitId ? ">" : " ";
    const active =
      row.workflowCommit.id === selectedQueue.branch.workflowBranch.activeCommitId ? "*" : " ";
    lines.push(
      `${selected}${active} ${row.workflowCommit.order}. [${row.workflowCommit.state}] ${row.workflowCommit.title}`,
    );
    lines.push(`   key: ${row.workflowCommit.commitKey}`);
    lines.push(`   repo: ${renderRepositoryCommitSummary(selectedQueue, row.workflowCommit.id)}`);
  }

  if (selectedQueue.nextCursor) {
    lines.push("");
    lines.push("More commit rows remain beyond the current page.");
  }

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
    `Selected branch: ${selectedRow ? `${selectedRow.workflowBranch.title} [${selectedRow.workflowBranch.state}]` : "none"}${selectedCommit ? ` | Selected commit: ${selectedCommit.workflowCommit.title} [${selectedCommit.workflowCommit.state}]` : ""}`,
  ];
}

function buildWorkflowFooterLines(model: WorkflowTuiWorkflowSurfaceModel) {
  return [
    "Keys: left/right focus | up/down select | q, esc, ctrl-c exit",
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
      body: renderBootstrapPanelBody(panel),
      id: panel.id,
      title: panel.title,
    })),
    summaryLines: model.summaryLines,
  };
}
