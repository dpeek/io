import { createFileRoute } from "@tanstack/react-router";

import { SyncPage } from "../components/sync-page";
import { isWebSyncProofScopeKey, type WebSyncProofScopeKey } from "../lib/sync-scopes.js";

type SyncRouteSearch = {
  scope: WebSyncProofScopeKey;
};

function validateSyncRouteSearch(search: Record<string, unknown>): SyncRouteSearch {
  return {
    scope:
      typeof search.scope === "string" && isWebSyncProofScopeKey(search.scope)
        ? search.scope
        : "graph",
  };
}

function SyncRoute() {
  const search = Route.useSearch();
  return <SyncPage scopeKey={search.scope} />;
}

export const Route = createFileRoute("/sync")({
  validateSearch: validateSyncRouteSearch,
  component: SyncRoute,
});
