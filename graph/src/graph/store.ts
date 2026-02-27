import { createGraphId } from "./id";

export type Id = string

// The store is schema-agnostic and only stores opaque ids/values as strings.
// Scalar encoding/decoding happens at the schema layer (scalar type codecs).
export type Scalar = Id

export type Edge = {
  readonly id: Id
  readonly s: Id // subject
  readonly p: Id // predicate
  readonly o: Id // object: entity id or scalar payload
}

export interface Store {
  /** Create a new node (entity, predicate, type — all the same thing) */
  newNode(): Id
  /**
   * Assert a triple with an opaque string object payload.
   * Returns the edge, whose id can itself be used as a subject (reification).
   */
  assert(s: Id, p: Id, o: Scalar): Edge
  /** Mark an edge as retracted (append-only: the record is kept, just excluded from facts) */
  retract(edgeId: Id): void
  /** All edges matching the pattern, including retracted */
  find(s?: Id, p?: Id, o?: Id): Edge[]
  /** Current (non-retracted) edges matching the pattern */
  facts(s?: Id, p?: Id, o?: Id): Edge[]
  /** Shorthand: get the single current object for a subject/predicate pair */
  get(s: Id, p: Id): Id | undefined
}

export function createStore(): Store {
  const edges = new Map<Id, Edge>()
  const retracted = new Set<Id>()
  const usedIds = new Set<Id>()

  function nextId(): Id {
    // Keep node and edge ids globally unique for reification safety.
    let id = createGraphId()
    while (usedIds.has(id)) id = createGraphId()
    usedIds.add(id)
    return id
  }

  function assert(s: Id, p: Id, o: Scalar): Edge {
    const edge: Edge = { id: nextId(), s, p, o }
    edges.set(edge.id, edge)
    return edge
  }

  function retract(edgeId: Id): void {
    retracted.add(edgeId)
  }

  function find(s?: Id, p?: Id, o?: Id): Edge[] {
    const results: Edge[] = []
    for (const edge of edges.values()) {
      if (s !== undefined && edge.s !== s) continue
      if (p !== undefined && edge.p !== p) continue
      if (o !== undefined && edge.o !== o) continue
      results.push(edge)
    }
    return results
  }

  function facts(s?: Id, p?: Id, o?: Id): Edge[] {
    return find(s, p, o).filter((e) => !retracted.has(e.id))
  }

  function get(s: Id, p: Id): Id | undefined {
    return facts(s, p)[0]?.o
  }

  return { newNode: () => nextId(), assert, retract, find, facts, get }
}
