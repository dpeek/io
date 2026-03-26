import { graphSyncScope, type SyncScopeRequest } from "@io/graph-sync";

export type HttpSyncRequest = {
  readonly after?: string;
  readonly scope?: SyncScopeRequest;
};

function readOptionalTrimmedParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function readRequiredScopeParam(searchParams: URLSearchParams, key: string): string {
  const value = readOptionalTrimmedParam(searchParams, key);
  if (!value) {
    throw new Error(`Sync scope query parameter "${key}" is required.`);
  }
  return value;
}

function resolveRequestUrl(input: URL | Request | string): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

export function applyHttpSyncRequest(url: URL, request: HttpSyncRequest): void {
  if (request.after) {
    url.searchParams.set("after", request.after);
  }

  if (!request.scope) return;

  if (request.scope.kind === "graph") {
    url.searchParams.set("scopeKind", request.scope.kind);
    return;
  }

  url.searchParams.set("scopeKind", request.scope.kind);
  url.searchParams.set("moduleId", request.scope.moduleId);
  url.searchParams.set("scopeId", request.scope.scopeId);
}

export function readHttpSyncRequest(input: URL | Request | string): HttpSyncRequest {
  const searchParams = resolveRequestUrl(input).searchParams;
  const scopeKind = readOptionalTrimmedParam(searchParams, "scopeKind");
  if (!scopeKind) {
    return {
      after: readOptionalTrimmedParam(searchParams, "after"),
    };
  }

  if (scopeKind === "graph") {
    return {
      after: readOptionalTrimmedParam(searchParams, "after"),
      scope: graphSyncScope,
    };
  }

  if (scopeKind !== "module") {
    throw new Error('Sync scope query parameter "scopeKind" must be "graph" or "module".');
  }

  return {
    after: readOptionalTrimmedParam(searchParams, "after"),
    scope: {
      kind: "module",
      moduleId: readRequiredScopeParam(searchParams, "moduleId"),
      scopeId: readRequiredScopeParam(searchParams, "scopeId"),
    },
  };
}
