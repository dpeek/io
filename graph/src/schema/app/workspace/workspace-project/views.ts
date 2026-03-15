import type { ObjectViewSpec } from "../../../../graph/contracts.js";

import { saveWorkspaceProjectCommand } from "./commands.js";
import { workspaceProject } from "./type.js";

export const workspaceProjectObjectView = {
  key: "app:workspaceProject:detail",
  entity: workspaceProject.values.key,
  titleField: "name",
  subtitleField: "key",
  sections: [
    {
      key: "identity",
      title: "Identity",
      description: "Core naming and narrative fields for a workspace project.",
      fields: [
        { path: "name", label: "Name", span: 2 },
        { path: "key", label: "Key" },
        { path: "description", label: "Description", span: 2 },
      ],
    },
    {
      key: "planning",
      title: "Planning",
      description: "Scheduling and visual fields for project-level planning.",
      fields: [
        { path: "color", label: "Color" },
        { path: "targetDate", label: "Target date" },
      ],
    },
  ],
  commands: [saveWorkspaceProjectCommand.key],
} satisfies ObjectViewSpec;
