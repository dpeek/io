import { createGraphId } from "./id";

export type Id = string;

// The store is schema-agnostic and only stores opaque ids/values as strings.
// Scalar encoding/decoding happens at the schema layer (scalar type codecs).
export type Scalar = Id;

export type Edge = {
  readonly id: Id;
  readonly s: Id; // subject
  readonly p: Id; // predicate
  readonly o: Id; // object: entity id or scalar payload
};

export type StoreSnapshot = {
  readonly edges: readonly Edge[];
  readonly retracted: readonly Id[];
};

export type PredicateSlotListener = () => void;

export interface Store {
  /** Create a new node (entity, predicate, type — all the same thing) */
  newNode(): Id;
  /**
   * Assert a triple with an opaque string object payload.
   * Returns the edge, whose id can itself be used as a subject (reification).
   */
  assert(s: Id, p: Id, o: Scalar): Edge;
  /** Assert a pre-authored edge, preserving its id for sync/replay flows. */
  assertEdge(edge: Edge): Edge;
  /** Mark an edge as retracted (append-only: the record is kept, just excluded from facts) */
  retract(edgeId: Id): void;
  /** All edges matching the pattern, including retracted */
  find(s?: Id, p?: Id, o?: Id): Edge[];
  /** Current (non-retracted) edges matching the pattern */
  facts(s?: Id, p?: Id, o?: Id): Edge[];
  /** Shorthand: get the single current object for a subject/predicate pair */
  get(s: Id, p: Id): Id | undefined;
  /** Group related writes so logical slot notifications flush once after the outermost batch completes */
  batch<T>(fn: () => T): T;
  /** Subscribe to one logical predicate slot keyed by `(subject id, predicate id)` */
  subscribePredicateSlot(s: Id, p: Id, listener: PredicateSlotListener): () => void;
  /** Serialize the full current store state for sync or snapshot transport */
  snapshot(): StoreSnapshot;
  /** Replace the current store state with a synced snapshot */
  replace(snapshot: StoreSnapshot): void;
  /** Monotonic version for the current fact state */
  version(): number;
}

export function cloneStoreSnapshot(snapshot: StoreSnapshot): StoreSnapshot {
  return {
    edges: snapshot.edges.map((edge) => ({ ...edge })),
    retracted: [...snapshot.retracted],
  };
}

