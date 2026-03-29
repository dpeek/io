export const defaultBrowserAgentOrigin = "http://127.0.0.1:4317";
export const browserAgentHealthPath = "/health";
export const browserAgentLaunchPath = "/launch-session";
export const browserAgentActiveSessionPath = "/active-session";

export type CodexSessionKind = "planning" | "execution" | "review";

export type CodexSessionLaunchSubject =
  | { readonly kind: "branch"; readonly branchId: string }
  | { readonly kind: "commit"; readonly branchId: string; readonly commitId: string };

export type CodexSessionLaunchPreference =
  | { readonly mode: "launch-new" }
  | { readonly mode: "attach-or-launch" }
  | { readonly mode: "attach-existing" };

export interface CodexSessionLaunchActor {
  readonly principalId: string;
  readonly sessionId: string;
  readonly surface: "tui" | "browser";
}

export interface CodexSessionLaunchLease {
  readonly actor: CodexSessionLaunchActor;
  readonly allowedActions: readonly [
    "launch-session",
    "attach-session",
    "append-session-events",
    "write-artifact",
    "write-decision",
  ];
  readonly expiresAt: string;
  readonly issuedAt: string;
  readonly kind: CodexSessionKind;
  readonly leaseId: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly subject: CodexSessionLaunchSubject;
}

export interface CodexSessionLaunchRequest {
  readonly actor: CodexSessionLaunchActor;
  readonly delegation?: {
    readonly lease: CodexSessionLaunchLease;
  };
  readonly kind: CodexSessionKind;
  readonly preference?: CodexSessionLaunchPreference;
  readonly projectId: string;
  readonly selection?: {
    readonly branchId?: string;
    readonly commitId?: string;
    readonly projectId?: string;
  };
  readonly subject: CodexSessionLaunchSubject;
}

export interface CodexSessionSummary {
  readonly id: string;
  readonly kind: CodexSessionKind;
  readonly runtimeState:
    | "starting"
    | "running"
    | "awaiting-user-input"
    | "blocked"
    | "completed"
    | "failed"
    | "cancelled";
  readonly sessionKey: string;
  readonly startedAt: string;
  readonly subject: CodexSessionLaunchSubject;
}

export interface CodexSessionAttachHandle {
  readonly attachToken: string;
  readonly browserAgentSessionId: string;
  readonly expiresAt: string;
  readonly transport: "browser-agent-http";
}

export interface CodexSessionWorkspaceBinding {
  readonly repositoryBranchName?: string;
  readonly repositoryId: string;
  readonly repositoryRoot?: string;
  readonly workspaceLeaseId?: string;
  readonly worktreePath?: string;
}

export interface CodexSessionAuthorityGrant {
  readonly allowedActions: readonly ["append-session-events", "write-artifact", "write-decision"];
  readonly expiresAt: string;
  readonly grantId: string;
  readonly grantToken: string;
  readonly issuedAt: string;
  readonly sessionId: string;
}

export interface CodexSessionLaunchSuccess {
  readonly attach: CodexSessionAttachHandle;
  readonly authority: {
    readonly appendGrant: CodexSessionAuthorityGrant;
    readonly auditActorPrincipalId: string;
  };
  readonly ok: true;
  readonly outcome: "launched" | "attached";
  readonly reuse?: {
    readonly reason: "active-session" | "explicit-attach";
    readonly reusedSessionId: string;
  };
  readonly session: CodexSessionSummary;
  readonly workspace: CodexSessionWorkspaceBinding;
}

export const codexSessionLaunchFailureCodes = [
  "policy-denied",
  "launch-lease-expired",
  "session-not-found",
  "subject-locked",
  "workspace-unavailable",
  "repository-branch-missing",
  "repository-mismatch",
  "local-bridge-unavailable",
] as const;

export type CodexSessionLaunchFailureCode = (typeof codexSessionLaunchFailureCodes)[number];

export interface CodexSessionLaunchFailure {
  readonly code: CodexSessionLaunchFailureCode;
  readonly details?: {
    readonly activeSessionId?: string;
    readonly activeSessionKey?: string;
    readonly expectedRepositoryId?: string;
    readonly leaseExpiresAt?: string;
    readonly observedRepositoryId?: string;
  };
  readonly message: string;
  readonly ok: false;
  readonly retryable: boolean;
  readonly source: "browser" | "browser-agent" | "authority";
}

export type CodexSessionLaunchResult = CodexSessionLaunchSuccess | CodexSessionLaunchFailure;

export interface BrowserAgentActiveSessionLookupRequest {
  readonly actor: CodexSessionLaunchActor;
  readonly kind: CodexSessionKind;
  readonly projectId: string;
  readonly subject: CodexSessionLaunchSubject;
}

export type BrowserAgentActiveSessionLookupResult =
  | {
      readonly attach: CodexSessionAttachHandle;
      readonly found: true;
      readonly ok: true;
      readonly session: CodexSessionSummary;
      readonly workspace: CodexSessionWorkspaceBinding;
    }
  | {
      readonly found: false;
      readonly ok: true;
    };

