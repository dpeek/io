import { type GraphClient } from "@io/graph-client";
import { applyGraphIdMap as applyIdMap } from "@io/graph-kernel";
import { core } from "@io/graph-module-core";
import {
  findRetainedProjectionRecord,
  type RetainedProjectionCheckpointRecord,
  type RetainedProjectionRowRecord,
} from "@io/graph-projection";

import type {
  RepositoryBranchSummary,
  RepositoryCommitSummary,
  WorkflowBranchStateValue,
  WorkflowBranchSummary,
  WorkflowCommitSummary,
  WorkflowProjectSummary,
  WorkflowRepositorySummary,
} from "./command.js";
import {
  repositoryCommitLeaseStateValues,
  repositoryCommitStateValues,
  branchStateValues,
  commitStateValues,
} from "./command.js";
import { documentSchema } from "./document.js";
import { projectionMetadata } from "./projection.js";
import {
  agentSession,
  agentSessionEvent,
  agentSessionEventPhase,
  agentSessionEventType,
  agentSessionKind,
  agentSessionRawLineEncoding,
  agentSessionRuntimeState,
  agentSessionStatusCode,
  agentSessionStatusFormat,
  agentSessionStream,
  agentSessionSubjectKind,
  repositoryBranch,
  repositoryCommit,
  repositoryCommitLeaseState,
  repositoryCommitState,
  artifact,
  artifactKind,
  branch,
  branchState,
  commit,
  commitState,
  decision,
  decisionKind,
  project,
  repository,
  contextBundle,
  contextBundleEntry,
  contextBundleEntrySource,
} from "./type.js";
import workflowIds from "./workflow.json";

export const projectBranchScopeFailureCodes = [
  "project-not-found",
  "policy-denied",
  "projection-stale",
] as const;

export type ProjectBranchScopeFailureCode = (typeof projectBranchScopeFailureCodes)[number];

export const projectBranchScopeOrderFieldValues = [
  "queue-rank",
  "updated-at",
  "created-at",
  "title",
  "state",
] as const;

export type ProjectBranchScopeOrderField = (typeof projectBranchScopeOrderFieldValues)[number];

export const projectBranchScopeOrderDirectionValues = ["asc", "desc"] as const;

export type ProjectBranchScopeOrderDirection =
  (typeof projectBranchScopeOrderDirectionValues)[number];

export const projectBranchScopeRepositoryFreshnessValues = ["fresh", "stale", "missing"] as const;

export type ProjectBranchScopeRepositoryFreshness =
  (typeof projectBranchScopeRepositoryFreshnessValues)[number];

export type ProjectBranchScopeOrderClause = {
  readonly direction: ProjectBranchScopeOrderDirection;
  readonly field: ProjectBranchScopeOrderField;
};

export const defaultProjectBranchScopeOrder = [
  { field: "queue-rank", direction: "asc" },
  { field: "updated-at", direction: "desc" },
  { field: "title", direction: "asc" },
] as const satisfies readonly ProjectBranchScopeOrderClause[];

export interface ProjectBranchScopeFilters {
  readonly hasActiveCommit?: boolean;
  readonly showUnmanagedRepositoryBranches?: boolean;
  readonly states?: readonly WorkflowBranchStateValue[];
}

export interface ProjectBranchScopeQuery {
  readonly cursor?: string;
  readonly filter?: ProjectBranchScopeFilters;
  readonly limit?: number;
  readonly order?: readonly ProjectBranchScopeOrderClause[];
  readonly projectId: string;
}

export interface ProjectBranchScopeRepositoryObservation {
  readonly freshness: ProjectBranchScopeRepositoryFreshness;
  readonly repositoryBranch: RepositoryBranchSummary;
}

export interface ProjectBranchScopeManagedRow {
  readonly repositoryBranch?: ProjectBranchScopeRepositoryObservation;
  readonly branch: WorkflowBranchSummary;
}

export interface ProjectBranchScopeFreshness {
  readonly projectedAt: string;
  readonly projectionCursor?: string;
  readonly repositoryFreshness: ProjectBranchScopeRepositoryFreshness;
  readonly repositoryReconciledAt?: string;
}

export interface ProjectBranchScopeResult {
  readonly freshness: ProjectBranchScopeFreshness;
  readonly nextCursor?: string;
  readonly project: WorkflowProjectSummary;
  readonly repository?: WorkflowRepositorySummary;
  readonly rows: readonly ProjectBranchScopeManagedRow[];
  readonly unmanagedRepositoryBranches: readonly ProjectBranchScopeRepositoryObservation[];
}

export const commitQueueScopeFailureCodes = [
  "branch-not-found",
  "policy-denied",
  "projection-stale",
] as const;

export type CommitQueueScopeFailureCode = (typeof commitQueueScopeFailureCodes)[number];

export type CommitQueueScopeSessionKind = keyof typeof agentSessionKind.options;

export type CommitQueueScopeSessionRuntimeState = keyof typeof agentSessionRuntimeState.options;

export type CommitQueueScopeSessionSubject =
  | {
      readonly kind: "branch";
    }
  | {
      readonly commitId: string;
      readonly kind: "commit";
    };

