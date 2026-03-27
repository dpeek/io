import { createBootstrappedSnapshot } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { createGraphStore } from "@io/graph-kernel";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";

import { kitchenSink } from "./kitchen-sink.js";

export const testNamespace = kitchenSink;
export const testDefs = { ...core, ...testNamespace };

export function createTestStore() {
  return createGraphStore(createBootstrappedSnapshot(testDefs, coreGraphBootstrapOptions));
}

export function createTestGraph() {
  const store = createTestStore();

  return {
    store,
    coreGraph: createGraphClient(store, core),
    graph: createGraphClient(store, testNamespace, testDefs),
  };
}
