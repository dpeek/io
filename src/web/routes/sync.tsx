import { createFileRoute } from "@tanstack/react-router";

import { SyncPage } from "../components/sync-page";

function SyncRoute() {
  return <SyncPage />;
}

export const Route = createFileRoute("/sync")({
  component: SyncRoute,
});