export interface CommitQueueScopeQuery {
  readonly branchId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export type CommitQueueScopeRepositoryObservation = ProjectBranchScopeRepositoryObservation;

export interface CommitQueueScopeCommitRow {
  readonly repositoryCommit?: RepositoryCommitSummary;
  readonly commit: WorkflowCommitSummary;
}

export interface CommitQueueScopeSessionSummary {
  readonly endedAt?: string;
  readonly id: string;
  readonly kind: CommitQueueScopeSessionKind;
  readonly runtimeState: CommitQueueScopeSessionRuntimeState;
  readonly sessionKey: string;
  readonly startedAt: string;
  readonly subject: CommitQueueScopeSessionSubject;
}

export interface CommitQueueScopeBranchDetail {
  readonly activeCommit?: CommitQueueScopeCommitRow;
  readonly latestSession?: CommitQueueScopeSessionSummary;
  readonly repositoryBranch?: CommitQueueScopeRepositoryObservation;
  readonly branch: WorkflowBranchSummary;
}

export type CommitQueueScopeFreshness = ProjectBranchScopeFreshness;

export interface CommitQueueScopeResult {
  readonly branch: CommitQueueScopeBranchDetail;
  readonly freshness: CommitQueueScopeFreshness;
  readonly nextCursor?: string;
  readonly rows: readonly CommitQueueScopeCommitRow[];
}

const projectionWorkflowSchema = applyIdMap(workflowIds, {
  project,
  repository,
  branchState,
  branch,
  commitState,
  commit,
  repositoryBranch,
  repositoryCommitState,
  repositoryCommitLeaseState,
  repositoryCommit,
  agentSessionSubjectKind,
  agentSessionKind,
  agentSessionRuntimeState,
  agentSession,
  agentSessionEventType,
  agentSessionEventPhase,
  agentSessionStatusCode,
  agentSessionStatusFormat,
  agentSessionStream,
  agentSessionRawLineEncoding,
  agentSessionEvent,
  artifactKind,
  artifact,
  decisionKind,
  decision,
  contextBundle,
  contextBundleEntrySource,
  contextBundleEntry,
});

export const projectionSchema = {
  ...core,
  ...documentSchema,
  ...projectionWorkflowSchema,
} as const;

type WorkflowProjectionClient = GraphClient<typeof projectionSchema>;
type WorkflowProjectEntity = ReturnType<WorkflowProjectionClient["project"]["get"]>;
type WorkflowRepositoryEntity = ReturnType<WorkflowProjectionClient["repository"]["get"]>;
type WorkflowBranchEntity = ReturnType<WorkflowProjectionClient["branch"]["get"]>;
type WorkflowCommitEntity = ReturnType<WorkflowProjectionClient["commit"]["get"]>;
type RepositoryBranchEntity = ReturnType<WorkflowProjectionClient["repositoryBranch"]["get"]>;
type RepositoryCommitEntity = ReturnType<WorkflowProjectionClient["repositoryCommit"]["get"]>;
type AgentSessionEntity = ReturnType<WorkflowProjectionClient["agentSession"]["get"]>;
type DocumentEntity = ReturnType<WorkflowProjectionClient["document"]["get"]>;

export interface WorkflowProjectionGraphClient {
  readonly document: {
    get(id: string): DocumentEntity;
  };
  readonly project: {
    list(): WorkflowProjectEntity[];
  };
  readonly repository: {
    list(): WorkflowRepositoryEntity[];
  };
  readonly branch: {
    list(): WorkflowBranchEntity[];
  };
  readonly commit: {
    list(): WorkflowCommitEntity[];
  };
  readonly repositoryBranch: {
    list(): RepositoryBranchEntity[];
  };
  readonly repositoryCommit: {
    list(): RepositoryCommitEntity[];
  };
  readonly agentSession: {
    list(): AgentSessionEntity[];
  };
}
type WorkflowProjectionErrorCode = ProjectBranchScopeFailureCode | CommitQueueScopeFailureCode;
type WorkflowProjectionCursorKind = "project-branch" | "commit-queue";
type WorkflowProjectionCursor = {
  readonly anchorId: string;
  readonly kind: WorkflowProjectionCursorKind;
  readonly offset: number;
  readonly projectionCursor: string;
  readonly version: 1;
};
type WorkflowProjectionFreshnessEntry = {
  readonly repositoryFreshness: ProjectBranchScopeRepositoryFreshness;
  readonly repositoryReconciledAt?: string;
};
type WorkflowProjectionIndexState = {
  readonly activeCommitByBranchId: ReadonlyMap<string, CommitQueueScopeCommitRow>;
  readonly branchById: ReadonlyMap<string, WorkflowBranchSummary>;
  readonly branchesByProjectId: ReadonlyMap<string, readonly WorkflowBranchSummary[]>;
  readonly commitRowsByBranchId: ReadonlyMap<string, readonly CommitQueueScopeCommitRow[]>;
  readonly latestSessionByBranchId: ReadonlyMap<string, CommitQueueScopeSessionSummary>;
  readonly managedRepositoryBranchByBranchId: ReadonlyMap<
    string,
    ProjectBranchScopeRepositoryObservation
  >;
  readonly projectById: ReadonlyMap<string, WorkflowProjectSummary>;
  readonly projectFreshnessById: ReadonlyMap<string, WorkflowProjectionFreshnessEntry>;
  readonly repositoryByProjectId: ReadonlyMap<string, WorkflowRepositorySummary>;
  readonly unmanagedRepositoryBranchesByProjectId: ReadonlyMap<
    string,
    readonly ProjectBranchScopeRepositoryObservation[]
  >;
};

const agentSessionKindValues = ["planning", "execution", "review"] as const;
const agentSessionRuntimeStateValues = [
  "running",
  "awaiting-user-input",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
const agentSessionSubjectKindValues = ["branch", "commit"] as const;
const projectionCursorPrefix = "workflow-projection:";

const branchStateIds = Object.fromEntries(
  branchStateValues.map((value) => [value, resolvedEnumValue(branchState.values[value])]),
) as Record<WorkflowBranchStateValue, string>;

const commitStateIds = Object.fromEntries(
  commitStateValues.map((value) => [value, resolvedEnumValue(commitState.values[value])]),
) as Record<(typeof commitStateValues)[number], string>;

const repositoryCommitStateIds = Object.fromEntries(
  repositoryCommitStateValues.map((value) => [
    value,
    resolvedEnumValue(repositoryCommitState.values[value]),
  ]),
) as Record<(typeof repositoryCommitStateValues)[number], string>;

const repositoryCommitLeaseStateIds = Object.fromEntries(
  repositoryCommitLeaseStateValues.map((value) => [
    value,
    resolvedEnumValue(repositoryCommitLeaseState.values[value]),
  ]),
) as Record<(typeof repositoryCommitLeaseStateValues)[number], string>;

const agentSessionKindIds = Object.fromEntries(
  agentSessionKindValues.map((value) => [value, resolvedEnumValue(agentSessionKind.values[value])]),
) as Record<CommitQueueScopeSessionKind, string>;

const agentSessionRuntimeStateIds = Object.fromEntries(
  agentSessionRuntimeStateValues.map((value) => [
    value,
    resolvedEnumValue(agentSessionRuntimeState.values[value]),
  ]),
) as Record<CommitQueueScopeSessionRuntimeState, string>;

const agentSessionSubjectKindIds = Object.fromEntries(
  agentSessionSubjectKindValues.map((value) => [
    value,
    resolvedEnumValue(agentSessionSubjectKind.values[value]),
  ]),
) as Record<(typeof agentSessionSubjectKindValues)[number], string>;

const branchStateKeysById = invertRecord(branchStateIds);
const commitStateKeysById = invertRecord(commitStateIds);
const repositoryCommitStateKeysById = invertRecord(repositoryCommitStateIds);
const repositoryCommitLeaseStateKeysById = invertRecord(repositoryCommitLeaseStateIds);
const agentSessionKindKeysById = invertRecord(agentSessionKindIds);
const agentSessionRuntimeStateKeysById = invertRecord(agentSessionRuntimeStateIds);
const agentSessionSubjectKindKeysById = invertRecord(agentSessionSubjectKindIds);
const branchStateOrder = new Map(branchStateValues.map((value, index) => [value, index] as const));

export class WorkflowProjectionQueryError extends Error {
  readonly code: WorkflowProjectionErrorCode;

  constructor(code: WorkflowProjectionErrorCode, message: string) {
    super(message);
    this.name = "WorkflowProjectionQueryError";
    this.code = code;
  }
}

export interface WorkflowProjectionIndexOptions {
  readonly projectedAt?: Date | string;
  readonly projectionCursor?: string;
}

export interface WorkflowProjectionIndex {
  readonly projections: typeof projectionMetadata;
  readonly projectedAt: string;
  readonly projectionCursor: string;
  readCommitQueueScope(query: CommitQueueScopeQuery): CommitQueueScopeResult;
  readProjectBranchScope(query: ProjectBranchScopeQuery): ProjectBranchScopeResult;
}

export type RetainedWorkflowProjectionCheckpoint = RetainedProjectionCheckpointRecord;

type RetainedProjectBranchBoardRow =
  | RetainedProjectionRowRecord<
      "branch",
      WorkflowBranchSummary,
      typeof projectionMetadata.projectBranchBoard.projectionId,
      typeof projectionMetadata.projectBranchBoard.definitionHash
    >
  | RetainedProjectionRowRecord<
      "managed-repository-branch",
      ProjectBranchScopeRepositoryObservation,
      typeof projectionMetadata.projectBranchBoard.projectionId,
      typeof projectionMetadata.projectBranchBoard.definitionHash
    >
  | RetainedProjectionRowRecord<
      "project",
      WorkflowProjectSummary,
      typeof projectionMetadata.projectBranchBoard.projectionId,
      typeof projectionMetadata.projectBranchBoard.definitionHash
    >
  | RetainedProjectionRowRecord<
      "project-freshness",
      WorkflowProjectionFreshnessEntry,
      typeof projectionMetadata.projectBranchBoard.projectionId,
      typeof projectionMetadata.projectBranchBoard.definitionHash
    >
  | RetainedProjectionRowRecord<
      "repository",
      WorkflowRepositorySummary,
      typeof projectionMetadata.projectBranchBoard.projectionId,
      typeof projectionMetadata.projectBranchBoard.definitionHash
    >
  | RetainedProjectionRowRecord<
      "unmanaged-repository-branch",
      ProjectBranchScopeRepositoryObservation,
      typeof projectionMetadata.projectBranchBoard.projectionId,
      typeof projectionMetadata.projectBranchBoard.definitionHash
    >;

type RetainedBranchCommitQueueRow =
  | RetainedProjectionRowRecord<
      "active-commit",
      CommitQueueScopeCommitRow,
      typeof projectionMetadata.branchCommitQueue.projectionId,
      typeof projectionMetadata.branchCommitQueue.definitionHash
    >
  | RetainedProjectionRowRecord<
      "branch",
      WorkflowBranchSummary,
      typeof projectionMetadata.branchCommitQueue.projectionId,
      typeof projectionMetadata.branchCommitQueue.definitionHash
    >
  | RetainedProjectionRowRecord<
      "commit-row",
      CommitQueueScopeCommitRow,
      typeof projectionMetadata.branchCommitQueue.projectionId,
      typeof projectionMetadata.branchCommitQueue.definitionHash
    >
  | RetainedProjectionRowRecord<
      "latest-session",
      CommitQueueScopeSessionSummary,
      typeof projectionMetadata.branchCommitQueue.projectionId,
      typeof projectionMetadata.branchCommitQueue.definitionHash
    >
  | RetainedProjectionRowRecord<
      "managed-repository-branch",
      ProjectBranchScopeRepositoryObservation,
      typeof projectionMetadata.branchCommitQueue.projectionId,
      typeof projectionMetadata.branchCommitQueue.definitionHash
    >
  | RetainedProjectionRowRecord<
      "project-freshness",
      WorkflowProjectionFreshnessEntry,
      typeof projectionMetadata.branchCommitQueue.projectionId,
      typeof projectionMetadata.branchCommitQueue.definitionHash
    >;

export type RetainedWorkflowProjectionRow =
  | RetainedProjectBranchBoardRow
  | RetainedBranchCommitQueueRow;

export type RetainedWorkflowProjectionState = {
  readonly checkpoints: readonly RetainedWorkflowProjectionCheckpoint[];
  readonly rows: readonly RetainedWorkflowProjectionRow[];
};

export function createWorkflowProjectionIndex(
  graph: WorkflowProjectionGraphClient,
  options: WorkflowProjectionIndexOptions = {},
): WorkflowProjectionIndex {
  const projectedAt = normalizeProjectedAt(options.projectedAt);
  const state = buildWorkflowProjectionIndexState(graph);
  const projectionCursor = options.projectionCursor ?? buildProjectionCursor(state);

  return createWorkflowProjectionIndexFromState(state, {
    projectedAt,
    projectionCursor,
  });
}

export function createRetainedWorkflowProjectionState(
  graph: WorkflowProjectionGraphClient,
  options: WorkflowProjectionIndexOptions & {
    readonly sourceCursor: string;
  },
): RetainedWorkflowProjectionState {
  const projectedAt = normalizeProjectedAt(options.projectedAt);
  const state = buildWorkflowProjectionIndexState(graph);
  const projectionCursor = options.projectionCursor ?? buildProjectionCursor(state);
  const rows: RetainedWorkflowProjectionRow[] = [];

  for (const project of state.projectById.values()) {
    rows.push({
      projectionId: projectionMetadata.projectBranchBoard.projectionId,
      definitionHash: projectionMetadata.projectBranchBoard.definitionHash,
      rowKind: "project",
      rowKey: project.id,
      sortKey: project.id,
      value: project,
    });
  }
  for (const repository of state.repositoryByProjectId.values()) {
    rows.push({
      projectionId: projectionMetadata.projectBranchBoard.projectionId,
      definitionHash: projectionMetadata.projectBranchBoard.definitionHash,
      rowKind: "repository",
      rowKey: repository.projectId,
      sortKey: repository.projectId,
      value: repository,
    });
  }
  for (const [projectId, freshness] of state.projectFreshnessById.entries()) {
    rows.push({
      projectionId: projectionMetadata.projectBranchBoard.projectionId,
      definitionHash: projectionMetadata.projectBranchBoard.definitionHash,
      rowKind: "project-freshness",
      rowKey: projectId,
      sortKey: projectId,
      value: freshness,
    });
    rows.push({
      projectionId: projectionMetadata.branchCommitQueue.projectionId,
      definitionHash: projectionMetadata.branchCommitQueue.definitionHash,
      rowKind: "project-freshness",
      rowKey: projectId,
      sortKey: projectId,
      value: freshness,
    });
  }
  for (const branch of state.branchById.values()) {
    rows.push({
      projectionId: projectionMetadata.projectBranchBoard.projectionId,
      definitionHash: projectionMetadata.projectBranchBoard.definitionHash,
      rowKind: "branch",
      rowKey: branch.id,
      sortKey: `${branch.projectId}\u0000${branch.id}`,
      value: branch,
    });
    rows.push({
      projectionId: projectionMetadata.branchCommitQueue.projectionId,
      definitionHash: projectionMetadata.branchCommitQueue.definitionHash,
      rowKind: "branch",
      rowKey: branch.id,
      sortKey: branch.id,
      value: branch,
    });
  }
  for (const [branchId, observation] of state.managedRepositoryBranchByBranchId.entries()) {
    rows.push({
      projectionId: projectionMetadata.projectBranchBoard.projectionId,
      definitionHash: projectionMetadata.projectBranchBoard.definitionHash,
      rowKind: "managed-repository-branch",
      rowKey: branchId,
      sortKey: branchId,
      value: observation,
    });
    rows.push({
      projectionId: projectionMetadata.branchCommitQueue.projectionId,
      definitionHash: projectionMetadata.branchCommitQueue.definitionHash,
      rowKind: "managed-repository-branch",
      rowKey: branchId,
      sortKey: branchId,
      value: observation,
    });
  }
  for (const [projectId, observations] of state.unmanagedRepositoryBranchesByProjectId.entries()) {
    observations.forEach((observation) => {
      rows.push({
        projectionId: projectionMetadata.projectBranchBoard.projectionId,
        definitionHash: projectionMetadata.projectBranchBoard.definitionHash,
        rowKind: "unmanaged-repository-branch",
        rowKey: observation.repositoryBranch.id,
        sortKey: `${projectId}\u0000${observation.repositoryBranch.branchName}\u0000${observation.repositoryBranch.id}`,
        value: observation,
      });
    });
  }
  for (const [branchId, row] of state.activeCommitByBranchId.entries()) {
    rows.push({
      projectionId: projectionMetadata.branchCommitQueue.projectionId,
      definitionHash: projectionMetadata.branchCommitQueue.definitionHash,
      rowKind: "active-commit",
      rowKey: branchId,
      sortKey: branchId,
      value: row,
    });
  }
  for (const [branchId, rowsForBranch] of state.commitRowsByBranchId.entries()) {
    rowsForBranch.forEach((row, index) => {
      rows.push({
        projectionId: projectionMetadata.branchCommitQueue.projectionId,
        definitionHash: projectionMetadata.branchCommitQueue.definitionHash,
        rowKind: "commit-row",
        rowKey: row.commit.id,
        sortKey: `${branchId}\u0000${index.toString().padStart(8, "0")}\u0000${row.commit.id}`,
        value: row,
      });
    });
  }
  for (const [branchId, session] of state.latestSessionByBranchId.entries()) {
    rows.push({
      projectionId: projectionMetadata.branchCommitQueue.projectionId,
      definitionHash: projectionMetadata.branchCommitQueue.definitionHash,
      rowKind: "latest-session",
      rowKey: branchId,
      sortKey: branchId,
      value: session,
    });
  }

  return {
    checkpoints: [
      {
        projectionId: projectionMetadata.projectBranchBoard.projectionId,
        definitionHash: projectionMetadata.projectBranchBoard.definitionHash,
        projectedAt,
        projectionCursor,
        sourceCursor: options.sourceCursor,
      },
      {
        projectionId: projectionMetadata.branchCommitQueue.projectionId,
        definitionHash: projectionMetadata.branchCommitQueue.definitionHash,
        projectedAt,
        projectionCursor,
        sourceCursor: options.sourceCursor,
      },
    ],
    rows,
  };
}

export function createWorkflowProjectionIndexFromRetainedState(
  retained: RetainedWorkflowProjectionState,
): WorkflowProjectionIndex {
  const projectBranchBoardCheckpoint = requireRetainedWorkflowProjectionCheckpoint(
    retained,
    projectionMetadata.projectBranchBoard.projectionId,
    projectionMetadata.projectBranchBoard.definitionHash,
  );
  const branchCommitQueueCheckpoint = requireRetainedWorkflowProjectionCheckpoint(
    retained,
    projectionMetadata.branchCommitQueue.projectionId,
    projectionMetadata.branchCommitQueue.definitionHash,
  );

  if (
    projectBranchBoardCheckpoint.projectedAt !== branchCommitQueueCheckpoint.projectedAt ||
    projectBranchBoardCheckpoint.projectionCursor !== branchCommitQueueCheckpoint.projectionCursor
  ) {
    throw new Error("Retained workflow projection checkpoints must share one projected state.");
  }

  const projectById = new Map<string, WorkflowProjectSummary>();
  const repositoryByProjectId = new Map<string, WorkflowRepositorySummary>();
  const branchById = new Map<string, WorkflowBranchSummary>();
  const managedRepositoryBranchByBranchId = new Map<
    string,
    ProjectBranchScopeRepositoryObservation
  >();
  const projectFreshnessById = new Map<string, WorkflowProjectionFreshnessEntry>();
  const unmanagedRepositoryBranchesByProjectId = new Map<
    string,
    ProjectBranchScopeRepositoryObservation[]
  >();
  const activeCommitByBranchId = new Map<string, CommitQueueScopeCommitRow>();
  const commitRowsByBranchId = new Map<string, CommitQueueScopeCommitRow[]>();
  const latestSessionByBranchId = new Map<string, CommitQueueScopeSessionSummary>();

  for (const row of retained.rows) {
    switch (row.rowKind) {
      case "project":
        projectById.set(row.value.id, row.value);
        break;
      case "repository":
        repositoryByProjectId.set(row.value.projectId, row.value);
        break;
      case "branch":
        branchById.set(row.value.id, row.value);
        break;
      case "managed-repository-branch":
        managedRepositoryBranchByBranchId.set(row.rowKey, row.value);
        break;
      case "project-freshness":
        projectFreshnessById.set(row.rowKey, row.value);
        break;
      case "unmanaged-repository-branch": {
        const projectId = row.value.repositoryBranch.projectId;
        const existing = unmanagedRepositoryBranchesByProjectId.get(projectId) ?? [];
        existing.push(row.value);
        unmanagedRepositoryBranchesByProjectId.set(projectId, existing);
        break;
      }
      case "active-commit":
        activeCommitByBranchId.set(row.rowKey, row.value);
        break;
      case "commit-row": {
        const branchId = row.value.commit.branchId;
        const existing = commitRowsByBranchId.get(branchId) ?? [];
        existing.push(row.value);
        commitRowsByBranchId.set(branchId, existing);
        break;
      }
      case "latest-session":
        latestSessionByBranchId.set(row.rowKey, row.value);
        break;
    }
  }

  const branchesByProjectId = groupBy([...branchById.values()], (branch) => branch.projectId);
  for (const [projectId, observations] of unmanagedRepositoryBranchesByProjectId.entries()) {
    unmanagedRepositoryBranchesByProjectId.set(
      projectId,
      [...observations].sort(compareRepositoryObservations),
    );
  }
  for (const [branchId, rowsForBranch] of commitRowsByBranchId.entries()) {
    commitRowsByBranchId.set(branchId, [...rowsForBranch].sort(compareCommitQueueRows));
  }

  return createWorkflowProjectionIndexFromState(
    {
      activeCommitByBranchId,
      branchById,
      branchesByProjectId,
      commitRowsByBranchId,
      latestSessionByBranchId,
      managedRepositoryBranchByBranchId,
      projectById,
      projectFreshnessById,
      repositoryByProjectId,
      unmanagedRepositoryBranchesByProjectId,
    },
    {
      projectedAt: projectBranchBoardCheckpoint.projectedAt,
      projectionCursor: projectBranchBoardCheckpoint.projectionCursor,
    },
  );
}

function createWorkflowProjectionIndexFromState(
  state: WorkflowProjectionIndexState,
  options: {
    readonly projectedAt: string;
    readonly projectionCursor: string;
  },
): WorkflowProjectionIndex {
  const { projectedAt, projectionCursor } = options;

  function readProjectBranchScope(query: ProjectBranchScopeQuery): ProjectBranchScopeResult {
    const project = state.projectById.get(query.projectId);
    if (!project) {
      throw new WorkflowProjectionQueryError(
        "project-not-found",
        `Workflow project "${query.projectId}" was not found in the current projection.`,
      );
    }

    const ordered = sortWorkflowBranches(
      state.branchesByProjectId.get(query.projectId) ?? [],
      query.order,
    );
    const filtered = filterProjectBranchRows(ordered, query.filter);
    const page = paginateWorkflowProjectionRows({
      anchorId: query.projectId,
      items: filtered,
      cursor: query.cursor,
      kind: "project-branch",
      limit: query.limit,
      projectionCursor,
    });

    const freshness = createScopeFreshness(
      projectedAt,
      projectionCursor,
      state.projectFreshnessById.get(query.projectId),
    );
    const repository = state.repositoryByProjectId.get(query.projectId);

    return {
      project,
      ...(repository ? { repository } : {}),
      rows: page.items.map((branch) => ({
        branch,
        ...(state.managedRepositoryBranchByBranchId.get(branch.id)
          ? {
              repositoryBranch: state.managedRepositoryBranchByBranchId.get(branch.id),
            }
          : {}),
      })),
      unmanagedRepositoryBranches: query.filter?.showUnmanagedRepositoryBranches
        ? (state.unmanagedRepositoryBranchesByProjectId.get(query.projectId) ?? [])
        : [],
      freshness,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  function readCommitQueueScope(query: CommitQueueScopeQuery): CommitQueueScopeResult {
    const branch = state.branchById.get(query.branchId);
    if (!branch) {
      throw new WorkflowProjectionQueryError(
        "branch-not-found",
        `Workflow branch "${query.branchId}" was not found in the current projection.`,
      );
    }

    const rows = state.commitRowsByBranchId.get(query.branchId) ?? [];
    const page = paginateWorkflowProjectionRows({
      anchorId: query.branchId,
      items: rows,
      cursor: query.cursor,
      kind: "commit-queue",
      limit: query.limit,
      projectionCursor,
    });

    return {
      branch: {
        branch,
        ...(state.managedRepositoryBranchByBranchId.get(query.branchId)
          ? {
              repositoryBranch: state.managedRepositoryBranchByBranchId.get(query.branchId),
            }
          : {}),
        ...(state.activeCommitByBranchId.get(query.branchId)
          ? { activeCommit: state.activeCommitByBranchId.get(query.branchId) }
          : {}),
        ...(state.latestSessionByBranchId.get(query.branchId)
          ? { latestSession: state.latestSessionByBranchId.get(query.branchId) }
          : {}),
      },
      rows: page.items,
      freshness: createScopeFreshness(
        projectedAt,
        projectionCursor,
        state.projectFreshnessById.get(branch.projectId),
      ),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  return {
    projections: projectionMetadata,
    projectedAt,
    projectionCursor,
    readProjectBranchScope,
    readCommitQueueScope,
  };
}

function requireRetainedWorkflowProjectionCheckpoint(
  retained: RetainedWorkflowProjectionState,
  projectionId: string,
  definitionHash: string,
): RetainedWorkflowProjectionCheckpoint {
  const result = findRetainedProjectionRecord(retained.checkpoints, {
    projectionId,
    definitionHash,
  });
  if (result.kind === "match") {
    return result.record;
  }

  if (result.kind === "definition-hash-mismatch") {
    throw new Error(
      `Retained workflow projection checkpoint for "${projectionId}" is incompatible. Expected definitionHash "${definitionHash}" but found ${result.actualDefinitionHashes.join(", ")}.`,
    );
  }

  throw new Error(
    `Missing retained workflow projection checkpoint for "${projectionId}" at "${definitionHash}".`,
  );
}

function buildWorkflowProjectionIndexState(
  graph: WorkflowProjectionGraphClient,
): WorkflowProjectionIndexState {
  const projectById = new Map(
    graph.project.list().map((project) => [project.id, buildProjectSummary(project)]),
  );
  const repositoriesByProjectId = groupBy(
    graph.repository.list().map(buildRepositorySummary),
    (repository) => repository.projectId,
  );
  const repositoryByProjectId = new Map<string, WorkflowRepositorySummary>();
  for (const [projectId, repositories] of repositoriesByProjectId.entries()) {
    const sorted = [...repositories].sort(compareWorkflowRepositories);
    if (sorted[0]) repositoryByProjectId.set(projectId, sorted[0]);
  }

  const branchById = new Map<string, WorkflowBranchSummary>();
  const branchesByProjectId = groupBy(
    graph.branch.list().map((branch) => {
      const summary = buildBranchSummary(graph, branch);
      branchById.set(summary.id, summary);
      return summary;
    }),
    (branch) => branch.projectId,
  );

  const repositoryCommitByWorkflowCommitId = new Map<string, RepositoryCommitSummary>();
  const repositoryCommitsByWorkflowCommitId = groupBy(
    graph.repositoryCommit.list().map(buildRepositoryCommitSummary),
    (repositoryCommit) => repositoryCommit.commitId,
  );
  for (const [commitId, repositoryCommits] of repositoryCommitsByWorkflowCommitId.entries()) {
    if (!commitId) continue;
    const sorted = [...repositoryCommits].sort(compareRepositoryCommitSummaries);
    if (sorted[0]) repositoryCommitByWorkflowCommitId.set(commitId, sorted[0]);
  }

  const commitRowsByBranchId = groupBy(
    graph.commit.list().map((commit) => {
      const commitSummary = buildCommitSummary(commit);
      return {
        commit: commitSummary,
        ...(repositoryCommitByWorkflowCommitId.get(commitSummary.id)
          ? {
              repositoryCommit: repositoryCommitByWorkflowCommitId.get(commitSummary.id),
            }
          : {}),
      } satisfies CommitQueueScopeCommitRow;
    }),
    (row) => row.commit.branchId,
  );
  for (const [branchId, rows] of commitRowsByBranchId.entries()) {
    commitRowsByBranchId.set(branchId, [...rows].sort(compareCommitQueueRows));
  }

  const managedRepositoryBranchByBranchId = new Map<
    string,
    ProjectBranchScopeRepositoryObservation
  >();
  const unmanagedRepositoryBranchesByProjectId = new Map<
    string,
    readonly ProjectBranchScopeRepositoryObservation[]
  >();
  const repositoryBranchesByProjectId = groupBy(
    graph.repositoryBranch.list().map(buildRepositoryBranchSummary),
    (repositoryBranchSummary) => repositoryBranchSummary.projectId,
  );
  for (const [projectId, repositoryBranches] of repositoryBranchesByProjectId.entries()) {
    const unmanaged = repositoryBranches
      .filter(
        (repositoryBranchSummary) =>
          !repositoryBranchSummary.managed || !repositoryBranchSummary.branchId,
      )
      .map((repositoryBranchSummary) => ({
        freshness: resolveRepositoryObservationFreshness(repositoryBranchSummary),
        repositoryBranch: repositoryBranchSummary,
      }))
      .sort(compareRepositoryObservations);
    unmanagedRepositoryBranchesByProjectId.set(projectId, unmanaged);

    const managedByBranchId = groupBy(
      repositoryBranches.filter(
        (repositoryBranchSummary) =>
          repositoryBranchSummary.managed && Boolean(repositoryBranchSummary.branchId),
      ),
      (repositoryBranchSummary) => repositoryBranchSummary.branchId,
    );
    for (const [branchId, managedRepositoryBranches] of managedByBranchId.entries()) {
      if (!branchId) continue;
      const selected = [...managedRepositoryBranches].sort(compareRepositoryBranchSummaries)[0];
      if (!selected) continue;
      managedRepositoryBranchByBranchId.set(branchId, {
        freshness: resolveRepositoryObservationFreshness(selected),
        repositoryBranch: selected,
      });
    }
  }

  const activeCommitByBranchId = new Map<string, CommitQueueScopeCommitRow>();
  for (const branch of branchById.values()) {
    if (!branch.activeCommitId) continue;
    const row = (commitRowsByBranchId.get(branch.id) ?? []).find(
      (commitRow) => commitRow.commit.id === branch.activeCommitId,
    );
    if (row) activeCommitByBranchId.set(branch.id, row);
  }

  const latestSessionByBranchId = new Map<string, CommitQueueScopeSessionSummary>();
  const sessionsByBranchId = groupBy(
    graph.agentSession
      .list()
      .map(buildCommitQueueScopeSessionSummary)
      .filter(
        (summary): summary is CommitQueueScopeSessionSummary & { readonly branchId: string } =>
          Boolean(summary),
      ),
    (summary) => summary.branchId,
  );
  for (const [branchId, sessionSummaries] of sessionsByBranchId.entries()) {
    const [latest] = [...sessionSummaries].sort(compareSessionSummaries);
    if (!latest) continue;
    latestSessionByBranchId.set(branchId, stripBranchId(latest));
  }

  const projectFreshnessById = new Map<string, WorkflowProjectionFreshnessEntry>();
  for (const projectId of projectById.keys()) {
    projectFreshnessById.set(
      projectId,
      resolveProjectFreshness(
        repositoryByProjectId.get(projectId),
        repositoryBranchesByProjectId.get(projectId) ?? [],
      ),
    );
  }

  return {
    activeCommitByBranchId,
    branchById,
    branchesByProjectId,
    commitRowsByBranchId,
    latestSessionByBranchId,
    managedRepositoryBranchByBranchId,
    projectById,
    projectFreshnessById,
    repositoryByProjectId,
    unmanagedRepositoryBranchesByProjectId,
  };
}

function filterProjectBranchRows(
  rows: readonly WorkflowBranchSummary[],
  filter: ProjectBranchScopeFilters | undefined,
): readonly WorkflowBranchSummary[] {
  if (!filter) return rows;

  return rows.filter((row) => {
    if (filter.states && filter.states.length > 0 && !filter.states.includes(row.state)) {
      return false;
    }
    if (filter.hasActiveCommit !== undefined) {
      const hasActiveCommit = Boolean(row.activeCommitId);
      if (hasActiveCommit !== filter.hasActiveCommit) return false;
    }
    return true;
  });
}

function createScopeFreshness(
  projectedAt: string,
  projectionCursor: string,
  freshness: WorkflowProjectionFreshnessEntry | undefined,
): ProjectBranchScopeFreshness {
  return {
    projectedAt,
    projectionCursor,
    repositoryFreshness: freshness?.repositoryFreshness ?? "missing",
    ...(freshness?.repositoryReconciledAt
      ? { repositoryReconciledAt: freshness.repositoryReconciledAt }
      : {}),
  };
}

function normalizeProjectedAt(projectedAt: Date | string | undefined): string {
  if (projectedAt === undefined) return new Date().toISOString();
  const value = typeof projectedAt === "string" ? new Date(projectedAt) : projectedAt;
  if (Number.isNaN(value.getTime())) {
    throw new Error("Workflow projection projectedAt must be a valid ISO timestamp.");
  }
  return value.toISOString();
}

function buildProjectionCursor(state: WorkflowProjectionIndexState): string {
  const latestUpdatedAt = collectProjectionTimestamps(state).sort(compareAscending).at(-1);

  return [
    projectionCursorPrefix,
    latestUpdatedAt ?? "empty",
    state.projectById.size,
    state.repositoryByProjectId.size,
    state.branchById.size,
    Array.from(state.commitRowsByBranchId.values()).reduce((total, rows) => total + rows.length, 0),
    state.managedRepositoryBranchByBranchId.size,
    Array.from(state.unmanagedRepositoryBranchesByProjectId.values()).reduce(
      (total, rows) => total + rows.length,
      0,
    ),
    state.latestSessionByBranchId.size,
  ].join(":");
}

function paginateWorkflowProjectionRows<TItem>(input: {
  readonly anchorId: string;
  readonly cursor?: string;
  readonly items: readonly TItem[];
  readonly kind: WorkflowProjectionCursorKind;
  readonly limit?: number;
  readonly projectionCursor: string;
}): {
  readonly items: readonly TItem[];
  readonly nextCursor?: string;
} {
  const offset =
    input.cursor === undefined
      ? 0
      : decodeWorkflowProjectionCursor(
          input.cursor,
          input.kind,
          input.projectionCursor,
          input.anchorId,
        ).offset;
  const safeLimit =
    input.limit === undefined ? input.items.length : Math.max(0, Math.trunc(input.limit));
  if (safeLimit === 0) {
    return { items: [] };
  }

  const items = input.items.slice(offset, offset + safeLimit);
  const nextOffset = offset + items.length;
  return {
    items,
    ...(nextOffset < input.items.length
      ? {
          nextCursor: encodeWorkflowProjectionCursor({
            version: 1,
            kind: input.kind,
            projectionCursor: input.projectionCursor,
            anchorId: input.anchorId,
            offset: nextOffset,
          }),
        }
      : {}),
  };
}

function encodeWorkflowProjectionCursor(cursor: WorkflowProjectionCursor): string {
  return `${projectionCursorPrefix}${Buffer.from(JSON.stringify(cursor), "utf8").toString(
    "base64url",
  )}`;
}

function decodeWorkflowProjectionCursor(
  cursor: string,
  kind: WorkflowProjectionCursorKind,
  projectionCursor: string,
  anchorId: string,
): WorkflowProjectionCursor {
  const encoded = cursor.startsWith(projectionCursorPrefix)
    ? cursor.slice(projectionCursorPrefix.length)
    : "";
  if (!encoded) {
    throw new WorkflowProjectionQueryError(
      "projection-stale",
      `Cursor "${cursor}" does not belong to the workflow projection reader.`,
    );
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<WorkflowProjectionCursor>;
    if (
      parsed.version !== 1 ||
      parsed.kind !== kind ||
      parsed.projectionCursor !== projectionCursor ||
      parsed.anchorId !== anchorId ||
      !Number.isInteger(parsed.offset) ||
      (parsed.offset ?? 0) < 0
    ) {
      throw new Error("stale");
    }

    return parsed as WorkflowProjectionCursor;
  } catch {
    throw new WorkflowProjectionQueryError(
      "projection-stale",
      `Cursor "${cursor}" is stale for the current workflow projection.`,
    );
  }
}

function stripBranchId(
  value: CommitQueueScopeSessionSummary & { readonly branchId: string },
): CommitQueueScopeSessionSummary {
  const { branchId: _branchId, ...summary } = value;
  return summary;
}

function sortWorkflowBranches(
  rows: readonly WorkflowBranchSummary[],
  order: readonly ProjectBranchScopeOrderClause[] | undefined,
): WorkflowBranchSummary[] {
  const clauses = order && order.length > 0 ? order : defaultProjectBranchScopeOrder;
  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      const natural = compareWorkflowBranchesByField(left, right, clause.field);
      if (natural === 0) continue;
      return clause.direction === "asc" ? natural : natural * -1;
    }
    return compareAscending(left.id, right.id);
  });
}

function compareWorkflowBranchesByField(
  left: WorkflowBranchSummary,
  right: WorkflowBranchSummary,
  field: ProjectBranchScopeOrderField,
): number {
  switch (field) {
    case "queue-rank":
      return compareOptionalNumber(left.queueRank, right.queueRank);
    case "updated-at":
      return compareAscending(left.updatedAt, right.updatedAt);
    case "created-at":
      return compareAscending(left.createdAt, right.createdAt);
    case "title":
      return compareAscending(left.title, right.title);
    case "state":
      return compareOptionalNumber(
        branchStateOrder.get(left.state),
        branchStateOrder.get(right.state),
      );
  }
}

function compareWorkflowRepositories(
  left: WorkflowRepositorySummary,
  right: WorkflowRepositorySummary,
): number {
  return (
    compareAscending(left.createdAt, right.createdAt) ||
    compareAscending(left.updatedAt, right.updatedAt) ||
    compareAscending(left.id, right.id)
  );
}

function compareCommitQueueRows(
  left: CommitQueueScopeCommitRow,
  right: CommitQueueScopeCommitRow,
): number {
  return (
    compareOptionalNumber(left.commit.order, right.commit.order) ||
    compareAscending(left.commit.createdAt, right.commit.createdAt) ||
    compareAscending(left.commit.updatedAt, right.commit.updatedAt) ||
    compareAscending(left.commit.id, right.commit.id)
  );
}

function compareRepositoryCommitSummaries(
  left: RepositoryCommitSummary,
  right: RepositoryCommitSummary,
): number {
  return (
    compareOptionalString(right.committedAt, left.committedAt) ||
    compareAscending(right.updatedAt, left.updatedAt) ||
    compareAscending(right.createdAt, left.createdAt) ||
    compareAscending(left.id, right.id)
  );
}

function compareRepositoryBranchSummaries(
  left: RepositoryBranchSummary,
  right: RepositoryBranchSummary,
): number {
  return (
    compareOptionalString(right.latestReconciledAt, left.latestReconciledAt) ||
    compareAscending(right.updatedAt, left.updatedAt) ||
    compareAscending(right.createdAt, left.createdAt) ||
    compareAscending(left.id, right.id)
  );
}

function compareRepositoryObservations(
  left: ProjectBranchScopeRepositoryObservation,
  right: ProjectBranchScopeRepositoryObservation,
): number {
  return (
    compareAscending(left.repositoryBranch.branchName, right.repositoryBranch.branchName) ||
    compareAscending(right.repositoryBranch.updatedAt, left.repositoryBranch.updatedAt) ||
    compareAscending(left.repositoryBranch.id, right.repositoryBranch.id)
  );
}

function compareSessionSummaries(
  left: CommitQueueScopeSessionSummary & { readonly branchId: string },
  right: CommitQueueScopeSessionSummary & { readonly branchId: string },
): number {
  return (
    compareAscending(right.startedAt, left.startedAt) ||
    compareOptionalString(right.endedAt, left.endedAt) ||
    compareAscending(left.id, right.id)
  );
}

function resolveProjectFreshness(
  repository: WorkflowRepositorySummary | undefined,
  repositoryBranches: readonly RepositoryBranchSummary[],
): WorkflowProjectionFreshnessEntry {
  if (!repository) {
    return {
      repositoryFreshness: "missing",
    };
  }

  const latestReconciledAt = repositoryBranches
    .map((repositoryBranchSummary) => repositoryBranchSummary.latestReconciledAt)
    .filter((value): value is string => Boolean(value))
    .sort(compareAscending)
    .at(-1);

  if (repositoryBranches.length === 0) {
    return {
      repositoryFreshness: "missing",
    };
  }

  return {
    repositoryFreshness: repositoryBranches.every(
      (repositoryBranchSummary) => repositoryBranchSummary.latestReconciledAt,
    )
      ? "fresh"
      : "stale",
    ...(latestReconciledAt ? { repositoryReconciledAt: latestReconciledAt } : {}),
  };
}

function resolveRepositoryObservationFreshness(
  repositoryBranchSummary: RepositoryBranchSummary,
): ProjectBranchScopeRepositoryFreshness {
  return repositoryBranchSummary.latestReconciledAt ? "fresh" : "stale";
}

function collectProjectionTimestamps(state: WorkflowProjectionIndexState): string[] {
  return [
    ...Array.from(state.projectById.values(), (entry) => entry.updatedAt),
    ...Array.from(state.repositoryByProjectId.values(), (entry) => entry.updatedAt),
    ...Array.from(state.branchById.values(), (entry) => entry.updatedAt),
    ...Array.from(state.commitRowsByBranchId.values()).flatMap((rows) =>
      rows.flatMap((row) =>
        [
          row.commit.updatedAt,
          row.repositoryCommit?.updatedAt,
          row.repositoryCommit?.committedAt,
        ].filter((value): value is string => Boolean(value)),
      ),
    ),
    ...Array.from(state.managedRepositoryBranchByBranchId.values(), (entry) =>
      entry.repositoryBranch.latestReconciledAt
        ? [entry.repositoryBranch.updatedAt, entry.repositoryBranch.latestReconciledAt]
        : [entry.repositoryBranch.updatedAt],
    ).flat(),
    ...Array.from(state.unmanagedRepositoryBranchesByProjectId.values()).flatMap((entries) =>
      entries.flatMap((entry) =>
        [entry.repositoryBranch.updatedAt, entry.repositoryBranch.latestReconciledAt].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ),
    ...Array.from(state.latestSessionByBranchId.values()).flatMap((entry) =>
      [entry.startedAt, entry.endedAt].filter((value): value is string => Boolean(value)),
    ),
  ];
}

function buildProjectSummary(entity: WorkflowProjectEntity): WorkflowProjectSummary {
  return {
    entity: "project",
    id: entity.id,
    title: entity.name,
    projectKey: entity.projectKey,
    inferred: entity.inferred,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function buildRepositorySummary(entity: WorkflowRepositoryEntity): WorkflowRepositorySummary {
  return {
    entity: "repository",
    id: entity.id,
    title: entity.name,
    projectId: entity.project,
    repositoryKey: entity.repositoryKey,
    repoRoot: entity.repoRoot,
    defaultBaseBranch: entity.defaultBaseBranch,
    ...(entity.mainRemoteName ? { mainRemoteName: entity.mainRemoteName } : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function trimOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readGoalSummary(
  graph: Pick<WorkflowProjectionGraphClient, "document">,
  goalDocumentId: string | undefined,
): string | undefined {
  if (!goalDocumentId) return undefined;
  return trimOptionalString(graph.document.get(goalDocumentId).description);
}

function buildBranchSummary(
  graph: Pick<WorkflowProjectionGraphClient, "document">,
  entity: WorkflowBranchEntity,
): WorkflowBranchSummary {
  const goalSummary = readGoalSummary(graph, entity.goalDocument);

  return {
    entity: "branch",
    id: entity.id,
    title: entity.name,
    projectId: entity.project,
    branchKey: entity.branchKey,
    state: decodeWorkflowBranchState(entity.state),
    ...(goalSummary ? { goalSummary } : {}),
    ...(entity.goalDocument ? { goalDocumentId: entity.goalDocument } : {}),
    ...(entity.contextDocument ? { contextDocumentId: entity.contextDocument } : {}),
    ...(entity.queueRank !== undefined ? { queueRank: entity.queueRank } : {}),
    ...(entity.activeCommit ? { activeCommitId: entity.activeCommit } : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function buildCommitSummary(entity: WorkflowCommitEntity): WorkflowCommitSummary {
  return {
    entity: "commit",
    id: entity.id,
    title: entity.name,
    branchId: entity.branch,
    commitKey: entity.commitKey,
    state: decodeWorkflowCommitState(entity.state),
    order: entity.order,
    ...(entity.parentCommit ? { parentCommitId: entity.parentCommit } : {}),
    ...(entity.contextDocument ? { contextDocumentId: entity.contextDocument } : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function buildRepositoryBranchSummary(entity: RepositoryBranchEntity): RepositoryBranchSummary {
  return {
    entity: "repository-branch",
    id: entity.id,
    title: entity.name,
    projectId: entity.project,
    repositoryId: entity.repository,
    ...(entity.branch ? { branchId: entity.branch } : {}),
    managed: entity.managed,
    branchName: entity.branchName,
    baseBranchName: entity.baseBranchName,
    ...(entity.upstreamName ? { upstreamName: entity.upstreamName } : {}),
    ...(entity.headSha ? { headSha: entity.headSha } : {}),
    ...(entity.worktreePath ? { worktreePath: entity.worktreePath } : {}),
    ...(entity.latestReconciledAt
      ? { latestReconciledAt: entity.latestReconciledAt.toISOString() }
      : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function buildRepositoryCommitSummary(entity: RepositoryCommitEntity): RepositoryCommitSummary {
  return {
    entity: "repository-commit",
    id: entity.id,
    title: entity.name,
    repositoryId: entity.repository,
    ...(entity.repositoryBranch ? { repositoryBranchId: entity.repositoryBranch } : {}),
    ...(entity.commit ? { commitId: entity.commit } : {}),
    state: decodeRepositoryCommitState(entity.state),
    worktree: {
      ...(entity.worktree.path ? { path: entity.worktree.path } : {}),
      ...(entity.worktree.branchName ? { branchName: entity.worktree.branchName } : {}),
      leaseState: decodeRepositoryCommitLeaseState(entity.worktree.leaseState),
    },
    ...(entity.sha ? { sha: entity.sha } : {}),
    ...(entity.committedAt ? { committedAt: entity.committedAt.toISOString() } : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function buildCommitQueueScopeSessionSummary(entity: AgentSessionEntity):
  | (CommitQueueScopeSessionSummary & {
      readonly branchId: string;
    })
  | undefined {
  const subjectKind = decodeAgentSessionSubjectKind(entity.subjectKind);

  if (subjectKind === "commit" && !entity.commit) {
    return undefined;
  }

  return {
    branchId: entity.branch,
    id: entity.id,
    sessionKey: entity.sessionKey,
    kind: decodeAgentSessionKind(entity.kind),
    runtimeState: decodeAgentSessionRuntimeState(entity.runtimeState),
    subject:
      subjectKind === "commit"
        ? {
            kind: "commit",
            commitId: entity.commit!,
          }
        : {
            kind: "branch",
          },
    startedAt: entity.startedAt.toISOString(),
    ...(entity.endedAt ? { endedAt: entity.endedAt.toISOString() } : {}),
  };
}

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? workflowIds.keys[value.key as keyof typeof workflowIds.keys] ?? value.key;
}

function invertRecord<TValue extends string>(
  value: Record<TValue, string>,
): Record<string, TValue> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [entry, key])) as Record<
    string,
    TValue
  >;
}

function decodeWorkflowBranchState(value: string): WorkflowBranchStateValue {
  const state = branchStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown workflow branch state id "${value}".`);
  }
  return state;
}

function decodeWorkflowCommitState(value: string): WorkflowCommitSummary["state"] {
  const state = commitStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown workflow commit state id "${value}".`);
  }
  return state;
}

function decodeRepositoryCommitState(value: string): RepositoryCommitSummary["state"] {
  const state = repositoryCommitStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown repository commit state id "${value}".`);
  }
  return state;
}

function decodeRepositoryCommitLeaseState(
  value: string,
): RepositoryCommitSummary["worktree"]["leaseState"] {
  const state = repositoryCommitLeaseStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown repository commit lease state id "${value}".`);
  }
  return state;
}

function decodeAgentSessionKind(value: string): CommitQueueScopeSessionKind {
  const kind = agentSessionKindKeysById[value];
  if (!kind) {
    throw new Error(`Unknown agent session kind id "${value}".`);
  }
  return kind;
}

function decodeAgentSessionRuntimeState(value: string): CommitQueueScopeSessionRuntimeState {
  const runtimeState = agentSessionRuntimeStateKeysById[value];
  if (!runtimeState) {
    throw new Error(`Unknown agent session runtime state id "${value}".`);
  }
  return runtimeState;
}

function decodeAgentSessionSubjectKind(
  value: string,
): (typeof agentSessionSubjectKindValues)[number] {
  const subjectKind = agentSessionSubjectKindKeysById[value];
  if (!subjectKind) {
    throw new Error(`Unknown agent session subject kind id "${value}".`);
  }
  return subjectKind;
}

function groupBy<TItem, TKey extends string | undefined>(
  items: readonly TItem[],
  selectKey: (item: TItem) => TKey,
): Map<TKey, TItem[]> {
  const grouped = new Map<TKey, TItem[]>();
  for (const item of items) {
    const key = selectKey(item);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(item);
      continue;
    }
    grouped.set(key, [item]);
  }
  return grouped;
}

function compareAscending(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left - right;
}

function compareOptionalString(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left.localeCompare(right);
}
