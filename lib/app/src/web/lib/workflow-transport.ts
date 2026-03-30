import type {
  CommitQueueScopeQuery,
  CommitQueueScopeResult,
  ProjectBranchScopeQuery,
  ProjectBranchScopeResult,
} from "@io/graph-module-workflow";

import type {
  WorkflowSessionFeedReadQuery,
  WorkflowSessionFeedReadResult,
} from "./workflow-session-feed-contract.js";

export const webWorkflowReadPath = "/api/workflow-read";

export const workflowReadRequestKinds = [
  "project-branch-scope",
  "commit-queue-scope",
  "session-feed",
] as const;

export type WorkflowReadRequestKind = (typeof workflowReadRequestKinds)[number];

export type ProjectBranchScopeWorkflowReadRequest = {
  readonly kind: "project-branch-scope";
  readonly query: ProjectBranchScopeQuery;
};

export type CommitQueueScopeWorkflowReadRequest = {
  readonly kind: "commit-queue-scope";
  readonly query: CommitQueueScopeQuery;
};

export type WorkflowSessionFeedWorkflowReadRequest = {
  readonly kind: "session-feed";
  readonly query: WorkflowSessionFeedReadQuery;
};

export type WorkflowReadRequest =
  | ProjectBranchScopeWorkflowReadRequest
  | CommitQueueScopeWorkflowReadRequest
  | WorkflowSessionFeedWorkflowReadRequest;

export type ProjectBranchScopeWorkflowReadResponse = {
  readonly kind: "project-branch-scope";
  readonly result: ProjectBranchScopeResult;
};

export type CommitQueueScopeWorkflowReadResponse = {
  readonly kind: "commit-queue-scope";
  readonly result: CommitQueueScopeResult;
};

export type WorkflowSessionFeedWorkflowReadResponse = {
  readonly kind: "session-feed";
  readonly result: WorkflowSessionFeedReadResult;
};

export type WorkflowReadResponse =
  | ProjectBranchScopeWorkflowReadResponse
  | CommitQueueScopeWorkflowReadResponse
  | WorkflowSessionFeedWorkflowReadResponse;

type WorkflowReadResponseFor<TRequest extends WorkflowReadRequest> =
  TRequest extends ProjectBranchScopeWorkflowReadRequest
    ? ProjectBranchScopeWorkflowReadResponse
    : TRequest extends CommitQueueScopeWorkflowReadRequest
      ? CommitQueueScopeWorkflowReadResponse
      : TRequest extends WorkflowSessionFeedWorkflowReadRequest
        ? WorkflowSessionFeedWorkflowReadResponse
        : never;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type WorkflowReadClientOptions = {
  readonly fetch?: FetchLike;
  readonly path?: string;
  readonly signal?: AbortSignal;
  readonly url?: string;
};

export class WorkflowReadClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "WorkflowReadClientError";
    this.status = status;
    this.code = code;
  }
}

function readErrorMessage(
  status: number,
  statusText: string,
  payload: unknown,
  fallback: string,
): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }

  return `${fallback} with ${status} ${statusText}.`;
}

function readErrorCode(payload: unknown): string | undefined {
  return typeof (payload as { code?: unknown })?.code === "string"
    ? (payload as { code: string }).code
    : undefined;
}

function resolveWorkflowReadUrl(options: WorkflowReadClientOptions): string {
  const path = options.path ?? webWorkflowReadPath;
  return options.url ? new URL(path, options.url).toString() : path;
}

export async function requestWorkflowRead<TRequest extends WorkflowReadRequest>(
  request: TRequest,
  options: WorkflowReadClientOptions = {},
): Promise<WorkflowReadResponseFor<TRequest>> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(resolveWorkflowReadUrl(options), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  const payload = (await response.json().catch(() => undefined)) as
    | WorkflowReadResponseFor<TRequest>
    | { readonly code?: string; readonly error?: string }
    | undefined;

  if (!response.ok) {
    throw new WorkflowReadClientError(
      readErrorMessage(response.status, response.statusText, payload, "Workflow read failed"),
      response.status,
      readErrorCode(payload),
    );
  }

  return payload as WorkflowReadResponseFor<TRequest>;
}
