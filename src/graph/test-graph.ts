import { bootstrap, core, createStore, createTypeClient } from "@io/core/graph";
import { kitchenSink } from "@io/core/graph/schema/test";

export const testNamespace = kitchenSink;
export const testDefs = { ...core, ...testNamespace };

export function createTestGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, testNamespace);

  return {
    store,
    coreGraph: createTypeClient(store, core),
    graph: createTypeClient(store, testNamespace),
  };
}
