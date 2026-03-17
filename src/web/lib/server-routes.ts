import { GraphValidationError, type GraphWriteTransaction } from "@io/core/graph";

import type { WebAppAuthority } from "./authority.js";
import type { WriteSecretFieldInput } from "./secret-fields.js";

export function handleSyncRequest(request: Request, authority: WebAppAuthority): Response {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET" },
    });
  }

  const after = new URL(request.url).searchParams.get("after")?.trim();
  const payload = after ? authority.getIncrementalSyncResult(after) : authority.createSyncPayload();

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

export async function handleTransactionRequest(
  request: Request,
  authority: WebAppAuthority,
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
    const result = await authority.applyTransaction(transaction);
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

export async function handleSecretFieldRequest(
  request: Request,
  authority: WebAppAuthority,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  let body: WriteSecretFieldInput;
  try {
    body = (await request.json()) as WriteSecretFieldInput;
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  try {
    const result = await authority.writeSecretField(body);
    return Response.json(result, {
      status: result.created ? 201 : 200,
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
