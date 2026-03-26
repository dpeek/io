import { createStore } from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { createBootstrappedSnapshot, createGraphClient } from "@io/graph-client";

import { kitchenSink } from "./testing/kitchen-sink.js";

export const testNamespace = kitchenSink;
export const testDefs = { ...core, ...testNamespace };

export function createTestStore() {
  return createStore(createBootstrappedSnapshot(testDefs));
}

export function createTestGraph() {
  const store = createTestStore();

  return {
    store,
    coreGraph: createGraphClient(store, core),
    graph: createGraphClient(store, testNamespace, testDefs),
  };
}
