import { edgeId, isScalarType, type AnyTypeOutput, type GraphStore } from "@io/graph-kernel";

import type { GraphBootstrapCoreSchema } from "./core-schema.js";

export type BootstrapFacts = {
  readonly currentFactKeys: Set<string>;
  readonly existingNodeIds: Set<string>;
};

const defaultBootstrapTimestamp = new Date("2000-01-01T00:00:00.000Z");

export function cloneBootstrapTimestamp(timestamp: Date | undefined): Date {
  return new Date((timestamp ?? defaultBootstrapTimestamp).getTime());
}

function bootstrapFactKey(subjectId: string, predicateId: string, objectId: string): string {
  return `${subjectId}\0${predicateId}\0${objectId}`;
}

export function createBootstrapFacts(store: GraphStore): BootstrapFacts {
  const bootstrapFacts: BootstrapFacts = {
    currentFactKeys: new Set<string>(),
    existingNodeIds: new Set<string>(),
  };

  for (const edge of store.facts()) {
    bootstrapFacts.existingNodeIds.add(edge.s);
    bootstrapFacts.currentFactKeys.add(bootstrapFactKey(edge.s, edge.p, edge.o));
  }

  return bootstrapFacts;
}

export function assertCurrentFactOnce(
  store: GraphStore,
  bootstrapFacts: BootstrapFacts,
  subjectId: string,
  predicateId: string,
  objectId: string,
): void {
  const factKey = bootstrapFactKey(subjectId, predicateId, objectId);
  if (bootstrapFacts.currentFactKeys.has(factKey)) return;
  store.assert(subjectId, predicateId, objectId);
  bootstrapFacts.existingNodeIds.add(subjectId);
  bootstrapFacts.currentFactKeys.add(factKey);
}

function encodeBootstrapValue(
  value: string | Date,
  rangeId: string,
  typeById: ReadonlyMap<string, AnyTypeOutput>,
): string {
  if (typeof value === "string") return value;
  const rangeType = typeById.get(rangeId);
  if (rangeType && isScalarType(rangeType)) {
    return rangeType.encode(value);
  }
  return value.toISOString();
}

export function assertBootstrapManagedTimestampsOnce(
  store: GraphStore,
  bootstrapFacts: BootstrapFacts,
  nodeId: string,
  coreSchema: GraphBootstrapCoreSchema,
  bootstrapTimestamp: Date,
  typeById: ReadonlyMap<string, AnyTypeOutput>,
): void {
  const createdAt = coreSchema.node.fields.createdAt;
  const updatedAt = coreSchema.node.fields.updatedAt;
  if (!createdAt || !updatedAt) return;

  assertCurrentFactOnce(
    store,
    bootstrapFacts,
    nodeId,
    edgeId(createdAt),
    encodeBootstrapValue(bootstrapTimestamp, createdAt.range, typeById),
  );
  assertCurrentFactOnce(
    store,
    bootstrapFacts,
    nodeId,
    edgeId(updatedAt),
    encodeBootstrapValue(bootstrapTimestamp, updatedAt.range, typeById),
  );
}
