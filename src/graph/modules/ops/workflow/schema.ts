export * from "./type.js";

import {
  repositoryBranch,
  repositoryCommit,
  repositoryCommitLeaseState,
  repositoryCommitState,
  workflowBranch,
  workflowBranchState,
  workflowCommit,
  workflowCommitState,
  workflowProject,
  workflowRepository,
} from "./type.js";

export const workflowSchema = {
  workflowProject,
  workflowRepository,
  workflowBranchState,
  workflowBranch,
  workflowCommitState,
  workflowCommit,
  repositoryCommitState,
  repositoryCommitLeaseState,
  repositoryBranch,
  repositoryCommit,
} as const;
