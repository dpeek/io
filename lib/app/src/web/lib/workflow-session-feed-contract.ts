import type {
  AgentSessionAppendEvent,
  CommitQueueScopeSessionKind,
  CommitQueueScopeSessionRuntimeState,
  CommitQueueScopeSessionSummary,
  ProjectBranchScopeRepositoryObservation,
  RepositoryCommitSummary,
  WorkflowArtifactRecord,
  WorkflowBranchSummary,
  WorkflowCommitSummary,
  WorkflowDecisionRecord,
  WorkflowRepositorySummary,
} from "@io/graph-module-workflow";

function normalizeSearchValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export type WorkflowSessionFeedRouteSearch = {
  readonly commit?: string;
  readonly session?: string;
};

export type WorkflowSessionFeedSubject =
  | {
      readonly branchId: string;
      readonly kind: "branch";
    }
  | {
      readonly branchId: string;
      readonly commitId: string;
      readonly kind: "commit";
    };

export type WorkflowSessionFeedSessionSelection =
  | {
      readonly kind: "latest-for-subject";
    }
  | {
      readonly kind: "session-id";
      readonly sessionId: string;
    };

type WorkflowSessionFeedSubjectSelection =
  | {
      readonly kind: "branch";
    }
  | {
      readonly commitId: string;
      readonly kind: "commit";
    };

export interface WorkflowSessionFeedContract {
  readonly initialSelection: {
    readonly session: WorkflowSessionFeedSessionSelection;
    readonly subject: WorkflowSessionFeedSubjectSelection;
  };
  readonly missingData: {
    readonly missingBranch: "Select a workflow branch before reading the retained session feed.";
    readonly unresolvedCommit: "The configured workflow commit is not visible in the selected branch commit queue.";
  };
  readonly read: {
    readonly kind: "session-feed";
    readonly query: {
      readonly projectId: ":selected-project-id";
      readonly session: ":selected-workflow-session";
      readonly subject: ":selected-workflow-subject";
    };
  };
}

export type WorkflowSessionFeedSelectionState =
  | {
      readonly contract: WorkflowSessionFeedContract;
      readonly kind: "missing-data";
      readonly message: WorkflowSessionFeedContract["missingData"]["missingBranch"];
      readonly reason: "branch-selection-required";
    }
  | {
      readonly availableCommitIds: readonly string[];
      readonly contract: WorkflowSessionFeedContract;
      readonly kind: "stale-selection";
      readonly message: WorkflowSessionFeedContract["missingData"]["unresolvedCommit"];
      readonly reason: "configured-commit-missing";
    }
  | {
      readonly contract: WorkflowSessionFeedContract;
      readonly kind: "ready";
      readonly query: WorkflowSessionFeedReadQuery;
    };

export interface WorkflowSessionFeedReadQuery {
  readonly projectId: string;
  readonly session: WorkflowSessionFeedSessionSelection;
  readonly subject: WorkflowSessionFeedSubject;
}

export interface WorkflowSessionFeedHeader {
  readonly id: string;
  readonly kind: CommitQueueScopeSessionKind;
  readonly sessionKey: string;
  readonly title: string;
}

export interface WorkflowSessionFeedSubjectSummary {
  readonly branch: WorkflowBranchSummary;
  readonly commit?: WorkflowCommitSummary;
  readonly projectId: string;
  readonly repository?: WorkflowRepositorySummary;
  readonly repositoryBranch?: ProjectBranchScopeRepositoryObservation;
  readonly repositoryCommit?: RepositoryCommitSummary;
}

export interface WorkflowSessionFeedRuntimeSummary {
  readonly endedAt?: string;
  readonly startedAt: string;
  readonly state: CommitQueueScopeSessionRuntimeState;
}

export type WorkflowSessionFeedFinalizationState =
  | {
      readonly status: "not-applicable";
    }
  | {
      readonly status: "pending";
    }
  | {
      readonly commitSha?: string;
      readonly finalizedAt?: string;
      readonly landedAt?: string;
      readonly linearState?: string;
      readonly status: "finalized";
    }
  | {
      readonly reason: "graph-finalization-unavailable";
      readonly status: "unknown";
    };

export type WorkflowSessionFeedHistoryState =
  | {
      readonly status: "empty";
    }
  | {
      readonly lastSequence: number;
      readonly persistedEventCount: number;
      readonly status: "complete";
    }
  | {
      readonly lastSequence?: number;
      readonly persistedEventCount: number;
      readonly reason: "event-gap" | "history-pending-append" | "transcript-truncated";
      readonly status: "partial";
    };

