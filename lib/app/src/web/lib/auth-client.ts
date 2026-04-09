"use client";

import {
  defineWebPrincipalBootstrapPayload,
  type WebPrincipalBootstrapPayload,
  type WebPrincipalSummary,
} from "@io/graph-authority";
import { createAuthClient } from "better-auth/react";

import type { SessionPrincipalProjection } from "./auth-bridge.js";
import { betterAuthBasePath } from "./auth-path.js";
import {
  createLocalhostSyntheticEmail,
  defaultLocalhostSyntheticIdentityId,
  defineLocalhostBootstrapCredential,
  isLocalhostOrigin,
  localhostBootstrapIssuePath,
  localhostBootstrapRedeemPath,
  type LocalhostBootstrapCredential,
} from "./local-bootstrap.js";

export const authClient = createAuthClient({
  basePath: betterAuthBasePath,
});

export const webPrincipalBootstrapPath = "/api/bootstrap";
export const webGraphAccessActivationPath = "/api/access/activate";
export const webGraphCommandsPath = "/api/commands";

const webPrincipalBootstrapChangedEvent = "io:web-principal-bootstrap-changed";
const localhostSyntheticBootstrapEmail = createLocalhostSyntheticEmail(
  defaultLocalhostSyntheticIdentityId,
);

type BootstrapFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type WebAuthViewState =
  | {
      readonly status: "booting";
      readonly authState: "booting";
      readonly bootstrap: null;
      readonly principal: null;
      readonly sessionId: null;
      readonly principalId: null;
      readonly capabilityVersion: null;
      readonly displayName: null;
      readonly errorMessage: null;
      readonly isRefetching: boolean;
    }
  | {
      readonly status: "signed-out";
      readonly authState: "signed-out";
      readonly bootstrap: WebPrincipalBootstrapPayload;
      readonly principal: null;
      readonly sessionId: null;
      readonly principalId: null;
      readonly capabilityVersion: null;
      readonly displayName: null;
      readonly errorMessage: null;
      readonly isRefetching: boolean;
    }
  | {
      readonly status: "expired";
      readonly authState: "expired";
      readonly bootstrap: WebPrincipalBootstrapPayload;
      readonly principal: null;
      readonly sessionId: null;
      readonly principalId: null;
      readonly capabilityVersion: null;
      readonly displayName: null;
      readonly errorMessage: null;
      readonly isRefetching: boolean;
    }
  | {
      readonly status: "ready";
      readonly authState: "ready";
      readonly bootstrap: WebPrincipalBootstrapPayload;
      readonly principal: WebPrincipalSummary;
      readonly sessionId: string;
      readonly principalId: string;
      readonly capabilityVersion: number;
      readonly displayName: string | null;
      readonly errorMessage: null;
      readonly isRefetching: boolean;
    }
  | {
      readonly status: "error";
      readonly authState: "booting";
      readonly bootstrap: null;
      readonly principal: null;
      readonly sessionId: null;
      readonly principalId: null;
      readonly capabilityVersion: null;
      readonly displayName: null;
      readonly errorMessage: string;
      readonly isRefetching: boolean;
    };

type WebAuthStateInput = {
  readonly data: WebPrincipalBootstrapPayload | null;
  readonly error: { readonly message?: string } | null;
  readonly isPending: boolean;
  readonly isRefetching: boolean;
};

type WebAuthErrorPayload = {
  readonly code?: unknown;
  readonly error?: unknown;
  readonly message?: unknown;
};

export class WebAuthRequestError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(
    message: string,
    input: {
      readonly code?: string;
      readonly status: number;
    },
  ) {
    super(message);
    this.name = "WebAuthRequestError";
    this.code = input.code;
    this.status = input.status;
  }
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readWebPrincipalDisplayName(
  payload: Pick<WebPrincipalBootstrapPayload, "session">,
): string | null {
  return readTrimmedString(payload.session.displayName);
}

