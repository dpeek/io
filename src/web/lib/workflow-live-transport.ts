import type { DependencyKey, InvalidationEvent } from "@io/core/graph";

export const webWorkflowLivePath = "/api/workflow-live";

export const workflowLiveRequestKinds = [
  "workflow-review-register",
  "workflow-review-pull",
  "workflow-review-remove",
] as const;

export type WorkflowLiveRequestKind = (typeof workflowLiveRequestKinds)[number];

export type WorkflowReviewLiveRegistration = {
  readonly registrationId: string;
  readonly sessionId: string;
  readonly principalId: string;
  readonly scopeId: string;
  readonly definitionHash: string;
  readonly policyFilterVersion: string;
  readonly dependencyKeys: readonly DependencyKey[];
  readonly expiresAt: string;
};

export type WorkflowReviewLiveRegistrationTarget = Omit<
  WorkflowReviewLiveRegistration,
  "expiresAt" | "registrationId"
>;

export type WorkflowReviewLiveInvalidation = InvalidationEvent;

export type WorkflowReviewPullLiveResult = {
  readonly active: boolean;
  readonly invalidations: readonly WorkflowReviewLiveInvalidation[];
  readonly scopeId: string;
  readonly sessionId: string;
};

export type WorkflowReviewRegisterLiveRequest = {
  readonly kind: "workflow-review-register";
  readonly cursor: string;
};

export type WorkflowReviewPullLiveRequest = {
  readonly kind: "workflow-review-pull";
  readonly scopeId: string;
};

export type WorkflowReviewRemoveLiveRequest = {
  readonly kind: "workflow-review-remove";
  readonly scopeId: string;
};

export type WorkflowLiveRequest =
  | WorkflowReviewRegisterLiveRequest
  | WorkflowReviewPullLiveRequest
  | WorkflowReviewRemoveLiveRequest;

export type WorkflowReviewRegisterLiveResponse = {
  readonly kind: "workflow-review-register";
  readonly result: WorkflowReviewLiveRegistration;
};

export type WorkflowReviewPullLiveResponse = {
  readonly kind: "workflow-review-pull";
  readonly result: WorkflowReviewPullLiveResult;
};

export type WorkflowReviewRemoveLiveResponse = {
  readonly kind: "workflow-review-remove";
  readonly result: {
    readonly removed: boolean;
    readonly scopeId: string;
    readonly sessionId: string;
  };
};

export type WorkflowLiveResponse =
  | WorkflowReviewRegisterLiveResponse
  | WorkflowReviewPullLiveResponse
  | WorkflowReviewRemoveLiveResponse;

type WorkflowLiveResponseFor<TRequest extends WorkflowLiveRequest> =
  TRequest extends WorkflowReviewRegisterLiveRequest
    ? WorkflowReviewRegisterLiveResponse
    : TRequest extends WorkflowReviewPullLiveRequest
      ? WorkflowReviewPullLiveResponse
      : TRequest extends WorkflowReviewRemoveLiveRequest
        ? WorkflowReviewRemoveLiveResponse
        : never;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type WorkflowLiveClientOptions = {
  readonly fetch?: FetchLike;
  readonly path?: string;
  readonly signal?: AbortSignal;
  readonly url?: string;
};

export class WorkflowLiveClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "WorkflowLiveClientError";
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

function resolveWorkflowLiveUrl(options: WorkflowLiveClientOptions): string {
  const path = options.path ?? webWorkflowLivePath;
  return options.url ? new URL(path, options.url).toString() : path;
}

export async function requestWorkflowLive<TRequest extends WorkflowLiveRequest>(
  request: TRequest,
  options: WorkflowLiveClientOptions = {},
): Promise<WorkflowLiveResponseFor<TRequest>> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(resolveWorkflowLiveUrl(options), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  const payload = (await response.json().catch(() => undefined)) as
    | WorkflowLiveResponseFor<TRequest>
    | { readonly code?: string; readonly error?: string }
    | undefined;

  if (!response.ok) {
    throw new WorkflowLiveClientError(
      readErrorMessage(
        response.status,
        response.statusText,
        payload,
        "Workflow live request failed",
      ),
      response.status,
      readErrorCode(payload),
    );
  }

  return payload as WorkflowLiveResponseFor<TRequest>;
}
