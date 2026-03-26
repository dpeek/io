import type {
  SyncState as PackageSyncState,
  SyncStatus as PackageSyncStatus,
} from "@io/graph-sync";

import type {
  SyncState as CompatibilitySyncState,
  SyncStatus as CompatibilitySyncStatus,
} from "./synced-client.js";

const compatibilityStatus: CompatibilitySyncStatus = "pushing";
const packageStatus: PackageSyncStatus = "ready";

void compatibilityStatus;
void packageStatus;

void ({
  mode: "total",
  requestedScope: { kind: "graph" },
  scope: { kind: "graph" },
  status: "pushing",
  completeness: "incomplete",
  freshness: "stale",
  pendingCount: 0,
  recentActivities: [],
} satisfies CompatibilitySyncState);

void ({
  mode: "total",
  requestedScope: { kind: "graph" },
  scope: { kind: "graph" },
  status: "ready",
  completeness: "incomplete",
  freshness: "stale",
  pendingCount: 0,
  recentActivities: [],
} satisfies PackageSyncState);

void ({
  mode: "total",
  requestedScope: { kind: "graph" },
  scope: { kind: "graph" },
  // @ts-expect-error sync-core state excludes the synced-client flush status
  status: "pushing",
  completeness: "incomplete",
  freshness: "stale",
  pendingCount: 0,
  recentActivities: [],
} satisfies PackageSyncState);