export interface WorkflowSessionFeedReadyResult {
  readonly artifacts: readonly WorkflowArtifactRecord[];
  readonly decisions: readonly WorkflowDecisionRecord[];
  readonly events: readonly AgentSessionAppendEvent[];
  readonly finalization: WorkflowSessionFeedFinalizationState;
  readonly header: WorkflowSessionFeedHeader;
  readonly history: WorkflowSessionFeedHistoryState;
  readonly query: WorkflowSessionFeedReadQuery;
  readonly runtime: WorkflowSessionFeedRuntimeSummary;
  readonly status: "ready";
  readonly subject: WorkflowSessionFeedSubjectSummary;
}

export interface WorkflowSessionFeedNoSessionResult {
  readonly branchLatestSession?: CommitQueueScopeSessionSummary;
  readonly query: WorkflowSessionFeedReadQuery & {
    readonly session: {
      readonly kind: "latest-for-subject";
    };
  };
  readonly status: "no-session";
}

export interface WorkflowSessionFeedStaleSelectionResult {
  readonly branchLatestSession?: CommitQueueScopeSessionSummary;
  readonly query: WorkflowSessionFeedReadQuery & {
    readonly session: {
      readonly kind: "session-id";
      readonly sessionId: string;
    };
  };
  readonly reason: "session-branch-mismatch" | "session-not-found" | "session-subject-mismatch";
  readonly status: "stale-selection";
}

export type WorkflowSessionFeedReadResult =
  | WorkflowSessionFeedNoSessionResult
  | WorkflowSessionFeedReadyResult
  | WorkflowSessionFeedStaleSelectionResult;

export function validateWorkflowSessionFeedRouteSearch(
  search: Record<string, unknown>,
): WorkflowSessionFeedRouteSearch {
  return {
    ...(normalizeSearchValue(search.commit) ? { commit: normalizeSearchValue(search.commit) } : {}),
    ...(normalizeSearchValue(search.session)
      ? { session: normalizeSearchValue(search.session) }
      : {}),
  };
}

export function createWorkflowSessionFeedContract(
  search: WorkflowSessionFeedRouteSearch = {},
): WorkflowSessionFeedContract {
  return Object.freeze({
    initialSelection: Object.freeze({
      session: search.session
        ? Object.freeze({
            kind: "session-id" as const,
            sessionId: search.session,
          })
        : Object.freeze({
            kind: "latest-for-subject" as const,
          }),
      subject: search.commit
        ? Object.freeze({
            commitId: search.commit,
            kind: "commit" as const,
          })
        : Object.freeze({
            kind: "branch" as const,
          }),
    }),
    missingData: Object.freeze({
      missingBranch: "Select a workflow branch before reading the retained session feed." as const,
      unresolvedCommit:
        "The configured workflow commit is not visible in the selected branch commit queue." as const,
    }),
    read: Object.freeze({
      kind: "session-feed" as const,
      query: Object.freeze({
        projectId: ":selected-project-id" as const,
        session: ":selected-workflow-session" as const,
        subject: ":selected-workflow-subject" as const,
      }),
    }),
  });
}

export function resolveWorkflowSessionFeedSelectionState(input: {
  readonly contract: WorkflowSessionFeedContract;
  readonly selectedBranchId?: string;
  readonly selectedProjectId?: string;
  readonly visibleCommitIds?: readonly string[];
}): WorkflowSessionFeedSelectionState {
  if (!input.selectedBranchId || !input.selectedProjectId) {
    return {
      contract: input.contract,
      kind: "missing-data",
      message: input.contract.missingData.missingBranch,
      reason: "branch-selection-required",
    };
  }

  const selection = input.contract.initialSelection.subject;
  if (selection.kind === "commit") {
    const availableCommitIds = input.visibleCommitIds ?? [];
    if (!availableCommitIds.includes(selection.commitId)) {
      return {
        availableCommitIds,
        contract: input.contract,
        kind: "stale-selection",
        message: input.contract.missingData.unresolvedCommit,
        reason: "configured-commit-missing",
      };
    }

    return {
      contract: input.contract,
      kind: "ready",
      query: {
        projectId: input.selectedProjectId,
        session: input.contract.initialSelection.session,
        subject: {
          branchId: input.selectedBranchId,
          commitId: selection.commitId,
          kind: "commit",
        },
      },
    };
  }

  return {
    contract: input.contract,
    kind: "ready",
    query: {
      projectId: input.selectedProjectId,
      session: input.contract.initialSelection.session,
      subject: {
        branchId: input.selectedBranchId,
        kind: "branch",
      },
    },
  };
}
