import type { AgentSessionRef } from "./tui/index.js";
import type { AgentIssue, PreparedWorkspace } from "./types.js";

function isTaskIssue(issue: Pick<AgentIssue, "hasParent" | "streamIssueIdentifier">) {
  return issue.hasParent && Boolean(issue.streamIssueIdentifier);
}

export function createWorkflowIssueRef(options: {
  id?: string;
  identifier?: string;
  state?: string;
  title?: string;
}) {
  if (!options.identifier) {
    return undefined;
  }
  return {
    id: options.id,
    identifier: options.identifier,
    state: options.state,
    title: options.title,
  };
}

export function createSessionWorkflow(issue: AgentIssue): AgentSessionRef["workflow"] {
  const current = createWorkflowIssueRef({
    id: issue.id,
    identifier: issue.identifier,
    state: issue.state,
    title: issue.title,
  });
  const streamIdentifier =
    issue.streamIssueIdentifier ??
    issue.grandparentIssueIdentifier ??
    issue.parentIssueIdentifier ??
    issue.identifier;
  const stream = createWorkflowIssueRef({
    id: issue.streamIssueId ?? issue.grandparentIssueId ?? issue.parentIssueId ?? issue.id,
    identifier: streamIdentifier,
    state:
      issue.streamIssueState ??
      issue.grandparentIssueState ??
      issue.parentIssueState ??
      issue.state,
    title:
      streamIdentifier === issue.identifier
        ? issue.title
        : streamIdentifier === issue.parentIssueIdentifier
          ? issue.parentIssueTitle
          : streamIdentifier === issue.grandparentIssueIdentifier
            ? issue.grandparentIssueTitle
            : undefined,
  });

  if (isTaskIssue(issue)) {
    return {
      feature: createWorkflowIssueRef({
        id: issue.parentIssueId,
        identifier: issue.parentIssueIdentifier,
        state: issue.parentIssueState,
        title: issue.parentIssueTitle,
      }),
      stream,
      task: current,
    };
  }

  if (issue.parentIssueIdentifier && issue.parentIssueIdentifier !== issue.identifier) {
    return {
      feature: current,
      stream,
    };
  }

  return {
    stream: current ?? stream,
  };
}

export function createWorkerSessionRef(options: {
  issue: AgentIssue;
  parentSessionId?: string;
  rootSessionId: string;
  sessionNumber: number;
  workspace: PreparedWorkspace;
}): AgentSessionRef {
  const { issue, parentSessionId, rootSessionId, sessionNumber, workspace } = options;
  return {
    branchName: workspace.branchName,
    id: `worker:${workspace.workerId}:${sessionNumber}`,
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
    },
    kind: "worker",
    parentSessionId,
    rootSessionId,
    title: issue.title,
    workerId: workspace.workerId,
    workflow: createSessionWorkflow(issue),
    workspacePath: workspace.path,
  };
}
