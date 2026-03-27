import { edgeId } from "@io/graph-kernel";
import type { GraphCommandSpec } from "@io/graph-module";

import { branch, commit, project, repository } from "./type.js";

export const branchStateValues = [
  "backlog",
  "ready",
  "active",
  "blocked",
  "done",
  "archived",
] as const;

export type WorkflowBranchStateValue = (typeof branchStateValues)[number];

export const commitStateValues = [
  "planned",
  "ready",
  "active",
  "blocked",
  "committed",
  "dropped",
] as const;

export type WorkflowCommitStateValue = (typeof commitStateValues)[number];

export const repositoryCommitStateValues = [
  "planned",
  "reserved",
  "attached",
  "committed",
  "observed",
] as const;

export type RepositoryCommitStateValue = (typeof repositoryCommitStateValues)[number];

export const repositoryCommitLeaseStateValues = [
  "unassigned",
  "reserved",
  "attached",
  "released",
] as const;

export type RepositoryCommitLeaseStateValue = (typeof repositoryCommitLeaseStateValues)[number];

export const workflowMutationFailureCodes = [
  "repository-missing",
  "branch-lock-conflict",
  "commit-lock-conflict",
  "invalid-transition",
  "subject-not-found",
] as const;

export type WorkflowMutationFailureCode = (typeof workflowMutationFailureCodes)[number];

type WorkflowSummaryBase = {
  readonly createdAt: string;
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
};

export type WorkflowProjectSummary = WorkflowSummaryBase & {
  readonly entity: "project";
  readonly inferred: boolean;
  readonly projectKey: string;
};

export type WorkflowRepositorySummary = WorkflowSummaryBase & {
  readonly defaultBaseBranch: string;
  readonly entity: "repository";
  readonly mainRemoteName?: string;
  readonly projectId: string;
  readonly repoRoot: string;
  readonly repositoryKey: string;
};

export type WorkflowBranchSummary = WorkflowSummaryBase & {
  readonly activeCommitId?: string;
  readonly branchKey: string;
  readonly entity: "branch";
  readonly contextDocumentId?: string;
  readonly goalDocumentId?: string;
  readonly goalSummary?: string;
  readonly projectId: string;
  readonly queueRank?: number;
  readonly state: WorkflowBranchStateValue;
};

export type WorkflowCommitSummary = WorkflowSummaryBase & {
  readonly branchId: string;
  readonly commitKey: string;
  readonly contextDocumentId?: string;
  readonly entity: "commit";
  readonly order: number;
  readonly parentCommitId?: string;
  readonly state: WorkflowCommitStateValue;
};

export type RepositoryBranchSummary = WorkflowSummaryBase & {
  readonly baseBranchName: string;
  readonly branchName: string;
  readonly entity: "repository-branch";
  readonly headSha?: string;
  readonly latestReconciledAt?: string;
  readonly managed: boolean;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly upstreamName?: string;
  readonly branchId?: string;
  readonly worktreePath?: string;
};

export type RepositoryCommitSummary = WorkflowSummaryBase & {
  readonly entity: "repository-commit";
  readonly committedAt?: string;
  readonly repositoryBranchId?: string;
  readonly repositoryId: string;
  readonly sha?: string;
  readonly state: RepositoryCommitStateValue;
  readonly commitId?: string;
  readonly worktree: {
    readonly branchName?: string;
    readonly leaseState: RepositoryCommitLeaseStateValue;
    readonly path?: string;
  };
};

export type WorkflowMutationSummary =
  | WorkflowProjectSummary
  | WorkflowRepositorySummary
  | WorkflowBranchSummary
  | WorkflowCommitSummary
  | RepositoryBranchSummary
  | RepositoryCommitSummary;

type WorkflowRepositoryWorktreeInput = {
  readonly branchName?: string | null;
  readonly leaseState?: RepositoryCommitLeaseStateValue;
  readonly path?: string | null;
};

