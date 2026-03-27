"use client";

import {
  defineWebPrincipalBootstrapPayload,
  type WebPrincipalBootstrapPayload,
  type WebPrincipalSummary,
} from "@io/graph-authority";
import { createAuthClient } from "better-auth/react";

import { betterAuthBasePath } from "./auth-path.js";

export const authClient = createAuthClient({
  basePath: betterAuthBasePath,
});

export const webPrincipalBootstrapPath = "/api/bootstrap";

const webPrincipalBootstrapChangedEvent = "io:web-principal-bootstrap-changed";

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

async function readBootstrapErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { readonly error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // Fall through to the generic response summary.
  }

  return `Unable to load the principal bootstrap (${response.status} ${response.statusText}).`;
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
    throw new Error(await readBootstrapErrorMessage(response));
  }

  return defineWebPrincipalBootstrapPayload(
    (await response.json()) as WebPrincipalBootstrapPayload,
  );
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
