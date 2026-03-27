import {
  isBearerShareTokenHash,
  type BearerShareLookupInput,
  type SessionPrincipalLookupInput,
} from "./auth-bridge.js";
import type { WebAppAuthority } from "./authority.js";
import {
  WebAppAuthorityBearerShareLookupError,
  WebAppAuthoritySessionPrincipalLookupError,
} from "./authority.js";

export const webGraphAuthorityBearerShareLookupPath = "/_internal/bearer-share";
export const webGraphAuthorityPolicyVersionPath = "/_internal/policy-version";
export const webGraphAuthoritySessionPrincipalActivatePath =
  "/_internal/session-principal/activate";
export const webGraphAuthoritySessionPrincipalLookupPath = "/_internal/session-principal";

class SessionPrincipalLookupRequestError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "SessionPrincipalLookupRequestError";
  }
}

class BearerShareLookupRequestError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "BearerShareLookupRequestError";
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function createNoStoreJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return Response.json(body, { ...init, headers });
}

function createMethodNotAllowedResponse(allow: string): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { allow },
  });
}

function requireNonEmptyRequestString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SessionPrincipalLookupRequestError(
      `Session principal lookup request must include a non-empty "${label}" string.`,
    );
  }

  return value;
}

function requireNonEmptyBearerShareRequestString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BearerShareLookupRequestError(
      `Bearer share lookup request must include a non-empty "${label}" string.`,
    );
  }

  return value;
}

async function readSessionPrincipalLookupInput(
  request: Request,
): Promise<SessionPrincipalLookupInput> {
  let decoded: unknown;
  try {
    decoded = await request.json();
  } catch {
    throw new SessionPrincipalLookupRequestError(
      "Session principal lookup request must be valid JSON.",
    );
  }

  if (!isObjectRecord(decoded)) {
    throw new SessionPrincipalLookupRequestError(
      "Session principal lookup request must be a JSON object.",
    );
  }

  const subject = decoded.subject;
  if (!isObjectRecord(subject)) {
    throw new SessionPrincipalLookupRequestError(
      'Session principal lookup request must include an object "subject".',
    );
  }

  return {
    graphId: requireNonEmptyRequestString(decoded.graphId, "graphId"),
    subject: {
      issuer: requireNonEmptyRequestString(subject.issuer, "subject.issuer"),
      provider: requireNonEmptyRequestString(subject.provider, "subject.provider"),
      providerAccountId: requireNonEmptyRequestString(
        subject.providerAccountId,
        "subject.providerAccountId",
      ),
      authUserId: requireNonEmptyRequestString(subject.authUserId, "subject.authUserId"),
    },
    email:
      typeof decoded.email === "string" && decoded.email.trim().length > 0
        ? decoded.email.trim().toLowerCase()
        : undefined,
  };
}

async function readBearerShareLookupInput(request: Request): Promise<BearerShareLookupInput> {
  let decoded: unknown;
  try {
    decoded = await request.json();
  } catch {
    throw new BearerShareLookupRequestError("Bearer share lookup request must be valid JSON.");
  }

  if (!isObjectRecord(decoded)) {
    throw new BearerShareLookupRequestError("Bearer share lookup request must be a JSON object.");
  }

  const tokenHash = requireNonEmptyBearerShareRequestString(decoded.tokenHash, "tokenHash");
  if (!isBearerShareTokenHash(tokenHash)) {
    throw new BearerShareLookupRequestError(
      "Bearer share lookup request must include a sha256:<64 lowercase hex chars> tokenHash.",
    );
  }

  return {
    graphId: requireNonEmptyBearerShareRequestString(decoded.graphId, "graphId"),
    tokenHash,
  };
}

export function isWebGraphAuthorityInternalPath(pathname: string): boolean {
  return (
    pathname === webGraphAuthorityBearerShareLookupPath ||
    pathname === webGraphAuthorityPolicyVersionPath ||
    pathname === webGraphAuthoritySessionPrincipalActivatePath ||
    pathname === webGraphAuthoritySessionPrincipalLookupPath
  );
}

export async function handleWebGraphAuthorityInternalRequest(
  request: Request,
  pathname: string,
  authority: Promise<WebAppAuthority>,
): Promise<Response> {
  if (pathname === webGraphAuthorityPolicyVersionPath) {
    if (request.method !== "GET") {
      return createMethodNotAllowedResponse("GET");
    }

    return createNoStoreJsonResponse({
      policyVersion: (await authority).getPolicyVersion(),
    });
  }

  if (pathname === webGraphAuthoritySessionPrincipalLookupPath) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse("POST");
    }

    let input: SessionPrincipalLookupInput;
    try {
      input = await readSessionPrincipalLookupInput(request);
    } catch (error) {
      if (error instanceof SessionPrincipalLookupRequestError) {
        return createNoStoreJsonResponse({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    try {
      return createNoStoreJsonResponse(await (await authority).lookupSessionPrincipal(input));
    } catch (error) {
      if (error instanceof WebAppAuthoritySessionPrincipalLookupError) {
        return createNoStoreJsonResponse(
          {
            error: error.message,
            code: error.code,
          },
          { status: error.status },
        );
      }
      throw error;
    }
  }

  if (pathname === webGraphAuthoritySessionPrincipalActivatePath) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse("POST");
    }

    let input: SessionPrincipalLookupInput;
    try {
      input = await readSessionPrincipalLookupInput(request);
    } catch (error) {
      if (error instanceof SessionPrincipalLookupRequestError) {
        return createNoStoreJsonResponse({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    try {
      return createNoStoreJsonResponse(
        await (await authority).activateSessionPrincipalRoleBindings(input),
      );
    } catch (error) {
      if (error instanceof WebAppAuthoritySessionPrincipalLookupError) {
        return createNoStoreJsonResponse(
          {
            error: error.message,
            code: error.code,
          },
          { status: error.status },
        );
      }
      throw error;
    }
  }

  if (pathname === webGraphAuthorityBearerShareLookupPath) {
    if (request.method !== "POST") {
      return createMethodNotAllowedResponse("POST");
    }

    let input: BearerShareLookupInput;
    try {
      input = await readBearerShareLookupInput(request);
    } catch (error) {
      if (error instanceof BearerShareLookupRequestError) {
        return createNoStoreJsonResponse({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    try {
      return createNoStoreJsonResponse(await (await authority).lookupBearerShare(input));
    } catch (error) {
      if (error instanceof WebAppAuthorityBearerShareLookupError) {
        return createNoStoreJsonResponse(
          {
            error: error.message,
            code: error.code,
          },
          { status: error.status },
        );
      }
      throw error;
    }
  }

  return new Response("Not Found", { status: 404 });
}
