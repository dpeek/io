import {
  createStore,
  type AnyTypeOutput,
  type GraphStore,
  type GraphStoreSnapshot,
} from "@io/app/graph";
import { createGraphClient, type GraphClient } from "@io/graph-client";
import { canonicalizeGraphWriteTransaction, type GraphWriteTransaction } from "@io/graph-kernel";

function createRecordingStore(snapshot: GraphStoreSnapshot): {
  readonly store: GraphStore;
  buildTransaction(txId: string): GraphWriteTransaction;
} {
  const store = createStore(snapshot);
  const ops: GraphWriteTransaction["ops"][number][] = [];
  let edgeIds = new Set(snapshot.edges.map((edge) => edge.id));
  let retractedEdgeIds = new Set(snapshot.retracted);

  function syncSnapshotState(nextSnapshot: GraphStoreSnapshot): void {
    edgeIds = new Set(nextSnapshot.edges.map((edge) => edge.id));
    retractedEdgeIds = new Set(nextSnapshot.retracted);
  }

  const recordingStore: GraphStore = {
    newId() {
      return store.newId();
    },
    assert(subjectId, predicateId, objectId) {
      const edge = store.assert(subjectId, predicateId, objectId);
      edgeIds.add(edge.id);
      retractedEdgeIds.delete(edge.id);
      ops.push({
        op: "assert",
        edge: { ...edge },
      });
      return edge;
    },
    assertEdge(edge) {
      const existed = edgeIds.has(edge.id);
      const asserted = store.assertEdge(edge);
      if (!existed) {
        edgeIds.add(asserted.id);
        retractedEdgeIds.delete(asserted.id);
        ops.push({
          op: "assert",
          edge: { ...asserted },
        });
      }
      return asserted;
    },
    retract(edgeId) {
      if (!edgeIds.has(edgeId) || retractedEdgeIds.has(edgeId)) {
        store.retract(edgeId);
        return;
      }
      store.retract(edgeId);
      retractedEdgeIds.add(edgeId);
      ops.push({
        op: "retract",
        edgeId,
      });
    },
    find(subjectId, predicateId, objectId) {
      return store.find(subjectId, predicateId, objectId);
    },
    facts(subjectId, predicateId, objectId) {
      return store.facts(subjectId, predicateId, objectId);
    },
    get(subjectId, predicateId) {
      return store.get(subjectId, predicateId);
    },
    batch(fn) {
      return store.batch(fn);
    },
    subscribePredicateSlot(subjectId, predicateId, listener) {
      return store.subscribePredicateSlot(subjectId, predicateId, listener);
    },
    snapshot() {
      return store.snapshot();
    },
    replace(nextSnapshot) {
      store.replace(nextSnapshot);
      ops.length = 0;
      syncSnapshotState(nextSnapshot);
    },
    version() {
      return store.version();
    },
  };

  return {
    store: recordingStore,
    buildTransaction(txId) {
      return canonicalizeGraphWriteTransaction({
        id: txId,
        ops,
      });
    },
  };
}

export function planRecordedMutation<const TGraph extends Record<string, AnyTypeOutput>, TResult>(
  snapshot: GraphStoreSnapshot,
  graph: TGraph,
  txId: string,
  mutate: (graph: GraphClient<TGraph>, store: GraphStore) => TResult,
): {
  readonly changed: boolean;
  readonly result: TResult;
  readonly transaction: GraphWriteTransaction;
} {
  const { buildTransaction, store } = createRecordingStore(snapshot);
  const mutationGraph = createGraphClient(store, graph);
  const result = mutate(mutationGraph, store);
  const transaction = buildTransaction(txId);

  return {
    changed: transaction.ops.length > 0,
    result,
    transaction,
  };
}
