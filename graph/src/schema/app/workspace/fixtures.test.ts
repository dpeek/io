import { describe, expect, it } from "bun:test";

import { bootstrap, core, createStore, createTypeClient, defineNamespace } from "../../../index.js";

import {
  createWorkspaceFixture,
  createWorkspaceIssueFixture,
  createWorkspaceLabelFixture,
  createWorkspaceProjectFixture,
  createWorkspaceWorkflowStatusFixture,
  workspaceSchema,
} from "./index.js";

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? value.key;
}

describe("workspace fixtures", () => {
  it("exports root-safe builders for the workspace slice", () => {
    const workspaceNamespace = defineNamespace({}, workspaceSchema, { strict: false });
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, workspaceNamespace);
    const graph = createTypeClient(store, workspaceNamespace);

    const backlogStatus = createWorkspaceWorkflowStatusFixture(graph, {
      name: "Backlog",
      label: "backlog",
      key: "backlog",
      category: resolvedEnumValue(workspaceNamespace.workflowStatusCategory.values.backlog),
      order: 1,
      color: "#94a3b8",
      description: "Queued work.",
    });

    const planningLabel = createWorkspaceLabelFixture(graph, {
      name: "Planning",
      label: "planning",
      key: "planning",
      color: "#7c3aed",
      description: "Planning work.",
    });

    const roadmapProject = createWorkspaceProjectFixture(graph, {
      name: "Roadmap",
      label: "roadmap",
      key: "roadmap",
      color: "#2563eb",
      targetDate: new Date("2026-03-31T00:00:00.000Z"),
      description: "Roadmap planning.",
    });

    const issue = createWorkspaceIssueFixture(graph, {
      name: "Shape the backlog",
      label: "OPE-1",
      identifier: "OPE-1",
      project: roadmapProject,
      status: backlogStatus,
      labels: [planningLabel],
      priority: 0,
      description: "Seed a planning issue.",
    });

    const workspaceId = createWorkspaceFixture(graph, {
      name: "Planning Workspace",
      label: "planning-workspace",
      key: "planning-workspace",
      description: "Reusable workspace fixture data.",
      projects: [roadmapProject],
      labels: [planningLabel],
      statuses: [backlogStatus],
      issues: [issue],
    });

    expect(graph.workflowStatus.get(backlogStatus)).toMatchObject({
      key: "backlog",
      category: resolvedEnumValue(workspaceNamespace.workflowStatusCategory.values.backlog),
    });
    expect(graph.workspaceLabel.get(planningLabel)).toMatchObject({
      key: "planning",
      color: "#7c3aed",
    });
    expect(graph.workspaceProject.get(roadmapProject)).toMatchObject({
      key: "roadmap",
      color: "#2563eb",
    });
    expect(graph.workspaceIssue.get(issue)).toMatchObject({
      identifier: "OPE-1",
      project: roadmapProject,
      status: backlogStatus,
      labels: [planningLabel],
    });
    expect(graph.workspace.get(workspaceId)).toMatchObject({
      key: "planning-workspace",
      projects: [roadmapProject],
      labels: [planningLabel],
      statuses: [backlogStatus],
      issues: [issue],
    });
  });
});
