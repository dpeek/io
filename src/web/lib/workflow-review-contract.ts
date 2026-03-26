import { graphSyncScope } from "@io/core/graph";
import { workflowReviewSyncScopeRequest } from "@io/core/graph/modules/ops/workflow";

import type { WorkflowReadRequest } from "./workflow-transport.js";

export type WorkflowRouteSearch = {
  readonly branch?: string;
  readonly project?: string;
};

export type WorkflowReviewProjectResolution =
  | {
      readonly kind: "configured";
      readonly projectId: string;
    }
  | {
      readonly kind: "infer-singleton";
    };

export type WorkflowReviewBranchResolution =
  | {
      readonly branchId: string;
      readonly kind: "configured";
    }
  | {
      readonly kind: "first-branch-board-row";
    };

export interface WorkflowReviewStartupContract {
  readonly graph: {
    readonly fallbackScope: typeof graphSyncScope;
    readonly requestedScope: typeof workflowReviewSyncScopeRequest;
  };
  readonly initialSelection: {
    readonly branch: WorkflowReviewBranchResolution;
    readonly project: WorkflowReviewProjectResolution;
  };
  readonly loading: {
    readonly bootstrapDescription: string;
    readonly bootstrapTitle: string;
    readonly reviewDescription: string;
    readonly reviewTitle: string;
  };
  readonly missingData: {
    readonly emptyProject: string;
    readonly missingProject: string;
    readonly noProjects: string;
    readonly unresolvedBranch: string;
    readonly unresolvedProject: string;
  };
  readonly reads: {
    readonly branchBoard: Omit<WorkflowReadRequest, "query"> & {
      readonly kind: "project-branch-scope";
      readonly query: {
        readonly filter: {
          readonly showUnmanagedRepositoryBranches: true;
        };
        readonly projectId: string;
      };
    };
    readonly commitQueue: Omit<WorkflowReadRequest, "query"> & {
      readonly kind: "commit-queue-scope";
      readonly query: {
        readonly branchId: string;
      };
    };
  };
}

export type WorkflowReviewVisibleProject = {
  readonly id: string;
  readonly title: string;
};

export type WorkflowReviewVisibleBranch = {
  readonly id: string;
  readonly projectId: string;
  readonly queueRank?: number;
  readonly title: string;
  readonly updatedAt?: string;
};

export type WorkflowReviewStartupState =
  | {
      readonly contract: WorkflowReviewStartupContract;
      readonly kind: "missing-data";
      readonly message: string;
      readonly reason:
        | "configured-project-missing"
        | "no-visible-projects"
        | "project-selection-required";
      readonly visibleProjects: readonly WorkflowReviewVisibleProject[];
    }
  | {
      readonly availableBranches: readonly WorkflowReviewVisibleBranch[];
      readonly contract: WorkflowReviewStartupContract;
      readonly kind: "partial-data";
      readonly message: string;
      readonly project: WorkflowReviewVisibleProject;
      readonly reason: "configured-branch-missing" | "project-has-no-branches";
    }
  | {
      readonly availableBranches: readonly WorkflowReviewVisibleBranch[];
      readonly contract: WorkflowReviewStartupContract;
      readonly kind: "ready";
      readonly project: WorkflowReviewVisibleProject;
      readonly selectedBranch?: WorkflowReviewVisibleBranch;
    };

function normalizeSearchValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function compareBranches(
  left: WorkflowReviewVisibleBranch,
  right: WorkflowReviewVisibleBranch,
): number {
  const leftRank = left.queueRank ?? Number.MAX_SAFE_INTEGER;
  const rightRank = right.queueRank ?? Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (left.updatedAt !== right.updatedAt) {
    return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
  }
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

export function validateWorkflowRouteSearch(search: Record<string, unknown>): WorkflowRouteSearch {
  return {
    ...(normalizeSearchValue(search.project)
      ? { project: normalizeSearchValue(search.project) }
      : {}),
    ...(normalizeSearchValue(search.branch) ? { branch: normalizeSearchValue(search.branch) } : {}),
  };
}

export function createWorkflowReviewStartupContract(
  search: WorkflowRouteSearch = {},
): WorkflowReviewStartupContract {
  return Object.freeze({
    graph: Object.freeze({
      fallbackScope: graphSyncScope,
      requestedScope: workflowReviewSyncScopeRequest,
    }),
    initialSelection: Object.freeze({
      branch: search.branch
        ? Object.freeze({
            branchId: search.branch,
            kind: "configured" as const,
          })
        : Object.freeze({
            kind: "first-branch-board-row" as const,
          }),
      project: search.project
        ? Object.freeze({
            kind: "configured" as const,
            projectId: search.project,
          })
        : Object.freeze({
            kind: "infer-singleton" as const,
          }),
    }),
    loading: Object.freeze({
      bootstrapDescription:
        "Boot the browser workflow review surface against the shipped ops/workflow review sync scope before reading branch-board and commit-queue projections.",
      bootstrapTitle: "Loading workflow review",
      reviewDescription:
        "Resolve the initial project, read the branch board, and then read the selected branch commit queue over the workflow review contract.",
      reviewTitle: "Resolving workflow review",
    }),
    missingData: Object.freeze({
      emptyProject:
        "The resolved workflow project is visible in the review scope, but it does not currently expose any workflow branches.",
      missingProject:
        "The configured workflow project is not visible in the current workflow review scope.",
      noProjects:
        "The current workflow review scope does not expose any visible WorkflowProject records.",
      unresolvedBranch:
        "The configured workflow branch is not visible in the resolved project branch board.",
      unresolvedProject:
        "The workflow review scope exposes multiple visible WorkflowProject records. Select one explicitly before branch-board composition starts.",
    }),
    reads: Object.freeze({
      branchBoard: Object.freeze({
        kind: "project-branch-scope" as const,
        query: Object.freeze({
          filter: Object.freeze({
            showUnmanagedRepositoryBranches: true as const,
          }),
          projectId: ":resolved-project-id",
        }),
      }),
      commitQueue: Object.freeze({
        kind: "commit-queue-scope" as const,
        query: Object.freeze({
          branchId: ":selected-branch-id",
        }),
      }),
    }),
  });
}

export function resolveWorkflowReviewStartupState(
  projects: readonly WorkflowReviewVisibleProject[],
  branches: readonly WorkflowReviewVisibleBranch[],
  contract: WorkflowReviewStartupContract,
): WorkflowReviewStartupState {
  const configuredProject =
    contract.initialSelection.project.kind === "configured"
      ? contract.initialSelection.project
      : undefined;
  const resolvedProject = configuredProject
    ? projects.find((project) => project.id === configuredProject.projectId)
    : projects.length === 1
      ? projects[0]
      : undefined;

  if (!resolvedProject) {
    if (configuredProject) {
      return {
        contract,
        kind: "missing-data",
        message: contract.missingData.missingProject,
        reason: "configured-project-missing",
        visibleProjects: projects,
      };
    }

    return {
      contract,
      kind: "missing-data",
      message:
        projects.length === 0
          ? contract.missingData.noProjects
          : contract.missingData.unresolvedProject,
      reason: projects.length === 0 ? "no-visible-projects" : "project-selection-required",
      visibleProjects: projects,
    };
  }

  const availableBranches = branches
    .filter((branch) => branch.projectId === resolvedProject.id)
    .sort(compareBranches);

  if (availableBranches.length === 0) {
    return {
      availableBranches,
      contract,
      kind: "partial-data",
      message: contract.missingData.emptyProject,
      project: resolvedProject,
      reason: "project-has-no-branches",
    };
  }

  const configuredBranch =
    contract.initialSelection.branch.kind === "configured"
      ? contract.initialSelection.branch
      : undefined;
  const selectedBranch = configuredBranch
    ? availableBranches.find((branch) => branch.id === configuredBranch.branchId)
    : availableBranches[0];

  if (!selectedBranch) {
    return {
      availableBranches,
      contract,
      kind: "partial-data",
      message: contract.missingData.unresolvedBranch,
      project: resolvedProject,
      reason: "configured-branch-missing",
    };
  }

  return {
    availableBranches,
    contract,
    kind: "ready",
    project: resolvedProject,
    selectedBranch,
  };
}

function routeSearchMatches(current: WorkflowRouteSearch, next: WorkflowRouteSearch): boolean {
  return current.project === next.project && current.branch === next.branch;
}

export function resolveCanonicalWorkflowRouteSearch(
  current: WorkflowRouteSearch,
  startupState: WorkflowReviewStartupState,
): WorkflowRouteSearch | undefined {
  const next =
    startupState.kind === "ready"
      ? {
          branch: startupState.selectedBranch?.id,
          project: startupState.project.id,
        }
      : startupState.kind === "partial-data" && startupState.reason === "project-has-no-branches"
        ? {
            project: startupState.project.id,
          }
        : undefined;

  if (!next || routeSearchMatches(current, next)) {
    return undefined;
  }

  return next;
}
