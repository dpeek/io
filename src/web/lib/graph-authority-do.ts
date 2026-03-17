import {
  createWebAppAuthority,
  type PersistedWebAppAuthorityState,
  type PersistedWebAppAuthorityStorageLoadResult,
  type WebAppAuthority,
  type WebAppAuthorityStorage,
} from "./authority.js";
import {
  handleSecretFieldRequest,
  handleSyncRequest,
  handleTransactionRequest,
} from "./server-routes.js";

type DurableObjectStorageLike = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  sql: {
    exec(query: string): unknown;
  };
};

type DurableObjectStateLike = {
  storage: DurableObjectStorageLike;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
};

const authorityStateStorageKey = "web-graph-authority-state";

function clonePersistedValue<T>(value: T): T {
  return structuredClone(value);
}

function createDurableObjectAuthorityStorage(
  state: DurableObjectStateLike,
): WebAppAuthorityStorage {
  return {
    async load(): Promise<PersistedWebAppAuthorityStorageLoadResult | null> {
      const persistedState =
        await state.storage.get<PersistedWebAppAuthorityState>(authorityStateStorageKey);
      if (!persistedState) return null;

      return {
        snapshot: clonePersistedValue(persistedState.snapshot),
        writeHistory: clonePersistedValue(persistedState.writeHistory),
        secretValues: clonePersistedValue(persistedState.secretValues ?? {}),
        needsRewrite: false,
      };
    },
    async save(persistedState): Promise<void> {
      await state.storage.put(authorityStateStorageKey, clonePersistedValue(persistedState));
    },
  };
}

export class WebGraphAuthorityDurableObject {
  private readonly state: DurableObjectStateLike;
  private authorityPromise: Promise<WebAppAuthority> | null = null;

  constructor(state: DurableObjectStateLike) {
    this.state = state;
    this.state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS io_graph_authority_meta (id INTEGER PRIMARY KEY CHECK (id = 1))",
    );
  }

  private getAuthority(): Promise<WebAppAuthority> {
    if (this.authorityPromise) return this.authorityPromise;

    const pending = this.state
      .blockConcurrencyWhile(() =>
        createWebAppAuthority(createDurableObjectAuthorityStorage(this.state)),
      )
      .catch((error) => {
        this.authorityPromise = null;
        throw error;
      });

    this.authorityPromise = pending;
    return pending;
  }

  async fetch(request: Request): Promise<Response> {
    const authority = await this.getAuthority();
    const url = new URL(request.url);

    if (url.pathname === "/api/sync") {
      return handleSyncRequest(request, authority);
    }

    if (url.pathname === "/api/tx") {
      return handleTransactionRequest(request, authority);
    }

    if (url.pathname === "/api/secret-fields") {
      return handleSecretFieldRequest(request, authority);
    }

    return new Response("Not Found", { status: 404 });
  }
}
