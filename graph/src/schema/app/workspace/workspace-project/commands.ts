import type { GraphCommandSpec } from "../../../../graph/contracts.js";

import { workspaceProject } from "./type.js";

export type SaveWorkspaceProjectCommandInput = {
  readonly color: string;
  readonly description?: string;
  readonly key: string;
  readonly name: string;
  readonly targetDate?: Date;
};

export type SaveWorkspaceProjectCommandOutput = {
  readonly projectId: string;
};

export const saveWorkspaceProjectCommand = {
  key: "app:workspaceProject:save",
  label: "Save workspace project",
  subject: workspaceProject.values.key,
  execution: "optimisticVerify",
  input: {
    name: "Roadmap",
    key: "roadmap",
    color: "#2563eb",
    targetDate: new Date("2026-03-31T00:00:00.000Z"),
    description: "Track the planning milestone for the workspace slice.",
  },
  output: {
    projectId: "project-1",
  },
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
} satisfies GraphCommandSpec<SaveWorkspaceProjectCommandInput, SaveWorkspaceProjectCommandOutput>;
