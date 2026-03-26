import { createFileRoute } from "@tanstack/react-router";

import { ViewsPage } from "../components/views-page";
import { validateQueryWorkbenchRouteSearch } from "../lib/query-workbench.js";

function ViewsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ViewsPage
      onSearchChange={(nextSearch) =>
        navigate({
          replace: true,
          search: nextSearch,
        })
      }
      search={search}
    />
  );
}

export const Route = createFileRoute("/views")({
  validateSearch: validateQueryWorkbenchRouteSearch,
  component: ViewsRoute,
});
