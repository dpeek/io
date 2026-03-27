import {
  defineDefaultEnumTypeModule,
  defineEnum,
  defineType,
  entityReferenceComboboxEditorKind,
  existingEntityReferenceField,
} from "@io/graph-module";
import {
  booleanTypeModule,
  core,
  markdownTypeModule,
  numberTypeModule,
  slugTypeModule,
  stringTypeModule,
} from "@io/graph-module-core";

function validateRequiredString(label: string, value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? undefined
    : {
        code: "string.blank",
        message: `${label} must not be blank.`,
      };
}

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? value.key;
}

function validateNonNegativeInteger(label: string, value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? undefined
    : {
        code: "document.integer.invalid",
        message: `${label} must be a non-negative integer.`,
      };
}

function requiredStringField(
  label: string,
  input?: {
    defaultOperator?: "contains" | "equals" | "prefix";
    multiline?: boolean;
    operators?: readonly ["contains", "equals"] | readonly ["equals", "prefix"];
  },
) {
  return stringTypeModule.field({
    cardinality: "one",
    validate: ({ value }) => validateRequiredString(label, value),
    meta: {
      label,
      ...(input?.multiline
        ? {
            editor: {
              kind: "textarea",
              multiline: true,
            },
          }
        : {}),
    },
    filter: {
      operators: input?.operators ?? (["equals", "prefix"] as const),
      defaultOperator: input?.defaultOperator ?? "equals",
    },
  });
}

function optionalStringField(
  label: string,
  input?: {
    defaultOperator?: "contains" | "equals" | "prefix";
    multiline?: boolean;
    operators?: readonly ["contains", "equals"] | readonly ["equals", "prefix"];
  },
) {
  return stringTypeModule.field({
    cardinality: "one?",
    meta: {
      label,
      ...(input?.multiline
        ? {
            editor: {
              kind: "textarea",
              multiline: true,
            },
          }
        : {}),
    },
    filter: {
      operators: input?.operators ?? (["equals", "prefix"] as const),
      defaultOperator: input?.defaultOperator ?? "equals",
    },
  });
}

function titleNodeFields(label: string, descriptionLabel = "Description") {
  return {
    ...core.node.fields,
    name: {
      ...core.node.fields.name,
      meta: {
        ...core.node.fields.name.meta,
        label,
      },
    },
    description: {
      ...core.node.fields.description,
      meta: {
        ...core.node.fields.description.meta,
        label: descriptionLabel,
      },
    },
  };
}

export const document = defineType({
  values: { key: "workflow:document", name: "Document" },
  fields: {
    ...titleNodeFields("Document title"),
    isArchived: {
      ...booleanTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) => incoming ?? false,
        meta: {
          label: "Is archived",
        },
      }),
      createOptional: true as const,
    },
    slug: slugTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Slug",
      },
    }),
    tags: existingEntityReferenceField(core.tag, {
      cardinality: "many",
      collection: "unordered",
      create: true,
      editorKind: entityReferenceComboboxEditorKind,
      label: "Tags",
    }),
  },
});

export const documentBlockKindType = defineEnum({
  values: { key: "workflow:documentBlockKind", name: "Document Block Kind" },
  options: {
    markdown: {
      name: "Markdown",
      description: "Stores authored markdown content inline.",
    },
    entity: {
      name: "Entity include",
      description: "Includes or points at another graph entity.",
    },
    "repo-path": {
      name: "Repository path",
      description: "Includes or points at a markdown file on disk.",
    },
  },
});

export const documentBlockKindTypeModule = defineDefaultEnumTypeModule(documentBlockKindType);

export const documentBlockKind = documentBlockKindTypeModule.type;

export const documentBlock = defineType({
  values: { key: "workflow:documentBlock", name: "Document Block" },
  fields: {
    ...titleNodeFields("Block title"),
    document: existingEntityReferenceField(document, {
      cardinality: "one",
      label: "Document",
    }),
    order: numberTypeModule.field({
      cardinality: "one",
      validate: ({ value }) => validateNonNegativeInteger("Block order", value),
      meta: {
        label: "Order",
      },
    }),
    kind: {
      ...documentBlockKindTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) =>
          incoming ?? resolvedEnumValue(documentBlockKind.values.markdown),
        meta: {
          label: "Kind",
          display: {
            kind: "badge",
          },
        },
        filter: {
          operators: ["is", "oneOf"] as const,
          defaultOperator: "is",
        },
      }),
      createOptional: true as const,
    },
    content: markdownTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Markdown",
      },
      filter: {
        operators: ["contains", "prefix"] as const,
        defaultOperator: "contains",
      },
    }),
    entity: existingEntityReferenceField(core.node, {
      cardinality: "one?",
      label: "Entity",
    }),
    path: optionalStringField("Repository path", {
      defaultOperator: "prefix",
    }),
  },
});

export const documentPlacement = defineType({
  values: { key: "workflow:documentPlacement", name: "Document Placement" },
  fields: {
    ...titleNodeFields("Placement title"),
    document: existingEntityReferenceField(document, {
      cardinality: "one",
      label: "Document",
    }),
    treeKey: requiredStringField("Tree key"),
    parentPlacement: existingEntityReferenceField("workflow:documentPlacement", {
      cardinality: "one?",
      excludeSubject: true,
      label: "Parent placement",
    }),
    order: numberTypeModule.field({
      cardinality: "one",
      validate: ({ value }) => validateNonNegativeInteger("Placement order", value),
      meta: {
        label: "Order",
      },
    }),
    slug: slugTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Slug",
      },
    }),
  },
});

export const documentSchema = {
  document,
  documentBlockKind,
  documentBlock,
  documentPlacement,
} as const;