async function readResponseError(
  response: Response,
  fallback: string,
): Promise<WebAuthRequestError> {
  let payload: WebAuthErrorPayload | undefined;

  try {
    payload = (await response.json()) as WebAuthErrorPayload;
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return new WebAuthRequestError(payload.error, {
        code: typeof payload.code === "string" ? payload.code : undefined,
        status: response.status,
      });
    }
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return new WebAuthRequestError(payload.message, {
        code: typeof payload.code === "string" ? payload.code : undefined,
        status: response.status,
      });
    }
  } catch {
    // Fall through to the generic response summary.
  }

  return new WebAuthRequestError(`${fallback} (${response.status} ${response.statusText}).`, {
    code: typeof payload?.code === "string" ? payload.code : undefined,
    status: response.status,
  });
}

export async function fetchWebPrincipalBootstrap(
  input: {
    readonly fetcher?: BootstrapFetch;
    readonly path?: string;
    readonly request?: RequestInit;
  } = {},
): Promise<WebPrincipalBootstrapPayload> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(input.path ?? webPrincipalBootstrapPath, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    ...input.request,
  });

  if (!response.ok) {
    throw await readResponseError(response, "Unable to load the principal bootstrap");
  }

  return defineWebPrincipalBootstrapPayload(
    (await response.json()) as WebPrincipalBootstrapPayload,
  );
}

export async function issueLocalhostBootstrapCredential(
  input: {
    readonly fetcher?: BootstrapFetch;
    readonly path?: string;
    readonly request?: RequestInit;
  } = {},
): Promise<LocalhostBootstrapCredential> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(input.path ?? localhostBootstrapIssuePath, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    ...input.request,
  });

  if (!response.ok) {
    throw await readResponseError(response, "Unable to issue the localhost bootstrap credential");
  }

  return defineLocalhostBootstrapCredential(
    (await response.json()) as LocalhostBootstrapCredential,
  );
}

export async function redeemLocalhostBootstrapCredential(input: {
  readonly fetcher?: BootstrapFetch;
  readonly path?: string;
  readonly request?: RequestInit;
  readonly token: string;
}): Promise<void> {
  const fetcher = input.fetcher ?? fetch;
  const headers = new Headers(input.request?.headers);
  headers.set("content-type", "application/json");
  const response = await fetcher(input.path ?? localhostBootstrapRedeemPath, {
    ...input.request,
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: JSON.stringify({
      token: input.token,
    }),
  });

  if (!response.ok) {
    throw await readResponseError(response, "Unable to redeem the localhost bootstrap credential");
  }
}

export async function startLocalhostBootstrapSession(
  input: {
    readonly fetcher?: BootstrapFetch;
    readonly issuePath?: string;
    readonly issueRequest?: RequestInit;
    readonly redeemPath?: string;
    readonly redeemRequest?: RequestInit;
  } = {},
): Promise<LocalhostBootstrapCredential> {
  const credential = await issueLocalhostBootstrapCredential({
    fetcher: input.fetcher,
    path: input.issuePath,
    request: input.issueRequest,
  });
  await redeemLocalhostBootstrapCredential({
    fetcher: input.fetcher,
    path: input.redeemPath,
    request: input.redeemRequest,
    token: credential.token,
  });
  return credential;
}

export function hasWritableGraphAccess(
  summary: Pick<WebPrincipalSummary, "access"> | SessionPrincipalProjection["summary"],
): boolean {
  return summary.access.authority || summary.access.graphMember;
}

function isLocalSyntheticBootstrapPayload(payload: WebPrincipalBootstrapPayload): boolean {
  return (
    payload.session.authState === "ready" &&
    readWebPrincipalDisplayName(payload) === localhostSyntheticBootstrapEmail
  );
}

