import type { NamespaceClient } from "@io/graph";
import {
  createWorkspaceFixture,
  createWorkspaceIssueFixture,
  createWorkspaceLabelFixture,
  createWorkspaceProjectFixture,
  createWorkspaceWorkflowStatusFixture,
} from "@io/graph/schema/app/workspace";

import ids from "../../graph/app.json";
import type { workspaceExperimentSchema } from "./graph.js";

type WorkspaceExperimentClient = NamespaceClient<typeof workspaceExperimentSchema>;

const backlogCategoryId = ids.keys["app:workflowStatusCategory.backlog"];
const completedCategoryId = ids.keys["app:workflowStatusCategory.completed"];
const startedCategoryId = ids.keys["app:workflowStatusCategory.started"];
const unstartedCategoryId = ids.keys["app:workflowStatusCategory.unstarted"];

export type WorkspaceExperimentIds = {
  readonly appLabel: string;
  readonly backlogStatus: string;
  readonly doneStatus: string;
  readonly feedbackTriage: string;
  readonly graphLabel: string;
  readonly graphRefDocs: string;
  readonly graphRuntimeProject: string;
  readonly inProgressStatus: string;
  readonly infraLabel: string;
  readonly ioWorkspace: string;
  readonly planningLabel: string;
  readonly seededExperiments: string;
  readonly todoStatus: string;
  readonly workspaceManagement: string;
  readonly workspaceProofProject: string;
  readonly workspaceRoute: string;
  readonly workspaceSchema: string;
};

