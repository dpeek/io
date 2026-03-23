import {
  GraphValidationError,
  type AuthorizationContext,
  type GraphWriteTransaction,
} from "@io/core/graph";

import type {
  WebAppAuthority,
  WebAppAuthorityCommand,
  WebAppAuthorityCommandResult,
} from "./authority.js";

const supportedPrincipalKinds = new Set([
  "human",
  "service",
  "agent",
  "anonymous",
  "remoteGraph",
] satisfies readonly NonNullable<AuthorizationContext["principalKind"]>[]);

export const webAppAuthorizationContextHeader = "x-io-authorization-context";

export class RequestAuthorizationContextError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "RequestAuthorizationContextError";
  }
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseRequestAuthorizationContext(value: unknown): AuthorizationContext {
  if (!value || typeof value !== "object") {
    throw new RequestAuthorizationContextError("Request authorization context must be an object.");
  }

  const candidate = value as Partial<AuthorizationContext>;
  if (typeof candidate.graphId !== "string" || candidate.graphId.trim().length === 0) {
    throw new RequestAuthorizationContextError(
      'Request authorization context must include a non-empty "graphId".',
    );
  }
  if (!isNullableString(candidate.principalId)) {
    throw new RequestAuthorizationContextError(
      'Request authorization context must include a string or null "principalId".',
    );
  }
  if (
    candidate.principalKind !== null &&
    (typeof candidate.principalKind !== "string" ||
      !supportedPrincipalKinds.has(candidate.principalKind))
  ) {
    throw new RequestAuthorizationContextError(
      'Request authorization context must include a supported "principalKind" or null.',
    );
  }
  if (!isNullableString(candidate.sessionId)) {
    throw new RequestAuthorizationContextError(
      'Request authorization context must include a string or null "sessionId".',
    );
  }
  if (!isStringList(candidate.roleKeys)) {
    throw new RequestAuthorizationContextError(
      'Request authorization context must include a string array "roleKeys".',
    );
  }
  if (!isStringList(candidate.capabilityGrantIds)) {
    throw new RequestAuthorizationContextError(
      'Request authorization context must include a string array "capabilityGrantIds".',
    );
  }
  const capabilityVersion = candidate.capabilityVersion;
  if (typeof capabilityVersion !== "number" || !Number.isInteger(capabilityVersion)) {
    throw new RequestAuthorizationContextError(
      'Request authorization context must include an integer "capabilityVersion".',
    );
  }
  const policyVersion = candidate.policyVersion;
  if (typeof policyVersion !== "number" || !Number.isInteger(policyVersion)) {
    throw new RequestAuthorizationContextError(
      'Request authorization context must include an integer "policyVersion".',
    );
  }

  return {
    graphId: candidate.graphId,
    principalId: candidate.principalId,
    principalKind: candidate.principalKind,
    sessionId: candidate.sessionId,
    roleKeys: [...candidate.roleKeys],
    capabilityGrantIds: [...candidate.capabilityGrantIds],
    capabilityVersion,
    policyVersion,
  };
}

export function encodeRequestAuthorizationContext(authorization: AuthorizationContext): string {
  return encodeURIComponent(JSON.stringify(authorization));
}

export function readRequestAuthorizationContext(request: Request): AuthorizationContext {
  const encodedAuthorization = request.headers.get(webAppAuthorizationContextHeader);
  if (!encodedAuthorization) {
    throw new RequestAuthorizationContextError("Request authorization context header is required.");
  }

  let decodedAuthorization: unknown;
  try {
    decodedAuthorization = JSON.parse(decodeURIComponent(encodedAuthorization));
  } catch {
    throw new RequestAuthorizationContextError(
      "Request authorization context header is not valid encoded JSON.",
    );
  }

  return parseRequestAuthorizationContext(decodedAuthorization);
}

export function handleSyncRequest(
  request: Request,
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
): Response {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET" },
    });
  }

  const after = new URL(request.url).searchParams.get("after")?.trim();
  const payload = after
    ? authority.getIncrementalSyncResult(after, { authorization })
    : authority.createSyncPayload({ authorization });

  return Response.json(payload, {
    headers: {
      "cache-control": "no-store",
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

function isHttpError(error: unknown): error is Error & { readonly status: number } {
  return error instanceof Error && typeof (error as { status?: unknown }).status === "number";
}

function formatGraphValidationError(error: GraphValidationError): string {
  return error.result.issues[0]?.message ?? error.message;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isSupportedWebAppAuthorityCommand(value: unknown): value is WebAppAuthorityCommand {
  return (
    isObjectRecord(value) && value.kind === "write-secret-field" && isObjectRecord(value.input)
  );
}

function authorityCommandSuccessStatus(
  command: WebAppAuthorityCommand,
  result: WebAppAuthorityCommandResult,
): number {
  if (command.kind === "write-secret-field") {
    return result.created ? 201 : 200;
  }

  return 200;
}

async function executeCommandRequest(
  command: WebAppAuthorityCommand,
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
): Promise<Response> {
  try {
    const result = await authority.executeCommand(command, { authorization });
    return Response.json(result, {
      status: authorityCommandSuccessStatus(command, result),
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (isHttpError(error)) {
      return errorResponse(error.message, error.status);
    }
    throw error;
  }
}

export async function handleTransactionRequest(
  request: Request,
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  let transaction: GraphWriteTransaction;
  try {
    transaction = (await request.json()) as GraphWriteTransaction;
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  try {
    const result = await authority.applyTransaction(transaction, { authorization });
    return Response.json(result, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof GraphValidationError) {
      return errorResponse(formatGraphValidationError(error), 400);
    }
    throw error;
  }
}

export async function handleCommandRequest(
  request: Request,
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (!isSupportedWebAppAuthorityCommand(body)) {
    return errorResponse("Request body must be a supported web authority command.", 400);
  }

  return executeCommandRequest(body, authority, authorization);
}
