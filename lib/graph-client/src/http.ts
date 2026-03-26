import type {
  AuthoritativeGraphWriteResult,
  GraphStoreSnapshot,
  GraphWriteTransaction,
} from "@io/graph-kernel";
import { createGraphId } from "@io/graph-kernel";
import type { AnyTypeOutput } from "@io/graph-kernel";
import type { SyncPayload, SyncScopeRequest, SyncState } from "@io/graph-sync";

import { applyHttpSyncRequest } from "./http-sync-request";
import {
  validateSerializedQueryResponse,
  type QueryResultPage,
  type SerializedQueryRequest,
} from "./serialized-query";
import { createSyncedGraphClient, type SyncedGraphClient } from "./sync";

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const defaultHttpGraphUrl = "http://io.localhost:1355/";
export const defaultHttpSerializedQueryPath = "/api/query";

export type HttpGraphClientOptions<
  TDefs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = {
  readonly bearerToken?: string;
  readonly definitions?: TDefs;
  readonly url?: string;
  readonly syncPath?: string;
  readonly schemaSnapshot?: GraphStoreSnapshot;
  readonly transactionPath?: string;
  readonly fetch?: FetchImpl;
  readonly createTxId?: () => string;
  readonly requestedScope?: SyncScopeRequest;
};

export type HttpSerializedQueryClientOptions = {
  readonly bearerToken?: string;
  readonly fetch?: FetchImpl;
  readonly path?: string;
  readonly signal?: AbortSignal;
  readonly url?: string;
};

export class HttpSerializedQueryClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "HttpSerializedQueryClientError";
    this.status = status;
    this.code = code;
  }
}

function readErrorMessage(
  status: number,
  statusText: string,
  payload: unknown,
  fallback: string,
): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return `${fallback} with ${status} ${statusText}.`;
}

function resolveEndpointUrl(path: string, baseUrl: string): string {
  return new URL(path, baseUrl).toString();
}

function resolveOptionalEndpointUrl(path: string, baseUrl?: string): string {
  return baseUrl ? resolveEndpointUrl(path, baseUrl) : path;
}

function createHttpRequestHeaders(
  bearerToken: string | undefined,
  headers: Record<string, string>,
): Record<string, string> {
  if (!bearerToken) {
    return headers;
  }

  return {
    ...headers,
    authorization: `Bearer ${bearerToken}`,
  };
}

function readErrorCode(payload: unknown): string | undefined {
  return typeof (payload as { code?: unknown })?.code === "string"
    ? (payload as { code: string }).code
    : undefined;
}

export async function requestSerializedQuery(
  request: SerializedQueryRequest,
  options: HttpSerializedQueryClientOptions = {},
): Promise<QueryResultPage> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const bearerToken = options.bearerToken?.trim() || undefined;
  const response = await fetchImpl(
    resolveOptionalEndpointUrl(options.path ?? defaultHttpSerializedQueryPath, options.url),
    {
      method: "POST",
      credentials: "same-origin",
      headers: createHttpRequestHeaders(bearerToken, {
        accept: "application/json",
        "content-type": "application/json",
      }),
      body: JSON.stringify(request),
      signal: options.signal,
    },
  );

  const payload = validateSerializedQueryResponse(await response.json().catch(() => undefined));
  if (!response.ok) {
    throw new HttpSerializedQueryClientError(
      readErrorMessage(response.status, response.statusText, payload, "Serialized query failed"),
      response.status,
      readErrorCode(payload),
    );
  }

  if (!payload.ok) {
    throw new HttpSerializedQueryClientError(payload.error, response.status, payload.code);
  }

  return payload.result;
}

export function createHttpGraphTxIdFactory(prefix = "cli"): () => string {
  const sessionId = createGraphId();
  let txSequence = 0;
  return () => {
    txSequence += 1;
    return `${prefix}:${sessionId}:${txSequence}`;
  };
}

export async function createHttpGraphClient<
  const TNamespace extends Record<string, AnyTypeOutput>,
  const TDefs extends Record<string, AnyTypeOutput> = TNamespace,
>(
  namespace: TNamespace,
  options: HttpGraphClientOptions<TDefs> = {},
): Promise<SyncedGraphClient<TNamespace, TDefs>> {
  const baseUrl = options.url ?? defaultHttpGraphUrl;
  const syncUrl = resolveEndpointUrl(options.syncPath ?? "/api/sync", baseUrl);
  const transactionUrl = resolveEndpointUrl(options.transactionPath ?? "/api/tx", baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const createTxId = options.createTxId ?? createHttpGraphTxIdFactory();
  const bearerToken = options.bearerToken?.trim() || undefined;

  async function fetchSyncPayload(
    state: Pick<SyncState, "requestedScope"> & {
      cursor?: SyncState["cursor"];
    },
  ): Promise<SyncPayload> {
    const requestUrl = new URL(syncUrl);
    applyHttpSyncRequest(requestUrl, {
      after: state.cursor,
      scope: state.requestedScope,
    });

    const response = await fetchImpl(requestUrl, {
      cache: "no-store",
      credentials: "same-origin",
      headers: createHttpRequestHeaders(bearerToken, {
        accept: "application/json",
      }),
    });

    const payload = (await response.json().catch(() => undefined)) as
      | SyncPayload
      | { error?: string }
      | undefined;
    if (!response.ok) {
      throw new Error(
        readErrorMessage(response.status, response.statusText, payload, "Sync request failed"),
      );
    }

    return payload as SyncPayload;
  }

  async function pushTransaction(
    transaction: GraphWriteTransaction,
  ): Promise<AuthoritativeGraphWriteResult> {
    const response = await fetchImpl(transactionUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: createHttpRequestHeaders(bearerToken, {
        accept: "application/json",
        "content-type": "application/json",
      }),
      body: JSON.stringify(transaction),
    });

    const payload = (await response.json().catch(() => undefined)) as
      | AuthoritativeGraphWriteResult
      | { error?: string }
      | undefined;
    if (!response.ok) {
      throw new Error(
        readErrorMessage(response.status, response.statusText, payload, "Graph write failed"),
      );
    }

    return payload as AuthoritativeGraphWriteResult;
  }

  const client = createSyncedGraphClient(namespace, {
    createTxId,
    definitions: options.definitions,
    requestedScope: options.requestedScope,
    schemaSnapshot: options.schemaSnapshot,
    pull: (state) => fetchSyncPayload(state),
    push: pushTransaction,
  });

  await client.sync.sync();
  return client;
}
