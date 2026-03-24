import { applyHttpSyncRequest } from "./http-sync-request";
import { createGraphId } from "./id";
import type { AnyTypeOutput } from "./schema";
import {
  createSyncedTypeClient,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type SyncPayload,
  type SyncScopeRequest,
  type SyncState,
  type SyncedTypeClient,
} from "./sync";

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const defaultHttpGraphUrl = "http://io.localhost:1355/";

export type HttpGraphClientOptions = {
  readonly bearerToken?: string;
  readonly url?: string;
  readonly syncPath?: string;
  readonly transactionPath?: string;
  readonly fetch?: FetchImpl;
  readonly createTxId?: () => string;
  readonly requestedScope?: SyncScopeRequest;
};

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

export function createHttpGraphTxIdFactory(prefix = "cli"): () => string {
  const sessionId = createGraphId();
  let txSequence = 0;
  return () => {
    txSequence += 1;
    return `${prefix}:${sessionId}:${txSequence}`;
  };
}

export async function createHttpGraphClient<const T extends Record<string, AnyTypeOutput>>(
  namespace: T,
  options: HttpGraphClientOptions = {},
): Promise<SyncedTypeClient<T>> {
  const baseUrl = options.url ?? defaultHttpGraphUrl;
  const syncUrl = resolveEndpointUrl(options.syncPath ?? "/api/sync", baseUrl);
  const transactionUrl = resolveEndpointUrl(options.transactionPath ?? "/api/tx", baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const createTxId = options.createTxId ?? createHttpGraphTxIdFactory();
  const bearerToken = options.bearerToken?.trim() || undefined;

  async function fetchSyncPayload(
    state: Pick<SyncState, "cursor" | "requestedScope">,
  ): Promise<SyncPayload> {
    const requestUrl = new URL(syncUrl);
    applyHttpSyncRequest(requestUrl, {
      after: state.cursor,
      scope: state.requestedScope,
    });

    const response = await fetchImpl(requestUrl, {
      cache: "no-store",
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

  const client = createSyncedTypeClient(namespace, {
    createTxId,
    requestedScope: options.requestedScope,
    pull: (state) => fetchSyncPayload(state),
    push: pushTransaction,
  });

  await client.sync.sync();
  return client;
}
