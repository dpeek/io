import { defineAppExperimentWeb } from "../contracts.js";
import { workspaceExperimentGraph } from "./graph.js";
import { WorkspaceManagementScreen } from "./screen.js";

const { description, key, label } = workspaceExperimentGraph;

export const workspaceExperimentWeb = defineAppExperimentWeb({
  key,
  label,
  description,
  routes: [
    {
      component: WorkspaceManagementScreen,
      description: "Issue, project, and label management over the seeded workspace planning model.",
      group: "proofs",
      key: "workspace",
      label: "Workspace",
      path: "/workspace",
      shellClassName:
        "bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.14),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] text-slate-950",
      title: "Workspace management",
    },
  ],
});
