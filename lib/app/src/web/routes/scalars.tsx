import { createFileRoute } from "@tanstack/react-router";

import { ViewsPage } from "../components/views-page";

export const Route = createFileRoute("/scalars")({
  component: ViewsPage,
});