export async function activateGraphAccess(
  input: {
    readonly fetcher?: BootstrapFetch;
    readonly path?: string;
    readonly request?: RequestInit;
  } = {},
): Promise<SessionPrincipalProjection> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(input.path ?? webGraphAccessActivationPath, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    ...input.request,
  });

  if (!response.ok) {
    throw await readResponseError(response, "Unable to activate graph access");
  }

  return (await response.json()) as SessionPrincipalProjection;
}

export async function bootstrapLocalhostOperatorAccess(
  input: {
    readonly email?: string;
    readonly fetcher?: BootstrapFetch;
    readonly path?: string;
    readonly request?: RequestInit;
  } = {},
): Promise<void> {
  const fetcher = input.fetcher ?? fetch;
  const headers = new Headers(input.request?.headers);
  headers.set("content-type", "application/json");
  const response = await fetcher(input.path ?? webGraphCommandsPath, {
    ...input.request,
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers,
    body: JSON.stringify({
      kind: "bootstrap-operator-access",
      input: {
        email: input.email ?? localhostSyntheticBootstrapEmail,
        graphId: "graph:global",
      },
    }),
  });

  if (!response.ok) {
    throw await readResponseError(response, "Unable to bootstrap local operator access");
  }
}

async function fetchActivatedLocalhostBootstrap(input: {
  readonly activationPath?: string;
  readonly activationRequest?: RequestInit;
  readonly bootstrapPath?: string;
  readonly bootstrapRequest?: RequestInit;
  readonly fetcher?: BootstrapFetch;
}): Promise<WebPrincipalBootstrapPayload> {
  const activated = await activateGraphAccess({
    fetcher: input.fetcher,
    path: input.activationPath,
    request: input.activationRequest,
  });

  if (!hasWritableGraphAccess(activated.summary)) {
    throw new Error(
      "Localhost instant onboarding could not determine a unique writable graph access path.",
    );
  }

  return fetchWebPrincipalBootstrap({
    fetcher: input.fetcher,
    path: input.bootstrapPath,
    request: input.bootstrapRequest,
  });
}

export async function completeLocalhostOnboarding(
  input: {
    readonly activationPath?: string;
    readonly activationRequest?: RequestInit;
    readonly bootstrapPath?: string;
    readonly bootstrapRequest?: RequestInit;
    readonly commandPath?: string;
    readonly commandRequest?: RequestInit;
    readonly fetcher?: BootstrapFetch;
    readonly issuePath?: string;
    readonly issueRequest?: RequestInit;
    readonly origin?: string;
    readonly redeemPath?: string;
    readonly redeemRequest?: RequestInit;
  } = {},
): Promise<WebPrincipalBootstrapPayload> {
  const origin = input.origin;
  if (!origin || !isLocalhostOrigin(origin)) {
    throw new Error("Localhost instant onboarding is only available on localhost origins.");
  }

  await startLocalhostBootstrapSession({
    fetcher: input.fetcher,
    issuePath: input.issuePath,
    issueRequest: input.issueRequest,
    redeemPath: input.redeemPath,
    redeemRequest: input.redeemRequest,
  });

  let bootstrap: WebPrincipalBootstrapPayload;
  try {
    bootstrap = await fetchWebPrincipalBootstrap({
      fetcher: input.fetcher,
      path: input.bootstrapPath,
      request: input.bootstrapRequest,
    });
  } catch (error) {
    if (!(error instanceof WebAuthRequestError) || error.code !== "auth.principal_missing") {
      throw error;
    }

    await bootstrapLocalhostOperatorAccess({
      fetcher: input.fetcher,
      path: input.commandPath,
      request: input.commandRequest,
    });
    return fetchActivatedLocalhostBootstrap({
      activationPath: input.activationPath,
      activationRequest: input.activationRequest,
      bootstrapPath: input.bootstrapPath,
      bootstrapRequest: input.bootstrapRequest,
      fetcher: input.fetcher,
    });
  }

  if (bootstrap.session.authState !== "ready") {
    throw new Error("Localhost instant onboarding did not establish a ready browser session.");
  }

  if (!isLocalSyntheticBootstrapPayload(bootstrap)) {
    return bootstrap;
  }

  if (!bootstrap.principal) {
    throw new TypeError(
      'Authenticated bootstrap payloads must include both "session.sessionId" and "principal".',
    );
  }

  if (hasWritableGraphAccess(bootstrap.principal)) {
    return bootstrap;
  }

  const activated = await activateGraphAccess({
    fetcher: input.fetcher,
    path: input.activationPath,
    request: input.activationRequest,
  });

  if (hasWritableGraphAccess(activated.summary)) {
    return fetchWebPrincipalBootstrap({
      fetcher: input.fetcher,
      path: input.bootstrapPath,
      request: input.bootstrapRequest,
    });
  }

  await bootstrapLocalhostOperatorAccess({
    fetcher: input.fetcher,
    path: input.commandPath,
    request: input.commandRequest,
  });
  return fetchActivatedLocalhostBootstrap({
    activationPath: input.activationPath,
    activationRequest: input.activationRequest,
    bootstrapPath: input.bootstrapPath,
    bootstrapRequest: input.bootstrapRequest,
    fetcher: input.fetcher,
  });
}

