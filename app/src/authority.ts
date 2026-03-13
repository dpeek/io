import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bootstrap,
  createJsonPersistedAuthoritativeGraph,
  createStore,
  core,
  type PersistedAuthoritativeGraph,
} from "@io/graph";

import { app } from "./graph/app.js";
import { seedExampleGraph } from "./graph/example-data.js";

export type AppAuthority = PersistedAuthoritativeGraph<typeof app> & {
  readonly snapshotPath: string;
};

const defaultAuthoritySnapshotPath = fileURLToPath(
  new URL("../tmp/app-graph.snapshot.json", import.meta.url),
);
let authorityCursorEpoch = 0;

function resolveAuthoritySnapshotPath(configuredSnapshotPath?: string): string {
  const rawPath = configuredSnapshotPath?.trim() ?? Bun.env.IO_APP_SNAPSHOT_PATH?.trim();
  if (!rawPath) return defaultAuthoritySnapshotPath;
  return isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
}

function createAuthorityCursorPrefix(): string {
  authorityCursorEpoch = Math.max(authorityCursorEpoch + 1, Date.now());
  return `authority:${authorityCursorEpoch}:`;
}
export async function createAppAuthority(
  options: {
    snapshotPath?: string;
  } = {},
): Promise<AppAuthority> {
  const snapshotPath = resolveAuthoritySnapshotPath(options.snapshotPath);
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);

  const authority = await createJsonPersistedAuthoritativeGraph(store, app, {
    path: snapshotPath,
    seed(graph) {
      seedExampleGraph(graph);
    },
    createCursorPrefix: createAuthorityCursorPrefix,
  });

  return {
    snapshotPath,
    ...authority,
  };
}
