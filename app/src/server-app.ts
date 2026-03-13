import page from "./web/index.html";

import type { AppAuthority } from "./authority.js";
import type { SaveEnvVarInput } from "./env-vars.js";

export function handleSyncRequest(request: Request, authority: AppAuthority): Response {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET" },
    });
  }

  return Response.json(authority.createSyncPayload(), {
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

export async function handleEnvVarMutationRequest(
  request: Request,
  authority: AppAuthority,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  let body: SaveEnvVarInput;
  try {
    body = (await request.json()) as SaveEnvVarInput;
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  try {
    const result = await authority.saveEnvVar(body);
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (isHttpError(error)) return errorResponse(error.message, error.status);
    throw error;
  }
}

export function createAppServerRoutes(authority: AppAuthority) {
  return {
    "/api/sync": (request: Request) => handleSyncRequest(request, authority),
    "/api/env-vars": (request: Request) => handleEnvVarMutationRequest(request, authority),
    "/*": page,
  } as const;
}
