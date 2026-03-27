import { createFileRoute } from "@tanstack/react-router";

import { WorkflowPage } from "../components/workflow-page";
import { validateWorkflowRouteSearch } from "../lib/workflow-review-contract.js";

function WorkflowRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <WorkflowPage
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

export const Route = createFileRoute("/workflow")({
  validateSearch: validateWorkflowRouteSearch,
  component: WorkflowRoute,
});
