import {
  GraphValidationError,
  readHttpSyncRequest,
  type AuthorizationContext,
  type GraphWriteTransaction,
} from "@io/core/graph";
import {
  projectBranchScopeOrderDirectionValues,
  projectBranchScopeOrderFieldValues,
  workflowBranchStateValues,
  workflowReviewModuleReadScope,
  type CommitQueueScopeQuery,
  type ProjectBranchScopeFilters,
  type ProjectBranchScopeOrderClause,
  type ProjectBranchScopeQuery,
  type WorkflowBranchStateValue,
} from "@io/core/graph/modules/ops/workflow";

import type {
  WebAppAuthority,
  WebAppAuthoritySyncScopeRequest,
  WebAuthorityCommand,
  WebAuthorityCommandResult,
} from "./authority.js";
import type { WorkflowReviewLiveScopeRouter } from "./workflow-live-scope-router.js";
import {
  type WorkflowLiveRequestKind,
  type WorkflowLiveRequest,
  workflowLiveRequestKinds,
} from "./workflow-live-transport.js";
import { type WorkflowReadRequest, workflowReadRequestKinds } from "./workflow-transport.js";

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

export class RequestSyncScopeError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "RequestSyncScopeError";
  }
}

export class RequestWorkflowReadError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "RequestWorkflowReadError";
  }
}