export function seedWorkspaceExperiment(graph: WorkspaceExperimentClient): WorkspaceExperimentIds {
  const backlogStatus = createWorkspaceWorkflowStatusFixture(graph, {
    name: "Backlog",
    label: "backlog",
    key: "backlog",
    category: backlogCategoryId,
    order: 1,
    color: "#94a3b8",
    description: "Ideas and queued work that are not yet released for execution.",
  });

  const todoStatus = createWorkspaceWorkflowStatusFixture(graph, {
    name: "Todo",
    label: "todo",
    key: "todo",
    category: unstartedCategoryId,
    order: 2,
    color: "#38bdf8",
    description: "Ready work that has not started yet.",
  });

  const inProgressStatus = createWorkspaceWorkflowStatusFixture(graph, {
    name: "In Progress",
    label: "in-progress",
    key: "in-progress",
    category: startedCategoryId,
    order: 3,
    color: "#f59e0b",
    description: "Execution is actively underway.",
  });

  const doneStatus = createWorkspaceWorkflowStatusFixture(graph, {
    name: "Done",
    label: "done",
    key: "done",
    category: completedCategoryId,
    order: 4,
    color: "#22c55e",
    description: "Accepted and landed work.",
  });

  const appLabel = createWorkspaceLabelFixture(graph, {
    name: "App",
    label: "app",
    key: "app",
    color: "#2563eb",
    description: "App-owned schema, route, and proof work.",
  });

  const graphLabel = createWorkspaceLabelFixture(graph, {
    name: "Graph",
    label: "graph",
    key: "graph",
    color: "#0f766e",
    description: "Graph runtime and schema engine work.",
  });

  const planningLabel = createWorkspaceLabelFixture(graph, {
    name: "Planning",
    label: "planning",
    key: "planning",
    color: "#7c3aed",
    description: "Roadmap and workflow shaping work.",
  });

  const infraLabel = createWorkspaceLabelFixture(graph, {
    name: "Infra",
    label: "infra",
    key: "infra",
    color: "#ea580c",
    description: "Support work for runtime and execution surfaces.",
  });

  const workspaceProofProject = createWorkspaceProjectFixture(graph, {
    name: "Workspace proof",
    label: "workspace-proof",
    key: "workspace-proof",
    color: "#2563eb",
    targetDate: new Date("2026-03-31T00:00:00.000Z"),
    description: "Schema and route work for the first app-shaped workspace management proof.",
  });

  const graphRuntimeProject = createWorkspaceProjectFixture(graph, {
    name: "Graph runtime",
    label: "graph-runtime",
    key: "graph-runtime",
    color: "#0f766e",
    targetDate: new Date("2026-03-21T00:00:00.000Z"),
    description: "Runtime capabilities that support the app proof surfaces.",
  });

  const workspaceManagement = createWorkspaceIssueFixture(graph, {
    name: "Build the first workspace management proof",
    label: "OPE-197",
    identifier: "OPE-197",
    project: workspaceProofProject,
    status: inProgressStatus,
    labels: [appLabel, planningLabel],
    priority: 1,
    dueDate: new Date("2026-03-31T00:00:00.000Z"),
    description: "Introduce the first routed planning surface built on the app workspace schema.",
  });

  const workspaceSchema = createWorkspaceIssueFixture(graph, {
    name: "Define the workspace schema and seed Linear-like example data",
    label: "OPE-208",
    identifier: "OPE-208",
    parent: workspaceManagement,
    project: workspaceProofProject,
    status: todoStatus,
    labels: [appLabel],
    priority: 0,
    dueDate: new Date("2026-03-18T00:00:00.000Z"),
    description: "Create the first planning schema slice and representative seed data.",
  });

  const workspaceRoute = createWorkspaceIssueFixture(graph, {
    name: "Build the first workspace management route",
    label: "OPE-209",
    identifier: "OPE-209",
    parent: workspaceManagement,
    project: workspaceProofProject,
    status: backlogStatus,
    labels: [appLabel],
    priority: 0,
    dueDate: new Date("2026-03-24T00:00:00.000Z"),
    blockedBy: [workspaceSchema],
    description: "Add the first operator-facing route on top of the workspace model.",
  });

  const graphRefDocs = createWorkspaceIssueFixture(graph, {
    name: "Document graph refs and UI boundaries",
    label: "OPE-184",
    identifier: "OPE-184",
    project: graphRuntimeProject,
    status: doneStatus,
    labels: [graphLabel],
    priority: 2,
    description: "Capture the current typed ref surface so app routes can build on it confidently.",
  });

  const seededExperiments = createWorkspaceIssueFixture(graph, {
    name: "Split app experiments into seedable slices",
    label: "OPE-203",
    identifier: "OPE-203",
    project: workspaceProofProject,
    status: doneStatus,
    labels: [appLabel, infraLabel],
    priority: 2,
    description: "Keep app-owned proof slices independently seedable and composable.",
  });

  const feedbackTriage = createWorkspaceIssueFixture(graph, {
    name: "Triage route feedback after the first workspace proof",
    label: "OPE-212",
    identifier: "OPE-212",
    status: backlogStatus,
    labels: [planningLabel],
    priority: 3,
    blockedBy: [workspaceRoute],
    description: "Collect follow-on workflow gaps once the first management route lands.",
  });

  const ioWorkspace = createWorkspaceFixture(graph, {
    name: "IO Planning Workspace",
    label: "io-planning",
    key: "io-planning",
    description: "Representative Linear-like planning data for app and graph proof work.",
    projects: [workspaceProofProject, graphRuntimeProject],
    labels: [appLabel, graphLabel, planningLabel, infraLabel],
    statuses: [backlogStatus, todoStatus, inProgressStatus, doneStatus],
    issues: [
      workspaceManagement,
      workspaceSchema,
      workspaceRoute,
      graphRefDocs,
      seededExperiments,
      feedbackTriage,
    ],
  });

  return {
    appLabel,
    backlogStatus,
    doneStatus,
    feedbackTriage,
    graphLabel,
    graphRefDocs,
    graphRuntimeProject,
    inProgressStatus,
    infraLabel,
    ioWorkspace,
    planningLabel,
    seededExperiments,
    todoStatus,
    workspaceManagement,
    workspaceProofProject,
    workspaceRoute,
    workspaceSchema,
  };
}
