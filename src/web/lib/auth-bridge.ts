import {
  type AuthSubjectRef,
  type AuthenticatedSession,
  type AuthorizationContext,
  type PrincipalKind,
  type WebPrincipalSummary,
} from "@io/core/graph";

type MaybePromise<T> = T | Promise<T>;

const bearerShareTokenPrefix = "io_share_";
const bearerShareTokenPattern = /^io_share_[0-9a-f]{64}$/;
const bearerShareTokenHashPattern = /^sha256:[0-9a-f]{64}$/;

function cloneStringList(values: readonly string[] | undefined): readonly string[] {
  return values ? [...values] : [];
}

function readNonEmptyStringField(value: unknown, label: "session.id" | "user.id"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BetterAuthSessionReductionError(
      `Better Auth session payload must include a non-empty "${label}" string.`,
    );
  }

  return value;
}

function readOptionalEmailField(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new BetterAuthSessionReductionError(
      'Better Auth session payload must include a string "user.email" when present.',
    );
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

export type BetterAuthSessionResult = {
  readonly session: {
    readonly id: string;
  };
  readonly user: {
    readonly id: string;
    readonly email?: string | null;
  };
};

/**
 * Stable request-time lookup key for session-to-principal projection. The auth
 * subject tuple, not provider-specific session internals, chooses the graph
 * principal.
 */
export type SessionPrincipalLookupInput = {
  readonly graphId: string;
  readonly subject: AuthSubjectRef;
  readonly email?: string;
};

/**
 * Stable resolved principal payload consumed by the request-bound auth bridge.
 * The underlying Better Auth-backed lookup implementation is still
 * provisional. In the current Branch 2 proof, `capabilityGrantIds` carries
 * only active principal-target grants; bearer and graph-target grants remain
 * durable-but-provisional records outside the session projection.
 */
export type SessionPrincipalProjection = {
  readonly summary: WebPrincipalSummary;
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  readonly roleKeys?: readonly string[];
  readonly capabilityGrantIds?: readonly string[];
  readonly capabilityVersion?: number;
};

export type BearerShareLookupInput = {
  readonly graphId: string;
  readonly tokenHash: string;
};

export type BearerShareProjection = {
  readonly capabilityGrantIds: readonly string[];
};

/**
 * Stable web authority seam. Host-specific request parsing remains
 * provisional; this contract starts once a request has been reduced to the
 * shared authenticated-session shape.
 */
export type ProjectSessionToPrincipalInput = {
  readonly graphId: string;
  readonly policyVersion: number;
  readonly session: AuthenticatedSession | null;
  readonly lookupPrincipal: (
    input: SessionPrincipalLookupInput,
  ) => MaybePromise<SessionPrincipalProjection | null>;
};

export type CreateWorkerAuthorizationContextInput = Omit<
  ProjectSessionToPrincipalInput,
  "session"
> & {
  readonly betterAuthSession: BetterAuthSessionResult | null;
};

export type ProjectBearerShareTokenInput = {
  readonly graphId: string;
  readonly policyVersion: number;
  readonly token: string;
  readonly lookupBearerShare: (
    input: BearerShareLookupInput,
  ) => MaybePromise<BearerShareProjection | null>;
};

export class BetterAuthSessionReductionError extends Error {
  readonly code = "auth.session_invalid" as const;
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "BetterAuthSessionReductionError";
  }
}

export class SessionPrincipalProjectionError extends Error {
  readonly code = "auth.principal_missing" as const;
  readonly graphId: string;
  readonly subject: AuthSubjectRef;

  constructor(input: SessionPrincipalLookupInput) {
    super(
      `No graph principal projection exists for subject "${input.subject.issuer}:${input.subject.provider}:${input.subject.providerAccountId}" in graph "${input.graphId}".`,
    );
    this.name = "SessionPrincipalProjectionError";
    this.graphId = input.graphId;
    this.subject = input.subject;
  }
}

export class BearerShareTokenProjectionError extends Error {
  readonly code = "grant.invalid" as const;
  readonly graphId: string;

  constructor(input: { readonly graphId: string }) {
    super(`No active bearer share grant exists for graph "${input.graphId}".`);
    this.name = "BearerShareTokenProjectionError";
    this.graphId = input.graphId;
  }
}

