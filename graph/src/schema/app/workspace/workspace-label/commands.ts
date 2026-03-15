import type { GraphCommandSpec } from "../../../../graph/contracts.js";

import { workspaceLabel } from "./type.js";

export type SaveWorkspaceLabelCommandInput = {
  readonly color: string;
  readonly description?: string;
  readonly key: string;
  readonly name: string;
};

export type SaveWorkspaceLabelCommandOutput = {
  readonly labelId: string;
};

export const saveWorkspaceLabelCommand = {
  key: "app:workspaceLabel:save",
  label: "Save workspace label",
  subject: workspaceLabel.values.key,
  execution: "optimisticVerify",
  input: {
    name: "Planning",
    key: "planning",
    color: "#10b981",
    description: "Group related planning work inside the workspace slice.",
  },
  output: {
    labelId: "label-1",
  },
  policy: {
    capabilities: ["workspace.label.write"],
    touchesPredicates: [
      workspaceLabel.fields.name.key,
      workspaceLabel.fields.key.key,
      workspaceLabel.fields.color.key,
      workspaceLabel.fields.description.key,
    ],
  },
} satisfies GraphCommandSpec<SaveWorkspaceLabelCommandInput, SaveWorkspaceLabelCommandOutput>;
