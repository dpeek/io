import { createGraphId, type GraphId } from "./id.js";

/**
 * Opaque encoded payload stored in one edge object slot.
 *
 * The store is schema-agnostic and only stores string ids and scalar payloads.
 * Encoding and decoding of richer scalar values belongs to the schema layer.
 */
export type EncodedValue = GraphId;

/**
 * Canonical fact record stored by the graph kernel.
 */
export type GraphFact = {
  readonly id: GraphId;
  readonly s: GraphId;
  readonly p: GraphId;
  readonly o: GraphId;
};

/**
 * Full materialized fact state of a store.
 */
export type GraphStoreSnapshot = {
  readonly edges: readonly GraphFact[];
  readonly retracted: readonly GraphId[];
};

/**
 * Subscriber callback for one logical `(subject, predicate)` slot.
 */
export type PredicateSlotListener = () => void;

/**
 * Schema-agnostic append-oriented fact store.
 *
 * This is the lowest-level mutable runtime surface in the graph kernel. It
 * knows nothing about types, validation, or transport.
 */
export interface GraphStore {
  /**
   * Allocate one fresh opaque id from the store's id space.
   */
  newId(): GraphId;
  /**
   * Assert one new edge and allocate its edge id automatically.
   */
  assert(s: GraphId, p: GraphId, o: EncodedValue): GraphFact;
  /**
   * Assert one complete edge record.
   *
   * Re-asserting the same edge id with identical contents is a no-op.
   * Re-asserting it with different contents throws.
   */
  assertEdge(edge: GraphFact): GraphFact;
  /**
   * Tombstone one prior edge id.
   *
   * Retractions are id-based and remain recorded even if the edge payload is no
   * longer available locally.
   */
  retract(edgeId: GraphId): void;
  /**
   * Read matching asserted edges, including edges that have since been
   * retracted.
   */
  find(s?: GraphId, p?: GraphId, o?: GraphId): GraphFact[];
  /**
   * Read matching live facts, excluding retracted edges.
   */
  facts(s?: GraphId, p?: GraphId, o?: GraphId): GraphFact[];
  /**
   * Read the first live object value for one `(subject, predicate)` slot.
   *
   * This is a convenience helper; it does not enforce cardinality.
   */
  get(s: GraphId, p: GraphId): GraphId | undefined;
  /**
   * Batch multiple mutations and coalesce predicate-slot notifications until
   * the outermost batch completes.
   */
  batch<T>(fn: () => T): T;
  /**
   * Subscribe to changes in one logical `(subject, predicate)` slot.
   *
   * The listener fires only when the slot's live values change after batching
   * and retraction filtering have been applied.
   */
  subscribePredicateSlot(s: GraphId, p: GraphId, listener: PredicateSlotListener): () => void;
  /**
   * Materialize a deep-cloned snapshot of the current store state.
   */
  snapshot(): GraphStoreSnapshot;
  /**
   * Replace the current materialized state wholesale with the provided
   * snapshot.
   */
  replace(snapshot: GraphStoreSnapshot): void;
  /**
   * Read the store's mutation version counter.
   *
   * The counter advances on new assertions, first-time retractions, and full
   * snapshot replacement.
   */
  version(): number;
}

/**
 * Deep-clone one store snapshot so callers can retain it safely.
 */
export function cloneStoreSnapshot(snapshot: GraphStoreSnapshot): GraphStoreSnapshot {
  return {
    edges: snapshot.edges.map((edge) => ({ ...edge })),
    retracted: [...snapshot.retracted],
  };
}

/**
 * Create one in-memory graph store.
 *
 * The created store is append-oriented: assertions append facts, retractions
 * tombstone prior facts, and snapshots replace the current materialized state
 * without changing the contract shape.
 */
