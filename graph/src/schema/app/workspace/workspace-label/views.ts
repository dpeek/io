import type { ObjectViewSpec } from "../../../../graph/contracts.js";

import { saveWorkspaceLabelCommand } from "./commands.js";
import { workspaceLabel } from "./type.js";

export const workspaceLabelObjectView = {
  key: "app:workspaceLabel:detail",
  entity: workspaceLabel.values.key,
  titleField: "name",
  subtitleField: "key",
  sections: [
    {
      key: "identity",
      title: "Identity",
      description: "Core naming and narrative fields for a workspace label.",
      fields: [
        { path: "name", label: "Name", span: 2 },
        { path: "key", label: "Key" },
        { path: "description", label: "Description", span: 2 },
      ],
    },
    {
      key: "appearance",
      title: "Appearance",
      description: "Visual fields that keep labels recognizable across hosts.",
      fields: [{ path: "color", label: "Color" }],
    },
  ],
  commands: [saveWorkspaceLabelCommand.key],
} satisfies ObjectViewSpec;
