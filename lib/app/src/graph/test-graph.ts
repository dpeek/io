import { createStore } from "@io/app/graph";
import { createBootstrappedSnapshot } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";

import { kitchenSink } from "./testing/kitchen-sink.js";

export const testNamespace = kitchenSink;
export const testDefs = { ...core, ...testNamespace };

export function createTestStore() {
  return createStore(createBootstrappedSnapshot(testDefs, coreGraphBootstrapOptions));
}

export function createTestGraph() {
  const store = createTestStore();

  return {
    store,
    coreGraph: createGraphClient(store, core),
    graph: createGraphClient(store, testNamespace, testDefs),
  };
}
