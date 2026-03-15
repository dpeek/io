import { core } from "../../../../graph/core.js";
import { defineType } from "../../../../graph/schema.js";
import { numberTypeModule } from "../../../../type/number/index.js";
import { stringTypeModule } from "../../../../type/string/index.js";
import { dateTypeModule } from "../../../core/date/index.js";
import { workspaceReferenceField } from "../reference-field.js";
import { workflowStatus } from "../workflow-status/index.js";
import { workspaceLabel } from "../workspace-label/index.js";
import { workspaceProject } from "../workspace-project/index.js";

export const workspaceIssue = defineType({
  values: { key: "app:workspaceIssue", name: "Workspace Issue" },
  fields: {
    ...core.node.fields,
    identifier: stringTypeModule.field({
      cardinality: "one",
      validate: ({ value }) =>
        typeof value === "string" && value.trim().length > 0
          ? undefined
          : {
              code: "string.blank",
              message: "Identifier must not be blank.",
            },
      meta: {
        label: "Identifier",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    priority: numberTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Priority",
      },
      filter: {
        operators: ["equals", "lt", "gt"] as const,
        defaultOperator: "equals",
      },
    }),
    dueDate: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Due date",
      },
      filter: {
        operators: ["on", "before", "after"] as const,
        defaultOperator: "on",
      },
    }),
    project: workspaceReferenceField(workspaceProject, {
      cardinality: "one?",
      label: "Project",
    }),
    status: workspaceReferenceField(workflowStatus, {
      cardinality: "one",
      label: "Status",
    }),
    labels: workspaceReferenceField(workspaceLabel, {
      cardinality: "many",
      collection: "unordered",
      label: "Labels",
    }),
    parent: workspaceReferenceField("app:workspaceIssue", {
      cardinality: "one?",
      label: "Parent issue",
    }),
    blockedBy: workspaceReferenceField("app:workspaceIssue", {
      cardinality: "many",
      collection: "unordered",
      label: "Blocked by",
    }),
  },
});
