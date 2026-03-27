import { createFileRoute } from "@tanstack/react-router";

import { GraphExplorerPage } from "../components/graph-explorer-page";

function GraphRoute() {
  return <GraphExplorerPage />;
}

export const Route = createFileRoute("/graph")({
  component: GraphRoute,
});