export class RequestWorkflowLiveError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "RequestWorkflowLiveError";
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

  try {
    const { after, scope } = readRequestSyncRequest(request);
    const payload = after
      ? authority.getIncrementalSyncResult(after, { authorization, scope })
      : authority.createSyncPayload({ authorization, scope });

    return Response.json(payload, {
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

function readRequestSyncRequest(request: Request): {
  readonly after?: string;
  readonly scope?: WebAppAuthoritySyncScopeRequest;
} {
  try {
    return readHttpSyncRequest(request);
  } catch (error) {
    if (error instanceof Error) {
      throw new RequestSyncScopeError(error.message);
    }
    throw error;
  }
}

function errorResponse(message: string, status: number, code?: string): Response {
  return Response.json(code ? { error: message, code } : { error: message }, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function isHttpError(error: unknown): error is Error & { readonly status: number } {
  return error instanceof Error && typeof (error as { status?: unknown }).status === "number";
}

function httpErrorCode(error: unknown): string | undefined {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function formatGraphValidationError(error: GraphValidationError): string {
  return error.result.issues[0]?.message ?? error.message;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function requireWorkflowReadObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObjectRecord(value)) {
    throw new RequestWorkflowReadError(`${label} must be a JSON object.`);
  }

  return value;
}

function requireWorkflowReadString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestWorkflowReadError(`${label} must be a non-empty string.`);
  }

  return value;
}

function parseWorkflowReadCursor(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireWorkflowReadString(value, label);
}

function parseWorkflowReadLimit(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RequestWorkflowReadError(`${label} must be a non-negative integer.`);
  }

  return value;
}

function parseWorkflowBranchState(value: unknown, label: string): WorkflowBranchStateValue {
  if (
    typeof value !== "string" ||
    !workflowBranchStateValues.includes(value as WorkflowBranchStateValue)
  ) {
    throw new RequestWorkflowReadError(
      `${label} must be one of: ${workflowBranchStateValues.join(", ")}.`,
    );
  }

  return value as WorkflowBranchStateValue;
}

function parseProjectBranchScopeFilters(
  value: unknown,
  label: string,
): ProjectBranchScopeFilters | undefined {
  if (value === undefined) {
    return undefined;
  }

  const filter = requireWorkflowReadObject(value, label);
  const hasActiveCommit = filter.hasActiveCommit;
  if (hasActiveCommit !== undefined && typeof hasActiveCommit !== "boolean") {
    throw new RequestWorkflowReadError(`${label}.hasActiveCommit must be a boolean.`);
  }

  const showUnmanagedRepositoryBranches = filter.showUnmanagedRepositoryBranches;
  if (
    showUnmanagedRepositoryBranches !== undefined &&
    typeof showUnmanagedRepositoryBranches !== "boolean"
  ) {
    throw new RequestWorkflowReadError(
      `${label}.showUnmanagedRepositoryBranches must be a boolean.`,
    );
  }

  const states = filter.states;
  if (states !== undefined && !Array.isArray(states)) {
    throw new RequestWorkflowReadError(`${label}.states must be an array when provided.`);
  }

  return {
    ...(hasActiveCommit !== undefined ? { hasActiveCommit } : {}),
    ...(showUnmanagedRepositoryBranches !== undefined ? { showUnmanagedRepositoryBranches } : {}),
    ...(states !== undefined
      ? {
          states: states.map((entry, index) =>
            parseWorkflowBranchState(entry, `${label}.states[${index}]`),
          ),
        }
      : {}),
  };
}

function parseProjectBranchScopeOrder(
  value: unknown,
  label: string,
): readonly ProjectBranchScopeOrderClause[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new RequestWorkflowReadError(`${label} must be an array when provided.`);
  }

  return value.map((entry, index) => {
    const clause = requireWorkflowReadObject(entry, `${label}[${index}]`);
    const field = clause.field;
    if (
      typeof field !== "string" ||
      !projectBranchScopeOrderFieldValues.includes(
        field as (typeof projectBranchScopeOrderFieldValues)[number],
      )
    ) {
      throw new RequestWorkflowReadError(
        `${label}[${index}].field must be one of: ${projectBranchScopeOrderFieldValues.join(", ")}.`,
      );
    }

    const direction = clause.direction;
    if (
      typeof direction !== "string" ||
      !projectBranchScopeOrderDirectionValues.includes(
        direction as (typeof projectBranchScopeOrderDirectionValues)[number],
      )
    ) {
      throw new RequestWorkflowReadError(
        `${label}[${index}].direction must be one of: ${projectBranchScopeOrderDirectionValues.join(", ")}.`,
      );
    }

    const typedField = field as ProjectBranchScopeOrderClause["field"];
    const typedDirection = direction as ProjectBranchScopeOrderClause["direction"];

    return {
      field: typedField,
      direction: typedDirection,
    };
  });
}

function parseProjectBranchScopeQuery(value: unknown): ProjectBranchScopeQuery {
  const query = requireWorkflowReadObject(value, 'Workflow read request "query"');
  const cursor = parseWorkflowReadCursor(query.cursor, 'Workflow read request "query.cursor"');
  const limit = parseWorkflowReadLimit(query.limit, 'Workflow read request "query.limit"');
  const filter = parseProjectBranchScopeFilters(
    query.filter,
    'Workflow read request "query.filter"',
  );
  const order = parseProjectBranchScopeOrder(query.order, 'Workflow read request "query.order"');

  return {
    projectId: requireWorkflowReadString(
      query.projectId,
      'Workflow read request "query.projectId"',
    ),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(filter !== undefined ? { filter } : {}),
    ...(order !== undefined ? { order } : {}),
  };
}

function parseCommitQueueScopeQuery(value: unknown): CommitQueueScopeQuery {
  const query = requireWorkflowReadObject(value, 'Workflow read request "query"');
  const cursor = parseWorkflowReadCursor(query.cursor, 'Workflow read request "query.cursor"');
  const limit = parseWorkflowReadLimit(query.limit, 'Workflow read request "query.limit"');

  return {
    branchId: requireWorkflowReadString(query.branchId, 'Workflow read request "query.branchId"'),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function parseWorkflowReadRequest(value: unknown): WorkflowReadRequest {
  const request = requireWorkflowReadObject(value, "Workflow read request");
  const kind = request.kind;
  if (
    typeof kind !== "string" ||
    !workflowReadRequestKinds.includes(kind as (typeof workflowReadRequestKinds)[number])
  ) {
    throw new RequestWorkflowReadError(
      `Workflow read request "kind" must be one of: ${workflowReadRequestKinds.join(", ")}.`,
    );
  }

  if (kind === "project-branch-scope") {
    return {
      kind: "project-branch-scope",
      query: parseProjectBranchScopeQuery(request.query),
    };
  }

  return {
    kind: "commit-queue-scope",
    query: parseCommitQueueScopeQuery(request.query),
  };
}

function requireWorkflowLiveString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestWorkflowLiveError(`${label} must be a non-empty string.`);
  }

  return value;
}

function parseWorkflowLiveRequest(value: unknown): WorkflowLiveRequest {
  if (!isObjectRecord(value)) {
    throw new RequestWorkflowLiveError("Workflow live request must be a JSON object.");
  }

  const kind = value.kind;
  if (
    typeof kind !== "string" ||
    !workflowLiveRequestKinds.includes(kind as WorkflowLiveRequestKind)
  ) {
    throw new RequestWorkflowLiveError(
      `Workflow live request "kind" must be one of: ${workflowLiveRequestKinds.join(", ")}.`,
    );
  }

  const workflowLiveKind = kind as WorkflowLiveRequestKind;

  if (workflowLiveKind === "workflow-review-register") {
    return {
      kind: workflowLiveKind,
      cursor: requireWorkflowLiveString(value.cursor, 'Workflow live request "cursor"'),
    };
  }

  if (workflowLiveKind === "workflow-review-pull") {
    return {
      kind: workflowLiveKind,
      scopeId: requireWorkflowLiveString(value.scopeId, 'Workflow live request "scopeId"'),
    };
  }

  return {
    kind: workflowLiveKind,
    scopeId: requireWorkflowLiveString(value.scopeId, 'Workflow live request "scopeId"'),
  };
}

function isSupportedWebCommandPayload(value: unknown): value is WebAuthorityCommand {
  return (
    isObjectRecord(value) &&
    ((value.kind === "write-secret-field" && isObjectRecord(value.input)) ||
      (value.kind === "workflow-mutation" && isObjectRecord(value.input)))
  );
}

function webCommandSuccessStatus(
  command: WebAuthorityCommand,
  result: WebAuthorityCommandResult,
): number {
  if (command.kind === "write-secret-field") {
    return result.created ? 201 : 200;
  }
  if (command.kind === "workflow-mutation") {
    return result.created ? 201 : 200;
  }

  return 200;
}

async function executeWebCommandRequest(
  command: WebAuthorityCommand,
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
): Promise<Response> {
  try {
    const result = await authority.executeCommand(command, { authorization });
    return Response.json(result, {
      status: webCommandSuccessStatus(command, result),
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (isHttpError(error)) {
      return errorResponse(error.message, error.status, httpErrorCode(error));
    }
    if (error instanceof GraphValidationError) {
      return errorResponse(formatGraphValidationError(error), 400);
    }
    throw error;
  }
}

function executeWorkflowReadRequest(
  read: WorkflowReadRequest,
  authority: WebAppAuthority,
  authorization: AuthorizationContext,
): Response {
  try {
    const response =
      read.kind === "project-branch-scope"
        ? {
            kind: read.kind,
            result: authority.readProjectBranchScope(read.query, { authorization }),
          }
        : {
            kind: read.kind,
            result: authority.readCommitQueueScope(read.query, { authorization }),
          };

    return Response.json(response, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (isHttpError(error)) {
      return errorResponse(error.message, error.status, httpErrorCode(error));
    }

    throw error;
  }
}

function executeWorkflowLiveRequest(
  live: WorkflowLiveRequest,
  authority: WebAppAuthority,
  router: WorkflowReviewLiveScopeRouter,
  authorization: AuthorizationContext,
): Response {
  try {
    if (live.kind === "workflow-review-register") {
      return Response.json(
        {
          kind: live.kind,
          result: router.register(
            authority.planWorkflowReviewLiveRegistration(live.cursor, { authorization }),
          ),
        },
        {
          headers: {
            "cache-control": "no-store",
          },
        },
      );
    }

    const sessionId = authorization.sessionId;
    if (!sessionId) {
      return errorResponse(
        "Workflow live registrations require an authenticated session principal.",
        401,
        "auth.unauthenticated",
      );
    }
    if (live.scopeId !== workflowReviewModuleReadScope.scopeId) {
      return errorResponse(
        `Workflow live scope "${live.scopeId}" was not found.`,
        404,
        "scope-changed",
      );
    }

    if (live.kind === "workflow-review-pull") {
      return Response.json(
        {
          kind: live.kind,
          result: router.pull({
            sessionId,
            scopeId: live.scopeId,
          }),
        },
        {
          headers: {
            "cache-control": "no-store",
          },
        },
      );
    }

    return Response.json(
      {
        kind: live.kind,
        result: {
          removed: router.remove({
            sessionId,
            scopeId: live.scopeId,
          }),
          scopeId: live.scopeId,
          sessionId,
        },
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    if (isHttpError(error)) {
      return errorResponse(error.message, error.status, httpErrorCode(error));
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

/**
 * Transport helper for the current web-owned `/api/commands` proof.
 *
 * This route only accepts the shipped web command envelopes; the shared graph
 * runtime boundary remains `GraphWriteTransaction`, sync payloads, and
 * persisted-authority APIs.
 */
export async function handleWebCommandRequest(
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

  if (!isSupportedWebCommandPayload(body)) {
    return errorResponse("Request body must be a supported /api/commands payload.", 400);
  }

  return executeWebCommandRequest(body, authority, authorization);
}

export async function handleWorkflowReadRequest(
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

  try {
    const workflowRead = parseWorkflowReadRequest(body);
    return executeWorkflowReadRequest(workflowRead, authority, authorization);
  } catch (error) {
    if (error instanceof RequestWorkflowReadError) {
      return errorResponse(error.message, error.status);
    }

    if (isHttpError(error)) {
      return errorResponse(error.message, error.status, httpErrorCode(error));
    }

    throw error;
  }
}

export async function handleWorkflowLiveRequest(
  request: Request,
  authority: WebAppAuthority,
  router: WorkflowReviewLiveScopeRouter,
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

  try {
    const workflowLive = parseWorkflowLiveRequest(body);
    return executeWorkflowLiveRequest(workflowLive, authority, router, authorization);
  } catch (error) {
    if (error instanceof RequestWorkflowLiveError) {
      return errorResponse(error.message, error.status);
    }

    if (isHttpError(error)) {
      return errorResponse(error.message, error.status, httpErrorCode(error));
    }

    throw error;
  }
}