export function createAnonymousAuthorizationContext(input: {
  readonly graphId: string;
  readonly policyVersion: number;
}): AuthorizationContext {
  return {
    graphId: input.graphId,
    principalId: null,
    principalKind: null,
    sessionId: null,
    roleKeys: [],
    capabilityGrantIds: [],
    capabilityVersion: 0,
    policyVersion: input.policyVersion,
  };
}

export function isBearerShareToken(token: string): boolean {
  return bearerShareTokenPattern.test(token);
}

export function isBearerShareTokenHash(tokenHash: string): boolean {
  return bearerShareTokenHashPattern.test(tokenHash);
}

function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function hashBearerShareToken(token: string): Promise<string> {
  if (!isBearerShareToken(token)) {
    throw new Error(
      "Bearer share tokens must use the issued io_share_<64 lowercase hex chars> format.",
    );
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `sha256:${encodeHex(new Uint8Array(digest))}`;
}

export async function issueBearerShareToken(): Promise<{
  readonly token: string;
  readonly tokenHash: string;
}> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = `${bearerShareTokenPrefix}${encodeHex(bytes)}`;

  return {
    token,
    tokenHash: await hashBearerShareToken(token),
  };
}

export function createBearerShareAuthorizationContext(input: {
  readonly graphId: string;
  readonly policyVersion: number;
  readonly capabilityGrantIds: readonly string[];
}): AuthorizationContext {
  return {
    graphId: input.graphId,
    principalId: null,
    principalKind: "anonymous",
    sessionId: null,
    roleKeys: [],
    capabilityGrantIds: [...input.capabilityGrantIds],
    capabilityVersion: 0,
    policyVersion: input.policyVersion,
  };
}

export function reduceBetterAuthSession(
  session: BetterAuthSessionResult | null,
): AuthenticatedSession | null {
  if (!session) {
    return null;
  }

  const sessionId = readNonEmptyStringField(session.session?.id, "session.id");
  const userId = readNonEmptyStringField(session.user?.id, "user.id");

  return {
    sessionId,
    subject: {
      issuer: "better-auth",
      provider: "user",
      providerAccountId: userId,
      authUserId: userId,
    },
    email: readOptionalEmailField(session.user?.email),
  };
}

export async function projectSessionToPrincipal(
  input: ProjectSessionToPrincipalInput,
): Promise<AuthorizationContext> {
  if (!input.session) {
    return createAnonymousAuthorizationContext({
      graphId: input.graphId,
      policyVersion: input.policyVersion,
    });
  }

  const lookupInput = {
    graphId: input.graphId,
    subject: input.session.subject,
    email: input.session.email,
  } satisfies SessionPrincipalLookupInput;
  const projection = await input.lookupPrincipal(lookupInput);

  if (!projection) {
    throw new SessionPrincipalProjectionError(lookupInput);
  }

  return {
    graphId: input.graphId,
    principalId: projection.summary.principalId,
    principalKind: projection.summary.principalKind,
    sessionId: input.session.sessionId,
    roleKeys: cloneStringList(projection.summary.roleKeys),
    capabilityGrantIds: cloneStringList(projection.summary.capabilityGrantIds),
    capabilityVersion: projection.summary.capabilityVersion,
    policyVersion: input.policyVersion,
  };
}

export async function projectBearerShareToken(
  input: ProjectBearerShareTokenInput,
): Promise<AuthorizationContext> {
  const projection = await input.lookupBearerShare({
    graphId: input.graphId,
    tokenHash: await hashBearerShareToken(input.token),
  });

  if (!projection || projection.capabilityGrantIds.length === 0) {
    throw new BearerShareTokenProjectionError({
      graphId: input.graphId,
    });
  }

  return createBearerShareAuthorizationContext({
    graphId: input.graphId,
    policyVersion: input.policyVersion,
    capabilityGrantIds: projection.capabilityGrantIds,
  });
}

export function createWorkerAuthorizationContext(
  input: CreateWorkerAuthorizationContextInput,
): Promise<AuthorizationContext> {
  return projectSessionToPrincipal({
    graphId: input.graphId,
    policyVersion: input.policyVersion,
    session: reduceBetterAuthSession(input.betterAuthSession),
    lookupPrincipal: input.lookupPrincipal,
  });
}
