import type {
  AuthSubjectRef,
  AuthenticatedSession,
  AuthorizationContext,
  PrincipalKind,
} from "@io/core/graph";

type MaybePromise<T> = T | Promise<T>;

function cloneStringList(values: readonly string[] | undefined): readonly string[] {
  return values ? [...values] : [];
}

/**
 * Stable request-time lookup key for session-to-principal projection. The auth
 * subject tuple, not provider-specific session internals, chooses the graph
 * principal.
 */
export type SessionPrincipalLookupInput = {
  readonly graphId: string;
  readonly subject: AuthSubjectRef;
};

/**
 * Stable resolved principal payload consumed by the request-bound auth bridge.
 * The underlying Better Auth-backed lookup implementation is still
 * provisional.
 */
export type SessionPrincipalProjection = {
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  readonly roleKeys?: readonly string[];
  readonly capabilityGrantIds?: readonly string[];
  readonly capabilityVersion?: number;
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
  } satisfies SessionPrincipalLookupInput;
  const projection = await input.lookupPrincipal(lookupInput);

  if (!projection) {
    throw new SessionPrincipalProjectionError(lookupInput);
  }

  return {
    graphId: input.graphId,
    principalId: projection.principalId,
    principalKind: projection.principalKind,
    sessionId: input.session.sessionId,
    roleKeys: cloneStringList(projection.roleKeys),
    capabilityGrantIds: cloneStringList(projection.capabilityGrantIds),
    capabilityVersion: projection.capabilityVersion ?? 0,
    policyVersion: input.policyVersion,
  };
}