export function createStore(initialSnapshot?: GraphStoreSnapshot): GraphStore {
  const edges = new Map<GraphId, GraphFact>();
  const retracted = new Set<GraphId>();
  const usedIds = new Set<GraphId>();
  const edgesBySubject = new Map<GraphId, Set<GraphId>>();
  const edgesByPredicate = new Map<GraphId, Set<GraphId>>();
  const edgesByObject = new Map<GraphId, Set<GraphId>>();
  const edgesBySubjectPredicate = new Map<string, Set<GraphId>>();
  const edgesBySubjectObject = new Map<string, Set<GraphId>>();
  const edgesByPredicateObject = new Map<string, Set<GraphId>>();
  const predicateSlotListeners = new Map<string, Set<PredicateSlotListener>>();
  const pendingPredicateSlots = new Map<
    string,
    { s: GraphId; p: GraphId; before: EncodedValue[] }
  >();
  let batchDepth = 0;
  let version = 0;

  function nextId(): GraphId {
    let id = createGraphId();
    while (usedIds.has(id)) id = createGraphId();
    usedIds.add(id);
    return id;
  }

  function predicateSlotKey(s: GraphId, p: GraphId): string {
    return `${s}\0${p}`;
  }

  function pairKey(left: GraphId, right: GraphId): string {
    return `${left}\0${right}`;
  }

  function addEdgeId(index: Map<string, Set<GraphId>>, key: string, edgeId: GraphId): void {
    let edgeIds = index.get(key);
    if (!edgeIds) {
      edgeIds = new Set<GraphId>();
      index.set(key, edgeIds);
    }
    edgeIds.add(edgeId);
  }

  function indexEdge(edge: GraphFact): void {
    addEdgeId(edgesBySubject, edge.s, edge.id);
    addEdgeId(edgesByPredicate, edge.p, edge.id);
    addEdgeId(edgesByObject, edge.o, edge.id);
    addEdgeId(edgesBySubjectPredicate, pairKey(edge.s, edge.p), edge.id);
    addEdgeId(edgesBySubjectObject, pairKey(edge.s, edge.o), edge.id);
    addEdgeId(edgesByPredicateObject, pairKey(edge.p, edge.o), edge.id);
  }

  function pickBetterCandidate(
    current: Set<GraphId> | undefined,
    next: Set<GraphId> | undefined,
  ): Set<GraphId> | undefined {
    if (!next) return current;
    if (!current || next.size < current.size) return next;
    return current;
  }

  function snapshotPredicateSlot(s: GraphId, p: GraphId): EncodedValue[] {
    return facts(s, p).map((edge) => edge.o);
  }

  function samePredicateSlotValue(left: EncodedValue[], right: EncodedValue[]): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  function beginPredicateSlotMutation(s: GraphId, p: GraphId): void {
    const key = predicateSlotKey(s, p);
    if (pendingPredicateSlots.has(key)) return;
    pendingPredicateSlots.set(key, { s, p, before: snapshotPredicateSlot(s, p) });
  }

  function flushPredicateSlotNotifications(): void {
    if (batchDepth > 0 || pendingPredicateSlots.size === 0) return;
    const pending = [...pendingPredicateSlots.values()];
    pendingPredicateSlots.clear();

    for (const slot of pending) {
      const listeners = predicateSlotListeners.get(predicateSlotKey(slot.s, slot.p));
      if (!listeners?.size) continue;
      const after = snapshotPredicateSlot(slot.s, slot.p);
      if (samePredicateSlotValue(slot.before, after)) continue;
      for (const listener of new Set(listeners)) listener();
    }
  }

  function assertEdge(edge: GraphFact): GraphFact {
    const existing = edges.get(edge.id);
    if (existing) {
      if (existing.s !== edge.s || existing.p !== edge.p || existing.o !== edge.o) {
        throw new Error(`Edge id "${edge.id}" already exists with different contents.`);
      }
      return { ...existing };
    }

    usedIds.add(edge.id);
    usedIds.add(edge.s);
    usedIds.add(edge.p);
    usedIds.add(edge.o);
    beginPredicateSlotMutation(edge.s, edge.p);
    const cloned = { ...edge };
    edges.set(cloned.id, cloned);
    indexEdge(cloned);
    version += 1;
    flushPredicateSlotNotifications();
    return cloned;
  }

  function assert(s: GraphId, p: GraphId, o: EncodedValue): GraphFact {
    return assertEdge({ id: nextId(), s, p, o });
  }

  function retract(edgeId: GraphId): void {
    usedIds.add(edgeId);
    const edge = edges.get(edgeId);
    if (edge) beginPredicateSlotMutation(edge.s, edge.p);
    const alreadyRetracted = retracted.has(edgeId);
    retracted.add(edgeId);
    if (!alreadyRetracted) version += 1;
    flushPredicateSlotNotifications();
  }

  function collectMatchingEdges(
    edgeIds: Iterable<GraphId>,
    s?: GraphId,
    p?: GraphId,
    o?: GraphId,
  ): GraphFact[] {
    const results: GraphFact[] = [];
    for (const edgeId of edgeIds) {
      const edge = edges.get(edgeId);
      if (!edge) continue;
      if (s !== undefined && edge.s !== s) continue;
      if (p !== undefined && edge.p !== p) continue;
      if (o !== undefined && edge.o !== o) continue;
      results.push(edge);
    }
    return results;
  }

  function find(s?: GraphId, p?: GraphId, o?: GraphId): GraphFact[] {
    if (s === undefined && p === undefined && o === undefined) {
      return [...edges.values()];
    }

    let candidates: Set<GraphId> | undefined;
    if (s !== undefined) candidates = pickBetterCandidate(candidates, edgesBySubject.get(s));
    if (p !== undefined) candidates = pickBetterCandidate(candidates, edgesByPredicate.get(p));
    if (o !== undefined) candidates = pickBetterCandidate(candidates, edgesByObject.get(o));
    if (s !== undefined && p !== undefined) {
      candidates = pickBetterCandidate(candidates, edgesBySubjectPredicate.get(pairKey(s, p)));
    }
    if (s !== undefined && o !== undefined) {
      candidates = pickBetterCandidate(candidates, edgesBySubjectObject.get(pairKey(s, o)));
    }
    if (p !== undefined && o !== undefined) {
      candidates = pickBetterCandidate(candidates, edgesByPredicateObject.get(pairKey(p, o)));
    }

    if (!candidates) return [];
    return collectMatchingEdges(candidates, s, p, o);
  }

  function facts(s?: GraphId, p?: GraphId, o?: GraphId): GraphFact[] {
    return find(s, p, o).filter((edge) => !retracted.has(edge.id));
  }

  function get(s: GraphId, p: GraphId): GraphId | undefined {
    return facts(s, p)[0]?.o;
  }

  function batch<T>(fn: () => T): T {
    batchDepth += 1;
    try {
      return fn();
    } finally {
      batchDepth -= 1;
      flushPredicateSlotNotifications();
    }
  }

  function subscribePredicateSlot(
    s: GraphId,
    p: GraphId,
    listener: PredicateSlotListener,
  ): () => void {
    const key = predicateSlotKey(s, p);
    let listeners = predicateSlotListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      predicateSlotListeners.set(key, listeners);
    }
    listeners.add(listener);

    return () => {
      const currentListeners = predicateSlotListeners.get(key);
      if (!currentListeners) return;
      currentListeners.delete(listener);
      if (currentListeners.size === 0) predicateSlotListeners.delete(key);
    };
  }

  function snapshot(): GraphStoreSnapshot {
    return {
      edges: [...edges.values()].map((edge) => ({ ...edge })),
      retracted: [...retracted],
    };
  }

  function replace(nextSnapshot: GraphStoreSnapshot): void {
    const observedSlots = [...predicateSlotListeners.keys()].map((key) => {
      const [s, p] = key.split("\0") as [GraphId, GraphId];
      return {
        key,
        s,
        p,
        before: snapshotPredicateSlot(s, p),
      };
    });

    edges.clear();
    retracted.clear();
    usedIds.clear();
    edgesBySubject.clear();
    edgesByPredicate.clear();
    edgesByObject.clear();
    edgesBySubjectPredicate.clear();
    edgesBySubjectObject.clear();
    edgesByPredicateObject.clear();
    pendingPredicateSlots.clear();

    for (const edge of nextSnapshot.edges) {
      const cloned = { ...edge };
      edges.set(cloned.id, cloned);
      usedIds.add(cloned.id);
      usedIds.add(cloned.s);
      usedIds.add(cloned.p);
      usedIds.add(cloned.o);
      indexEdge(cloned);
    }

    for (const edgeId of nextSnapshot.retracted) {
      usedIds.add(edgeId);
      retracted.add(edgeId);
    }

    pendingPredicateSlots.clear();
    for (const slot of observedSlots) {
      pendingPredicateSlots.set(slot.key, {
        s: slot.s,
        p: slot.p,
        before: slot.before,
      });
    }

    version += 1;
    flushPredicateSlotNotifications();
  }

  function getVersion(): number {
    return version;
  }

  if (initialSnapshot) replace(initialSnapshot);

  return {
    newId: nextId,
    assert,
    assertEdge,
    retract,
    find,
    facts,
    get,
    batch,
    subscribePredicateSlot,
    snapshot,
    replace,
    version: getVersion,
  };
}