export async function resolveWebPrincipalBootstrap(
  input: {
    readonly bootstrapPath?: string;
    readonly bootstrapRequest?: RequestInit;
    readonly fetcher?: BootstrapFetch;
  } = {},
): Promise<WebPrincipalBootstrapPayload> {
  return fetchWebPrincipalBootstrap({
    fetcher: input.fetcher,
    path: input.bootstrapPath,
    request: input.bootstrapRequest,
  });
}

export function notifyWebPrincipalBootstrapChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(webPrincipalBootstrapChangedEvent));
}

export function subscribeWebPrincipalBootstrapChanged(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => {
    callback();
  };
  window.addEventListener(webPrincipalBootstrapChangedEvent, handler);
  return () => {
    window.removeEventListener(webPrincipalBootstrapChangedEvent, handler);
  };
}

export function readWebAuthState(input: WebAuthStateInput): WebAuthViewState {
  if (input.isPending && !input.data && !input.error) {
    return {
      status: "booting",
      authState: "booting",
      bootstrap: null,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: input.isRefetching,
    };
  }

  if (input.error) {
    return {
      status: "error",
      authState: "booting",
      bootstrap: null,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: input.error.message || "Unable to load the principal bootstrap.",
      isRefetching: input.isRefetching,
    };
  }

  if (!input.data) {
    return {
      status: "signed-out",
      authState: "signed-out",
      bootstrap: defineWebPrincipalBootstrapPayload({
        session: {
          authState: "signed-out",
          sessionId: null,
          principalId: null,
          capabilityVersion: null,
        },
        principal: null,
      }),
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: input.isRefetching,
    };
  }

  if (input.data.session.authState === "expired") {
    return {
      status: "expired",
      authState: "expired",
      bootstrap: input.data,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: input.isRefetching,
    };
  }

  if (input.data.session.authState === "signed-out") {
    return {
      status: "signed-out",
      authState: "signed-out",
      bootstrap: input.data,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: input.isRefetching,
    };
  }

  if (input.data.principal === null || input.data.session.sessionId === null) {
    throw new TypeError(
      'Authenticated bootstrap payloads must include both "session.sessionId" and "principal".',
    );
  }

  return {
    status: "ready",
    authState: "ready",
    bootstrap: input.data,
    principal: input.data.principal,
    sessionId: input.data.session.sessionId,
    principalId: input.data.principal.principalId,
    capabilityVersion: input.data.principal.capabilityVersion,
    displayName: readWebPrincipalDisplayName(input.data),
    errorMessage: null,
    isRefetching: input.isRefetching,
  };
}
