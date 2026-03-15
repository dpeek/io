import type { ObjectViewSpec } from "../../../../graph/contracts.js";

import { saveWorkspaceIssueCommand } from "./commands.js";
import { workspaceIssue } from "./type.js";

export const workspaceIssueObjectView = {
  key: "app:workspaceIssue:detail",
  entity: workspaceIssue.values.key,
  titleField: "name",
  subtitleField: "identifier",
  sections: [
    {
      key: "identity",
      title: "Identity",
      description: "Core identity and narrative fields for a workspace issue.",
      fields: [
        { path: "name", label: "Title", span: 2 },
        { path: "identifier", label: "Identifier" },
        { path: "description", label: "Description", span: 2 },
      ],
    },
    {
      key: "planning",
      title: "Planning",
      description: "Planning and scheduling fields for issue management.",
      fields: [
        { path: "status", label: "Status" },
        { path: "project", label: "Project" },
        { path: "priority", label: "Priority" },
        { path: "dueDate", label: "Due date" },
        { path: "parent", label: "Parent issue", span: 2 },
      ],
    },
    {
      key: "relationships",
      title: "Relationships",
      description: "Related workspace references that stay normalized in the graph.",
      fields: [
        { path: "labels", label: "Labels", span: 2 },
        { path: "blockedBy", label: "Blocked by", span: 2 },
      ],
    },
  ],
  related: [
    {
      key: "blockedBy",
      title: "Blocked by",
      relationPath: "blockedBy",
      presentation: "list",
    },
  ],
  commands: [saveWorkspaceIssueCommand.key],
} satisfies ObjectViewSpec;
