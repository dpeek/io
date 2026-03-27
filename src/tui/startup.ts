import { defaultHttpGraphUrl } from "@io/graph-client";

import type { Workflow } from "../agent/types.js";
import { workflowReviewSyncScopeRequest } from "../graph/modules/workflow/projection.js";

export interface WorkflowTuiStartupCliOverrides {
  branchId?: string;
  graphUrl?: string;
  projectId?: string;
}

export type WorkflowTuiProjectResolution =
  | {
      kind: "configured";
      projectId: string;
    }
  | {
      kind: "infer-singleton";
    };

export type WorkflowTuiBranchResolution =
  | {
      branchId: string;
      kind: "configured";
    }
  | {
      kind: "first-branch-board-row";
    };

export interface WorkflowTuiStartupContract {
  entrypointPath: string;
  graph: {
    kind: "http";
    requestedScope: typeof workflowReviewSyncScopeRequest;
    url: string;
  };
  initialScope: {
    branch: WorkflowTuiBranchResolution;
    project: WorkflowTuiProjectResolution;
  };
  workspaceRoot: string;
}

export function createDefaultWorkflowTuiStartupContract(options: {
  entrypointPath: string;
  workspaceRoot: string;
}): WorkflowTuiStartupContract {
  return {
    entrypointPath: options.entrypointPath,
    graph: {
      kind: "http",
      requestedScope: workflowReviewSyncScopeRequest,
      url: defaultHttpGraphUrl,
    },
    initialScope: {
      branch: {
        kind: "first-branch-board-row",
      },
      project: {
        kind: "infer-singleton",
      },
    },
    workspaceRoot: options.workspaceRoot,
  };
}

function normalizeGraphUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid graph URL "${url}": ${detail}`);
  }
}

export function resolveWorkflowTuiStartupContract(
  workflow: Pick<Workflow, "entrypoint" | "tui" | "workspace">,
  overrides: WorkflowTuiStartupCliOverrides = {},
): WorkflowTuiStartupContract {
  const contract = createDefaultWorkflowTuiStartupContract({
    entrypointPath: workflow.entrypoint.configPath,
    workspaceRoot: workflow.workspace.root,
  });
  const graphUrl = overrides.graphUrl ?? workflow.tui.graph.url;
  const projectId = overrides.projectId ?? workflow.tui.initialScope.project;
  const branchId = overrides.branchId ?? workflow.tui.initialScope.branch;

  return {
    ...contract,
    graph: {
      ...contract.graph,
      url: normalizeGraphUrl(graphUrl ?? contract.graph.url),
    },
    initialScope: {
      branch: branchId
        ? {
            branchId,
            kind: "configured",
          }
        : contract.initialScope.branch,
      project: projectId
        ? {
            kind: "configured",
            projectId,
          }
        : contract.initialScope.project,
    },
  };
}