export function createStore(initialSnapshot?: StoreSnapshot): Store {
  const edges = new Map<Id, Edge>();
  const retracted = new Set<Id>();
  const usedIds = new Set<Id>();
  const edgesBySubject = new Map<Id, Set<Id>>();
  const edgesByPredicate = new Map<Id, Set<Id>>();
  const edgesByObject = new Map<Id, Set<Id>>();
  const edgesBySubjectPredicate = new Map<string, Set<Id>>();
  const edgesBySubjectObject = new Map<string, Set<Id>>();
  const edgesByPredicateObject = new Map<string, Set<Id>>();
  const predicateSlotListeners = new Map<string, Set<PredicateSlotListener>>();
  const pendingPredicateSlots = new Map<string, { s: Id; p: Id; before: Scalar[] }>();
  let batchDepth = 0;
  let version = 0;

  function nextId(): Id {
    // Keep node and edge ids globally unique for reification safety.
    let id = createGraphId();
    while (usedIds.has(id)) id = createGraphId();
    usedIds.add(id);
    return id;
  }

  function predicateSlotKey(s: Id, p: Id): string {
    return `${s}\0${p}`;
  }

  function pairKey(left: Id, right: Id): string {
    return `${left}\0${right}`;
  }

  function addEdgeId(
    index: Map<string, Set<Id>> | Map<Id, Set<Id>>,
    key: string,
    edgeId: Id,
  ): void {
    let edgeIds = index.get(key);
    if (!edgeIds) {
      edgeIds = new Set<Id>();
      index.set(key, edgeIds);
    }
    edgeIds.add(edgeId);
  }

  function indexEdge(edge: Edge): void {
    addEdgeId(edgesBySubject, edge.s, edge.id);
    addEdgeId(edgesByPredicate, edge.p, edge.id);
    addEdgeId(edgesByObject, edge.o, edge.id);
    addEdgeId(edgesBySubjectPredicate, pairKey(edge.s, edge.p), edge.id);
    addEdgeId(edgesBySubjectObject, pairKey(edge.s, edge.o), edge.id);
    addEdgeId(edgesByPredicateObject, pairKey(edge.p, edge.o), edge.id);
  }

  function pickBetterCandidate(
    current: Set<Id> | undefined,
    next: Set<Id> | undefined,
  ): Set<Id> | undefined {
    if (!next) return current;
    if (!current || next.size < current.size) return next;
    return current;
  }

  function snapshotPredicateSlot(s: Id, p: Id): Scalar[] {
    return facts(s, p).map((edge) => edge.o);
  }

  function samePredicateSlotValue(left: Scalar[], right: Scalar[]): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  function beginPredicateSlotMutation(s: Id, p: Id): void {
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

  function assertEdge(edge: Edge): Edge {
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

  function assert(s: Id, p: Id, o: Scalar): Edge {
    return assertEdge({ id: nextId(), s, p, o });
  }

  function retract(edgeId: Id): void {
    usedIds.add(edgeId);
    const edge = edges.get(edgeId);
    if (edge) beginPredicateSlotMutation(edge.s, edge.p);
    const alreadyRetracted = retracted.has(edgeId);
    retracted.add(edgeId);
    if (!alreadyRetracted) version += 1;
    flushPredicateSlotNotifications();
  }

  function collectMatchingEdges(edgeIds: Iterable<Id>, s?: Id, p?: Id, o?: Id): Edge[] {
    const results: Edge[] = [];
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

  function find(s?: Id, p?: Id, o?: Id): Edge[] {
    if (s === undefined && p === undefined && o === undefined) {
      return [...edges.values()];
    }

    let candidates: Set<Id> | undefined;
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

  function facts(s?: Id, p?: Id, o?: Id): Edge[] {
    return find(s, p, o).filter((e) => !retracted.has(e.id));
  }

  function get(s: Id, p: Id): Id | undefined {
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

  function subscribePredicateSlot(s: Id, p: Id, listener: PredicateSlotListener): () => void {
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

  function snapshot(): StoreSnapshot {
    return cloneStoreSnapshot({
      edges: [...edges.values()],
      retracted: [...retracted.values()],
    });
  }

  function loadSnapshot(snapshot: StoreSnapshot): void {
    edges.clear();
    retracted.clear();
    usedIds.clear();
    edgesBySubject.clear();
    edgesByPredicate.clear();
    edgesByObject.clear();
    edgesBySubjectPredicate.clear();
    edgesBySubjectObject.clear();
    edgesByPredicateObject.clear();

    for (const edge of snapshot.edges) {
      const cloned = { ...edge };
      edges.set(cloned.id, cloned);
      indexEdge(cloned);
      usedIds.add(cloned.id);
      usedIds.add(cloned.s);
      usedIds.add(cloned.p);
      usedIds.add(cloned.o);
    }

    for (const edgeId of snapshot.retracted) {
      retracted.add(edgeId);
      usedIds.add(edgeId);
    }
  }

  function replace(snapshot: StoreSnapshot): void {
    for (const [key, listeners] of predicateSlotListeners) {
      if (listeners.size === 0 || pendingPredicateSlots.has(key)) continue;
      const [s, p] = key.split("\0") as [Id, Id];
      pendingPredicateSlots.set(key, { s, p, before: snapshotPredicateSlot(s, p) });
    }

    loadSnapshot(snapshot);
    version += 1;
    flushPredicateSlotNotifications();
  }

  if (initialSnapshot) loadSnapshot(initialSnapshot);

  return {
    newNode: () => nextId(),
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
    version: () => version,
  };
}