export interface BrowserAgentHealthResponse {
  readonly ok: true;
  readonly runtime: {
    readonly activeSessionLookupPath: string;
    readonly launchPath: string;
    readonly startedAt: string;
    readonly status: "ready" | "unavailable";
    readonly statusMessage: string;
    readonly version: 1;
  };
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type BrowserAgentTransportOptions = {
  readonly fetch?: FetchLike;
  readonly origin?: string;
  readonly signal?: AbortSignal;
};

export class BrowserAgentTransportError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "BrowserAgentTransportError";
    this.status = status;
    this.code = code;
  }
}

function resolveBrowserAgentUrl(path: string, options: BrowserAgentTransportOptions): string {
  return new URL(path, options.origin ?? defaultBrowserAgentOrigin).toString();
}

async function readTransportPayload(response: Response) {
  return (await response.json().catch(() => undefined)) as
    | { readonly code?: string; readonly error?: string }
    | undefined;
}

function readTransportError(
  response: Response,
  payload: unknown,
  fallback: string,
): BrowserAgentTransportError {
  const code =
    typeof (payload as { code?: unknown })?.code === "string"
      ? (payload as { code: string }).code
      : undefined;
  const message =
    typeof (payload as { error?: unknown })?.error === "string"
      ? (payload as { error: string }).error
      : `${fallback} with ${response.status} ${response.statusText}.`;
  return new BrowserAgentTransportError(message, response.status, code);
}

async function requestBrowserAgentJson<TResponse>(
  path: string,
  init: RequestInit,
  options: BrowserAgentTransportOptions,
  fallback: string,
): Promise<TResponse> {
  const fetchImpl = options.fetch ?? fetch;
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) {
    headers.set("content-type", "application/json");
  }
  const response = await fetchImpl(resolveBrowserAgentUrl(path, options), {
    ...init,
    headers,
    signal: options.signal,
  });
  const payload = await readTransportPayload(response);
  if (!response.ok) {
    throw readTransportError(response, payload, fallback);
  }
  return payload as TResponse;
}

export async function requestBrowserAgentHealth(
  options: BrowserAgentTransportOptions = {},
): Promise<BrowserAgentHealthResponse> {
  return requestBrowserAgentJson<BrowserAgentHealthResponse>(
    browserAgentHealthPath,
    { method: "GET" },
    options,
    "Browser-agent health probe failed",
  );
}

export async function requestBrowserAgentLaunch(
  request: CodexSessionLaunchRequest,
  options: BrowserAgentTransportOptions = {},
): Promise<CodexSessionLaunchResult> {
  try {
    return await requestBrowserAgentJson<CodexSessionLaunchResult>(
      browserAgentLaunchPath,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
      options,
      "Browser-agent launch request failed",
    );
  } catch (error) {
    if (error instanceof BrowserAgentTransportError && error.code !== "local-bridge-unavailable") {
      throw error;
    }
    return {
      code: "local-bridge-unavailable",
      message:
        error instanceof BrowserAgentTransportError
          ? error.message
          : "The local browser-agent runtime is unavailable. Start `io browser-agent` on this machine and retry.",
      ok: false,
      retryable: true,
      source: "browser",
    };
  }
}

export async function requestBrowserAgentActiveSessionLookup(
  request: BrowserAgentActiveSessionLookupRequest,
  options: BrowserAgentTransportOptions = {},
): Promise<BrowserAgentActiveSessionLookupResult | CodexSessionLaunchFailure> {
  try {
    return await requestBrowserAgentJson<BrowserAgentActiveSessionLookupResult>(
      browserAgentActiveSessionPath,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
      options,
      "Browser-agent active-session lookup failed",
    );
  } catch (error) {
    if (error instanceof BrowserAgentTransportError && error.code !== "local-bridge-unavailable") {
      throw error;
    }
    return {
      code: "local-bridge-unavailable",
      message:
        error instanceof BrowserAgentTransportError
          ? error.message
          : "The local browser-agent runtime is unavailable. Start `io browser-agent` on this machine and retry.",
      ok: false,
      retryable: true,
      source: "browser",
    };
  }
}

export type BrowserAgentRuntimeProbe =
  | {
      readonly launchPath: string;
      readonly message: string;
      readonly startedAt: string;
      readonly status: "ready";
    }
  | {
      readonly message: string;
      readonly status: "checking" | "unavailable";
    };

export async function probeBrowserAgentRuntime(
  options: BrowserAgentTransportOptions = {},
): Promise<BrowserAgentRuntimeProbe> {
  try {
    const response = await requestBrowserAgentHealth(options);
    if (response.runtime.status === "ready") {
      return {
        launchPath: response.runtime.launchPath,
        message: response.runtime.statusMessage,
        startedAt: response.runtime.startedAt,
        status: "ready",
      };
    }
    return {
      message: response.runtime.statusMessage,
      status: "unavailable",
    };
  } catch {
    return {
      message:
        "Local browser-agent runtime unavailable. Start `io browser-agent` on this machine to enable browser launch and attach.",
      status: "unavailable",
    };
  }
}
