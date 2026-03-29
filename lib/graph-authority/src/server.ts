/**
 * Node/server-only entrypoint for file-backed JSON persistence helpers.
 *
 * These exports depend on the Node filesystem and must not be imported from
 * browser/client bundles.
 */
export {
  createJsonPersistedAuthoritativeGraph,
  createJsonPersistedAuthoritativeGraphStorage,
} from "./json-storage.js";