export type WorkflowMutationAction =
  | {
      readonly action: "createProject";
      readonly inferred?: boolean;
      readonly projectKey: string;
      readonly title: string;
    }
  | {
      readonly action: "updateProject";
      readonly inferred?: boolean;
      readonly projectId: string;
      readonly projectKey?: string;
      readonly title?: string;
    }
  | {
      readonly action: "createRepository";
      readonly defaultBaseBranch: string;
      readonly mainRemoteName?: string | null;
      readonly projectId: string;
      readonly repoRoot: string;
      readonly repositoryKey: string;
      readonly title: string;
    }
  | {
      readonly action: "updateRepository";
      readonly defaultBaseBranch?: string;
      readonly mainRemoteName?: string | null;
      readonly repoRoot?: string;
      readonly repositoryId: string;
      readonly repositoryKey?: string;
      readonly title?: string;
    }
  | {
      readonly action: "createBranch";
      readonly branchKey: string;
      readonly contextDocumentId?: string | null;
      readonly goalDocumentId?: string | null;
      readonly projectId: string;
      readonly queueRank?: number | null;
      readonly state?: Extract<WorkflowBranchStateValue, "backlog" | "ready">;
      readonly title: string;
    }
  | {
      readonly action: "updateBranch";
      readonly branchId: string;
      readonly branchKey?: string;
      readonly contextDocumentId?: string | null;
      readonly goalDocumentId?: string | null;
      readonly queueRank?: number | null;
      readonly title?: string;
    }
  | {
      readonly action: "setBranchState";
      readonly branchId: string;
      readonly state: WorkflowBranchStateValue;
    }
  | {
      readonly action: "attachBranchRepositoryTarget";
      readonly baseBranchName: string;
      readonly branchId: string;
      readonly branchName: string;
      readonly headSha?: string | null;
      readonly latestReconciledAt?: string | null;
      readonly repositoryBranchId?: string;
      readonly repositoryId: string;
      readonly title?: string;
      readonly upstreamName?: string | null;
      readonly worktreePath?: string | null;
    }
  | {
      readonly action: "createCommit";
      readonly branchId: string;
      readonly commitKey: string;
      readonly contextDocumentId?: string | null;
      readonly order: number;
      readonly parentCommitId?: string | null;
      readonly state?: Extract<WorkflowCommitStateValue, "planned" | "ready">;
      readonly title: string;
    }
  | {
      readonly action: "updateCommit";
      readonly commitId: string;
      readonly commitKey?: string;
      readonly contextDocumentId?: string | null;
      readonly order?: number;
      readonly parentCommitId?: string | null;
      readonly title?: string;
    }
  | {
      readonly action: "setCommitState";
      readonly commitId: string;
      readonly state: WorkflowCommitStateValue;
    }
  | {
      readonly action: "createRepositoryCommit";
      readonly repositoryBranchId?: string | null;
      readonly repositoryId: string;
      readonly state?: Exclude<RepositoryCommitStateValue, "committed">;
      readonly title?: string | null;
      readonly commitId?: string;
      readonly worktree?: WorkflowRepositoryWorktreeInput;
    }
  | {
      readonly action: "attachCommitResult";
      readonly committedAt?: string;
      readonly repositoryBranchId?: string | null;
      readonly repositoryCommitId: string;
      readonly sha: string;
      readonly title?: string | null;
      readonly commitId?: string;
      readonly worktree?: WorkflowRepositoryWorktreeInput;
    };

export type WorkflowMutationResult = {
  readonly action: WorkflowMutationAction["action"];
  readonly created: boolean;
  cursor?: string;
  replayed?: boolean;
  readonly summary: WorkflowMutationSummary;
};

export const workflowMutationCommand = {
  key: "workflow:mutation",
  label: "Mutate workflow state",
  execution: "serverOnly",
  input: undefined as unknown as WorkflowMutationAction,
  output: undefined as unknown as WorkflowMutationResult,
  policy: {
    touchesPredicates: [
      { predicateId: edgeId(project.fields.projectKey) },
      { predicateId: edgeId(repository.fields.repositoryKey) },
      { predicateId: edgeId(branch.fields.state) },
      { predicateId: edgeId(branch.fields.goalDocument) },
      { predicateId: edgeId(branch.fields.contextDocument) },
      { predicateId: edgeId(branch.fields.activeCommit) },
      { predicateId: edgeId(commit.fields.contextDocument) },
      { predicateId: edgeId(commit.fields.state) },
    ],
  },
} satisfies GraphCommandSpec<WorkflowMutationAction, WorkflowMutationResult>;
