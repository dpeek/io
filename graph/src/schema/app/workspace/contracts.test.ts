import { describe, expect, it } from "bun:test";

import type { ObjectViewSpec, WorkflowSpec } from "../../../graph/contracts.js";

import {
  saveWorkspaceIssueCommand,
  saveWorkspaceLabelCommand,
  saveWorkspaceProjectCommand,
  workspaceCommands,
  workspaceManagementWorkflow,
  workspace,
  workspaceIssue,
  workspaceIssueObjectView,
  workspaceLabel,
  workspaceLabelObjectView,
  workspaceObjectViews,
  workspaceProject,
  workspaceProjectObjectView,
  workspaceWorkflows,
} from "./index.js";

type WorkspaceTypeDef = {
  readonly values: {
    readonly key: string;
  };
  readonly fields: Record<string, { readonly key: string }>;
};

function collectObjectViewPaths(view: ObjectViewSpec): string[] {
  return view.sections.flatMap((section) => section.fields.map((field) => field.path));
}

function expectObjectViewAlignment(
  view: ObjectViewSpec,
  typeDef: WorkspaceTypeDef,
  commandKey: string,
): void {
  expect(view.entity).toBe(typeDef.values.key);
  expect(view.commands).toEqual([commandKey]);

  for (const path of collectObjectViewPaths(view)) {
    expect(path in typeDef.fields).toBe(true);
  }

  if (view.titleField) expect(view.titleField in typeDef.fields).toBe(true);
  if (view.subtitleField) expect(view.subtitleField in typeDef.fields).toBe(true);

  for (const relation of view.related ?? []) {
    expect(relation.relationPath in typeDef.fields).toBe(true);
  }
}

function expectWorkflowStep(
  workflow: WorkflowSpec,
  stepKey: string,
  objectViewKey: string,
  commandKey: string,
): void {
  expect(workflow.steps).toContainEqual(
    expect.objectContaining({
      key: stepKey,
      objectView: objectViewKey,
      command: commandKey,
    }),
  );
}

describe("workspace object views and commands", () => {
  it("exports a discoverable root-safe workspace spec surface", () => {
    expect(workspaceObjectViews).toEqual([
      workspaceIssueObjectView,
      workspaceProjectObjectView,
      workspaceLabelObjectView,
    ]);
    expect(workspaceCommands).toEqual([
      saveWorkspaceIssueCommand,
      saveWorkspaceProjectCommand,
      saveWorkspaceLabelCommand,
    ]);
    expect(workspaceWorkflows).toEqual([workspaceManagementWorkflow]);
  });

  it("keeps the workspace issue specs aligned with the schema", () => {
    expectObjectViewAlignment(
      workspaceIssueObjectView,
      workspaceIssue as WorkspaceTypeDef,
      saveWorkspaceIssueCommand.key,
    );
    expect(saveWorkspaceIssueCommand).toMatchObject({
      subject: workspaceIssue.values.key,
      execution: "optimisticVerify",
      policy: {
        capabilities: ["workspace.issue.write"],
        touchesPredicates: [
          workspaceIssue.fields.name.key,
          workspaceIssue.fields.identifier.key,
          workspaceIssue.fields.description.key,
          workspaceIssue.fields.status.key,
          workspaceIssue.fields.project.key,
          workspaceIssue.fields.priority.key,
          workspaceIssue.fields.dueDate.key,
          workspaceIssue.fields.labels.key,
          workspaceIssue.fields.parent.key,
          workspaceIssue.fields.blockedBy.key,
        ],
      },
    });
  });

  it("keeps the workspace project specs aligned with the schema", () => {
    expectObjectViewAlignment(
      workspaceProjectObjectView,
      workspaceProject as WorkspaceTypeDef,
      saveWorkspaceProjectCommand.key,
    );
    expect(saveWorkspaceProjectCommand).toMatchObject({
      subject: workspaceProject.values.key,
      execution: "optimisticVerify",
      policy: {
        capabilities: ["workspace.project.write"],
        touchesPredicates: [
          workspaceProject.fields.name.key,
          workspaceProject.fields.key.key,
          workspaceProject.fields.color.key,
          workspaceProject.fields.targetDate.key,
          workspaceProject.fields.description.key,
        ],
      },
    });
  });

  it("keeps the workspace label specs aligned with the schema", () => {
    expectObjectViewAlignment(
      workspaceLabelObjectView,
      workspaceLabel as WorkspaceTypeDef,
      saveWorkspaceLabelCommand.key,
    );
    expect(saveWorkspaceLabelCommand).toMatchObject({
      subject: workspaceLabel.values.key,
      execution: "optimisticVerify",
      policy: {
        capabilities: ["workspace.label.write"],
        touchesPredicates: [
          workspaceLabel.fields.name.key,
          workspaceLabel.fields.key.key,
          workspaceLabel.fields.color.key,
          workspaceLabel.fields.description.key,
        ],
      },
    });
  });

  it("describes the promoted cross-type workflow for the workspace surface", () => {
    expect(workspaceManagementWorkflow.subjects).toEqual([
      workspace.values.key,
      workspaceIssue.values.key,
      workspaceProject.values.key,
      workspaceLabel.values.key,
    ]);
    expect(workspaceManagementWorkflow.commands).toEqual(
      workspaceCommands.map((command) => command.key),
    );
    expectWorkflowStep(
      workspaceManagementWorkflow,
      "triage-issues",
      workspaceIssueObjectView.key,
      saveWorkspaceIssueCommand.key,
    );
    expectWorkflowStep(
      workspaceManagementWorkflow,
      "shape-projects",
      workspaceProjectObjectView.key,
      saveWorkspaceProjectCommand.key,
    );
    expectWorkflowStep(
      workspaceManagementWorkflow,
      "curate-labels",
      workspaceLabelObjectView.key,
      saveWorkspaceLabelCommand.key,
    );
  });
});
