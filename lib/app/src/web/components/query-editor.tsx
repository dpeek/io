export { QueryEditor } from "@io/graph-module-core/react-dom";
import type { QueryEditorCatalog } from "@io/graph-module-core/react-dom";

import { getInstalledModuleQueryEditorCatalog } from "../lib/query-surface-registry.js";

export function createInstalledQueryEditorCatalog(): QueryEditorCatalog {
  return getInstalledModuleQueryEditorCatalog();
}
