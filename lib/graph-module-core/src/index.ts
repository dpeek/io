import { defineGraphModuleManifest } from "@io/graph-module";

import { core } from "./core.js";
import { coreCatalogModuleReadScope, coreModuleId, coreQuerySurfaceCatalog } from "./query.js";

export { core } from "./core.js";
export * from "./core/index.js";
export * from "./query-executors.js";
export * from "./query.js";

export const coreManifest = defineGraphModuleManifest({
  moduleId: coreModuleId,
  version: "0.0.1",
  source: {
    kind: "built-in",
    specifier: "@io/graph-module-core",
    exportName: "coreManifest",
  },
  compatibility: {
    graph: "graph-schema:v1",
    runtime: "graph-runtime:v1",
  },
  runtime: {
    schemas: [
      {
        key: "core",
        namespace: core,
      },
    ],
    querySurfaceCatalogs: [coreQuerySurfaceCatalog],
    readScopes: [coreCatalogModuleReadScope],
  },
});
