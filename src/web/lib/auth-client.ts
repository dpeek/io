"use client";

import { createAuthClient } from "better-auth/react";

import { betterAuthBasePath } from "./auth-path.js";

export const authClient = createAuthClient({
  basePath: betterAuthBasePath,
});

type AuthSessionQuery = ReturnType<typeof authClient.useSession>;

export type BetterAuthClientSession = NonNullable<AuthSessionQuery["data"]>;

export type WebAuthViewState =
  | {
      readonly status: "booting";
      readonly authState: "booting";
      readonly session: null;
      readonly sessionId: null;
      readonly userId: null;
      readonly userEmail: null;
      readonly displayName: null;
      readonly errorMessage: null;
      readonly isRefetching: boolean;
    }
  | {
      readonly status: "signed-out";
      readonly authState: "signed-out";
      readonly session: null;
      readonly sessionId: null;
      readonly userId: null;
      readonly userEmail: null;
      readonly displayName: null;
      readonly errorMessage: null;
      readonly isRefetching: boolean;
    }
  | {
      readonly status: "ready";
      readonly authState: "ready";
      readonly session: BetterAuthClientSession;
      readonly sessionId: string;
      readonly userId: string;
      readonly userEmail: string | null;
      readonly displayName: string;
      readonly errorMessage: null;
      readonly isRefetching: boolean;
    }
  | {
      readonly status: "error";
      readonly authState: "signed-out";
      readonly session: null;
      readonly sessionId: null;
      readonly userId: null;
      readonly userEmail: null;
      readonly displayName: null;
      readonly errorMessage: string;
      readonly isRefetching: boolean;
    };

type WebAuthStateInput = {
  readonly data: AuthSessionQuery["data"];
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

export function getWebAuthDisplayName(session: BetterAuthClientSession): string {
  const name = readTrimmedString(session.user.name);
  if (name) {
    return name;
  }

  const email = readTrimmedString(session.user.email);
  if (email) {
    return email;
  }

  return session.user.id;
}

export function readWebAuthState(input: WebAuthStateInput): WebAuthViewState {
  if (input.isPending && !input.data && !input.error) {
    return {
      status: "booting",
      authState: "booting",
      session: null,
      sessionId: null,
      userId: null,
      userEmail: null,
      displayName: null,
      errorMessage: null,
      isRefetching: input.isRefetching,
    };
  }

  if (input.error) {
    return {
      status: "error",
      authState: "signed-out",
      session: null,
      sessionId: null,
      userId: null,
      userEmail: null,
      displayName: null,
      errorMessage: input.error.message || "Unable to load the Better Auth session.",
      isRefetching: input.isRefetching,
    };
  }

  if (!input.data) {
    return {
      status: "signed-out",
      authState: "signed-out",
      session: null,
      sessionId: null,
      userId: null,
      userEmail: null,
      displayName: null,
      errorMessage: null,
      isRefetching: input.isRefetching,
    };
  }

  return {
    status: "ready",
    authState: "ready",
    session: input.data,
    sessionId: input.data.session.id,
    userId: input.data.user.id,
    userEmail: readTrimmedString(input.data.user.email),
    displayName: getWebAuthDisplayName(input.data),
    errorMessage: null,
    isRefetching: input.isRefetching,
  };
}
