import { core } from "../../../../graph/core.js";
import { defineType } from "../../../../graph/schema.js";
import { slugTypeModule } from "../../../../type/slug.js";
import { workspaceReferenceField } from "../reference-field.js";
import { workflowStatus } from "../workflow-status/index.js";
import { workspaceIssue } from "../workspace-issue/index.js";
import { workspaceLabel } from "../workspace-label/index.js";
import { workspaceProject } from "../workspace-project/index.js";

export const workspace = defineType({
  values: { key: "app:workspace", name: "Workspace" },
  fields: {
    ...core.node.fields,
    key: slugTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    projects: workspaceReferenceField(workspaceProject, {
      cardinality: "many",
      collection: "ordered",
      label: "Projects",
    }),
    labels: workspaceReferenceField(workspaceLabel, {
      cardinality: "many",
      collection: "unordered",
      label: "Labels",
    }),
    statuses: workspaceReferenceField(workflowStatus, {
      cardinality: "many",
      collection: "ordered",
      label: "Workflow statuses",
    }),
    issues: workspaceReferenceField(workspaceIssue, {
      cardinality: "many",
      collection: "ordered",
      label: "Issues",
    }),
  },
});
