import {
  type AuthoritativeGraphWriteResult,
  type AuthoritativeWriteScope,
  createIdMap,
  createAuthoritativeGraphWriteSession,
  createBootstrappedSnapshot,
  defineNamespace,
  defineType,
  createSyncedTypeClient,
  createStore,
  createTotalSyncPayload,
  createTypeClient,
  type GraphWriteTransaction,
  type IncrementalSyncResult,
  type SyncedTypeClient,
  type SyncFreshness,
  type TotalSyncPayload,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import { pkm } from "@io/core/graph/modules/pkm";

import { seedExampleGraph } from "./example-data.js";
import { planRecordedMutation } from "./mutation-planning.js";

const hiddenCursorProbe = defineType({
  values: { key: "test:hiddenCursorProbe", name: "Hidden Cursor Probe" },
  fields: {
    name: core.node.fields.name,
    hiddenState: {
      ...core.node.fields.description,
      authority: {
        visibility: "authority-only",
        write: "authority-only",
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Hidden state",
      },
    },
  },
});

const hiddenCursorProbeNamespace = defineNamespace(createIdMap({ hiddenCursorProbe }).map, {
  hiddenCursorProbe,
});

const productGraph = { ...core, ...pkm, ...ops } as const;
const exampleGraph = { ...productGraph, ...hiddenCursorProbeNamespace } as const;
type ExampleAuthorityBaseline = {
  readonly ids: ReturnType<typeof seedExampleGraph> & {
    readonly hiddenCursorProbe: string;
  };
  readonly snapshot: ReturnType<ReturnType<typeof createStore>["snapshot"]>;
};

let exampleAuthorityBaseline: ExampleAuthorityBaseline | null = null;

function createExampleStore() {
  return createStore(createBootstrappedSnapshot(exampleGraph));
}

function getExampleAuthorityBaseline(): ExampleAuthorityBaseline {
  if (exampleAuthorityBaseline) return exampleAuthorityBaseline;

  const store = createExampleStore();
  const graph = createTypeClient(store, exampleGraph);
  const ids = seedExampleGraph(createTypeClient(store, productGraph));
  const hiddenCursorProbeId = graph.hiddenCursorProbe.create({
    name: "Hidden Cursor Probe",
  });

  exampleAuthorityBaseline = {
    ids: {
      ...ids,
      hiddenCursorProbe: hiddenCursorProbeId,
    },
    snapshot: store.snapshot(),
  };
  return exampleAuthorityBaseline;
}

function createExampleAuthorityGraph() {
  const baseline = getExampleAuthorityBaseline();
  const store = createStore(baseline.snapshot);
  const graph = createTypeClient(store, exampleGraph);

  return {
    store,
    graph,
    ids: {
      ...baseline.ids,
    },
  };
}

export type ExampleSyncedClient = SyncedTypeClient<typeof exampleGraph>;

export function createExampleRuntime(
  options: {
    maxRetainedTransactions?: number;
  } = {},
) {
  const authority = createExampleAuthorityGraph();
  let writes = createAuthoritativeGraphWriteSession(authority.store, exampleGraph, {
    cursorPrefix: "example:",
    maxRetainedResults: options.maxRetainedTransactions,
  });
  const clients = new Set<ExampleSyncedClient>();
  const pendingTxIds = new WeakMap<ExampleSyncedClient, string[]>();
  let localTxSequence = 0;
  let syncPayloadCount = 0;

  function createSyncPayload(): TotalSyncPayload {
    syncPayloadCount += 1;
    return createTotalSyncPayload(authority.store, {
      cursor: writes.getCursor() ?? writes.getBaseCursor(),
    });
  }

  function getIncrementalSyncResult(
    after?: string,
    options?: {
      freshness?: SyncFreshness;
    },
  ): IncrementalSyncResult {
    return writes.getIncrementalSyncResult(after, options);
  }

  function applyTransaction(
    transaction: GraphWriteTransaction,
    options?: { writeScope?: AuthoritativeWriteScope },
  ): AuthoritativeGraphWriteResult {
    return writes.apply(transaction, options);
  }

  function resetAuthorityStream(cursorPrefix = "reset:"): string {
    writes = createAuthoritativeGraphWriteSession(authority.store, exampleGraph, {
      cursorPrefix,
      maxRetainedResults: options.maxRetainedTransactions,
    });
    return writes.getBaseCursor();
  }

  function applyHiddenOnlyCursorAdvance(
    txId: string,
    hiddenState = `hidden:${txId}`,
  ): AuthoritativeGraphWriteResult {
    const planned = planRecordedMutation(
      authority.store.snapshot(),
      exampleGraph,
      txId,
      (mutationGraph) => {
        mutationGraph.hiddenCursorProbe.update(authority.ids.hiddenCursorProbe, {
          hiddenState,
        });
      },
    );
    if (!planned.changed) {
      throw new Error(`Hidden-only mutation for "${txId}" did not change the graph.`);
    }

    return applyTransaction(planned.transaction, {
      writeScope: "authority-only",
    });
  }

  function createClient(): ExampleSyncedClient {
    let client: ExampleSyncedClient;
    const queuedTxIds: string[] = [];
    client = createSyncedTypeClient(exampleGraph, {
      pull: (state) =>
        state.cursor ? getIncrementalSyncResult(state.cursor) : createSyncPayload(),
      createTxId() {
        return queuedTxIds.shift() ?? `example:local:${++localTxSequence}`;
      },
      push: applyTransaction,
    });
    client.sync.apply(createSyncPayload());
    pendingTxIds.set(client, queuedTxIds);
    clients.add(client);
    return client;
  }

  function applyAuthoritativeWrite(
    result: AuthoritativeGraphWriteResult,
  ): AuthoritativeGraphWriteResult {
    for (const client of clients) {
      client.sync.applyWriteResult(result);
    }
    return result;
  }

  function commitLocalMutation(
    client: ExampleSyncedClient,
    txId: string,
    mutate: (graph: ExampleSyncedClient["graph"]) => void,
  ): Promise<AuthoritativeGraphWriteResult> {
    pendingTxIds.get(client)?.push(txId);
    mutate(client.graph);
    if (client.sync.getPendingTransactions().length === 0) {
      throw new Error(`Local mutation for "${txId}" did not change the graph.`);
    }

    return client.sync.flush().then((results) => {
      const result = results[results.length - 1];
      if (!result) {
        throw new Error("Expected synced flush to return an authoritative write result.");
      }
      return result;
    });
  }

  function createPeer(): ExampleSyncedClient {
    return createClient();
  }

  const runtime = createClient();
  return Object.assign(runtime, {
    pkm,
    ops,
    ids: authority.ids,
    createPeer,
    commitLocalMutation,
    applyAuthoritativeWrite,
    authority: {
      ...authority,
      applyTransaction,
      applyHiddenOnlyCursorAdvance,
      createSyncPayload,
      getIncrementalSyncResult,
      resetAuthorityStream,
      getBaseCursor() {
        return writes.getBaseCursor();
      },
      getSyncPayloadCount() {
        return syncPayloadCount;
      },
    },
  });
}
