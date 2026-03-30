export * from "./type.js";
export * from "./command.js";
export * from "./artifact-write.js";
export * from "./decision-write.js";
export * from "./session-append.js";
export * from "./projection.js";
export * from "./query.js";

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
  contextBundle,
  contextBundleEntry,
  contextBundleEntrySource,
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
} from "./type.js";

export type WorkflowSchema = {
  agentSession: typeof agentSession;
  agentSessionEvent: typeof agentSessionEvent;
  agentSessionEventPhase: typeof agentSessionEventPhase;
  agentSessionEventType: typeof agentSessionEventType;
  agentSessionKind: typeof agentSessionKind;
  agentSessionRawLineEncoding: typeof agentSessionRawLineEncoding;
  agentSessionRuntimeState: typeof agentSessionRuntimeState;
  agentSessionStatusCode: typeof agentSessionStatusCode;
  agentSessionStatusFormat: typeof agentSessionStatusFormat;
  agentSessionStream: typeof agentSessionStream;
  agentSessionSubjectKind: typeof agentSessionSubjectKind;
  artifact: typeof artifact;
  artifactKind: typeof artifactKind;
  branch: typeof branch;
  branchState: typeof branchState;
  commit: typeof commit;
  commitState: typeof commitState;
  contextBundle: typeof contextBundle;
  contextBundleEntry: typeof contextBundleEntry;
  contextBundleEntrySource: typeof contextBundleEntrySource;
  decision: typeof decision;
  decisionKind: typeof decisionKind;
  project: typeof project;
  repository: typeof repository;
  repositoryBranch: typeof repositoryBranch;
  repositoryCommit: typeof repositoryCommit;
  repositoryCommitLeaseState: typeof repositoryCommitLeaseState;
  repositoryCommitState: typeof repositoryCommitState;
};

export const workflowSchema: WorkflowSchema = {
  project,
  repository,
  branchState,
  branch,
  commitState,
  commit,
  repositoryCommitState,
  repositoryCommitLeaseState,
  repositoryBranch,
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
};
