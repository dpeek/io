import {
  createIdMap,
  core,
  defineNamespace,
  defineReferenceField,
  defineType,
  stringTypeModule,
} from "../index.js";
import type { GraphCommandSpec, ObjectViewSpec, WorkflowSpec } from "../index.js";

// Test-only root-safe contract probes that feature work can copy from.
export const probeContractItem = defineType({
  values: { key: "probe:contractItem", name: "Probe Contract Item" },
  fields: {
    ...core.node.fields,
    summary: stringTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Summary",
        editor: {
          kind: "textarea",
          multiline: true,
        },
      },
      filter: {
        operators: ["contains", "equals"] as const,
        defaultOperator: "contains",
      },
    }),
    parent: defineReferenceField({
      range: "probe:contractItem",
      cardinality: "one?",
    }),
    relatedItems: defineReferenceField({
      range: "probe:contractItem",
      cardinality: "many",
    }),
  },
});

export const probeContractGraph = defineNamespace(
  createIdMap({ contractItem: probeContractItem }).map,
  { contractItem: probeContractItem },
);

export const probeContractObjectView = {
  key: "probe:contractItem:summary",
  entity: probeContractItem.values.key,
  titleField: "name",
  subtitleField: "summary",
  sections: [
    {
      key: "summary",
      title: "Summary",
      description: "Fields authored against the root-safe graph surface.",
      fields: [
        { path: "name", label: "Name", span: 2 },
        { path: "summary", label: "Summary", span: 2 },
      ],
    },
  ],
  related: [
    {
      key: "relatedItems",
      title: "Related items",
      relationPath: "relatedItems",
      presentation: "list",
    },
  ],
  commands: ["probe:contractItem:save"],
} satisfies ObjectViewSpec;

export const probeSaveContractItemCommand = {
  key: "probe:contractItem:save",
  label: "Save contract item",
  subject: probeContractItem.values.key,
  execution: "optimisticVerify",
  input: {
    name: "Probe contract item",
    summary: "Validate the contract surface without React.",
  },
  output: {
    itemId: "probe-item-1",
  },
  policy: {
    capabilities: ["probe.contract.write"],
    touchesPredicates: [probeContractItem.fields.name.key, probeContractItem.fields.summary.key],
  },
} satisfies GraphCommandSpec<{ name: string; summary?: string }, { itemId: string }>;

export const probeContractWorkflow = {
  key: "probe:contractItem:review",
  label: "Review contract item",
  description: "Review a graph-authored probe item before saving it.",
  subjects: [probeContractItem.values.key],
  steps: [
    {
      key: "review",
      title: "Review details",
      objectView: probeContractObjectView.key,
    },
    {
      key: "save",
      title: "Save item",
      command: probeSaveContractItemCommand.key,
    },
  ],
  commands: [probeSaveContractItemCommand.key],
} satisfies WorkflowSpec;
