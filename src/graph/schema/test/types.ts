import { defineType } from "@io/core/graph/def";

import {
  entityReferenceComboboxEditorKind,
  existingEntityReferenceField,
} from "../../graph/reference-policy.js";
import { defineSecretField } from "../../graph/type-module.js";
import { core } from "../../modules/core.js";
import { booleanTypeModule } from "../../modules/core/boolean/index.js";
import { colorTypeModule } from "../../modules/core/color/index.js";
import { dateTypeModule } from "../../modules/core/date/index.js";
import { durationTypeModule } from "../../modules/core/duration/index.js";
import { emailTypeModule } from "../../modules/core/email/index.js";
import { jsonTypeModule } from "../../modules/core/json/index.js";
import { markdownTypeModule } from "../../modules/core/markdown/index.js";
import { numberTypeModule } from "../../modules/core/number/index.js";
import { percentTypeModule } from "../../modules/core/percent/index.js";
import { slugTypeModule } from "../../modules/core/slug/index.js";
import { stringTypeModule } from "../../modules/core/string/index.js";
import { urlTypeModule } from "../../modules/core/url/index.js";
import { kitchenSinkSeverityTypeModule, kitchenSinkStatusTypeModule } from "./enums.js";
import { kitchenSinkReferenceField } from "./reference-field.js";
import { kitchenSinkScoreTypeModule } from "./scalars.js";

const replicatedAuthority = {
  visibility: "replicated",
  write: "server-command",
} as const;

export const kitchenSinkSecret = defineType({
  values: { key: "kitchen:secret", name: "Kitchen Sink Secret" },
  fields: {
    ...core.node.fields,
    name: {
      ...core.node.fields.name,
      authority: replicatedAuthority,
    },
    createdAt: {
      ...core.node.fields.createdAt,
      authority: replicatedAuthority,
    },
    updatedAt: {
      ...core.node.fields.updatedAt,
      authority: replicatedAuthority,
    },
    version: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Version",
      },
      authority: replicatedAuthority,
    }),
    fingerprint: stringTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Fingerprint",
      },
      authority: {
        visibility: "authority-only",
        write: "authority-only",
      },
    }),
  },
});

export const kitchenSinkPerson = defineType({
  values: { key: "kitchen:person", name: "Kitchen Sink Person" },
  fields: {
    ...core.node.fields,
    email: emailTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Email",
      },
    }),
    status: kitchenSinkStatusTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Status",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    manager: kitchenSinkReferenceField("kitchen:person", {
      cardinality: "one?",
      label: "Manager",
    }),
    peers: kitchenSinkReferenceField("kitchen:person", {
      cardinality: "many",
      collection: "ordered",
      label: "Peers",
    }),
    worksAt: kitchenSinkReferenceField("kitchen:company", {
      cardinality: "many",
      collection: "ordered",
      label: "Works at",
    }),
    confidentialNotes: stringTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Confidential notes",
        description: "Authority-only operator notes.",
        searchable: false,
        group: "Internal",
        priority: 100,
        editor: {
          kind: "textarea",
          multiline: true,
        },
      },
      authority: {
        visibility: "authority-only",
        write: "authority-only",
      },
    }),
  },
});

export const kitchenSinkCompany = defineType({
  values: { key: "kitchen:company", name: "Kitchen Sink Company" },
  fields: {
    ...core.node.fields,
    website: urlTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Website",
        display: {
          kind: "external-link",
        },
      },
    }),
    status: kitchenSinkStatusTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Status",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    tags: existingEntityReferenceField(core.tag, {
      cardinality: "many",
      collection: "unordered",
      create: true,
      editorKind: entityReferenceComboboxEditorKind,
      label: "Tags",
    }),
    foundedYear: numberTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Founded year",
      },
    }),
  },
});

export const kitchenSinkBlock = defineType({
  values: { key: "kitchen:block", name: "Kitchen Sink Block" },
  fields: {
    ...core.node.fields,
    text: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Text",
        editor: {
          kind: "textarea",
          multiline: true,
        },
      },
    }),
    order: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Order",
      },
    }),
    collapsed: booleanTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Collapsed",
      },
    }),
  },
});

export const kitchenSinkRecord = defineType({
  values: { key: "kitchen:record", name: "Kitchen Sink Record" },
  fields: {
    ...core.node.fields,
    slug: slugTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Slug",
      },
    }),
    headline: stringTypeModule.field({
      cardinality: "one",
      validate: ({ value }) =>
        typeof value === "string" && value.startsWith("KS-")
          ? undefined
          : {
              code: "headline.prefix",
              message: "Headline must start with KS-.",
            },
      meta: {
        label: "Headline",
      },
      filter: {
        operators: ["equals", "contains", "prefix"] as const,
        defaultOperator: "prefix",
      },
    }),
    status: kitchenSinkStatusTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Status",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    statusHistory: kitchenSinkStatusTypeModule.field({
      cardinality: "many",
      meta: {
        label: "Status history",
      },
    }),
    severity: kitchenSinkSeverityTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Severity",
        display: {
          kind: "badge",
        },
      },
    }),
    score: kitchenSinkScoreTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Score",
      },
    }),
    completion: percentTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Completion",
      },
    }),
    duration: durationTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Duration",
      },
    }),
    estimate: numberTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Estimate",
      },
      filter: {
        operators: ["equals", "gt", "lt"] as const,
        defaultOperator: "equals",
      },
    }),
    archived: booleanTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Archived",
      },
    }),
    published: booleanTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Published",
        editor: {
          kind: "switch",
        },
      },
    }),
    website: urlTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Website",
        display: {
          kind: "external-link",
        },
      },
    }),
    contactEmail: emailTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Contact email",
      },
      filter: {
        operators: ["equals", "domain"] as const,
        defaultOperator: "domain",
      },
    }),
    details: markdownTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Details",
      },
    }),
    metadata: jsonTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Metadata",
      },
    }),
    accentColor: colorTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Accent color",
      },
    }),
    externalId: stringTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "External id",
      },
      onCreate: ({ incoming, nodeId }) => incoming ?? nodeId,
    }),
    syncedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Synced at",
      },
      onCreate: ({ incoming, now }) => incoming ?? now,
      onUpdate: ({ changedPredicateKeys, now }) =>
        [...changedPredicateKeys].some((key) => !key.endsWith(":syncedAt")) ? now : undefined,
    }),
    owner: kitchenSinkReferenceField(kitchenSinkPerson, {
      cardinality: "one?",
      label: "Owner",
    }),
    reviewers: kitchenSinkReferenceField(kitchenSinkPerson, {
      cardinality: "many",
      collection: "ordered",
      label: "Reviewers",
    }),
    tags: existingEntityReferenceField(core.tag, {
      cardinality: "many",
      collection: "unordered",
      create: true,
      editorKind: entityReferenceComboboxEditorKind,
      label: "Tags",
    }),
    secret: defineSecretField({
      range: kitchenSinkSecret,
      cardinality: "one?",
      meta: {
        label: "Secret",
      },
      revealCapability: "secret:reveal",
      rotateCapability: "secret:rotate",
    }),
    parent: kitchenSinkReferenceField("kitchen:record", {
      cardinality: "one?",
      label: "Parent",
    }),
    relatedRecords: kitchenSinkReferenceField("kitchen:record", {
      cardinality: "many",
      collection: "ordered",
      label: "Related records",
    }),
    review: {
      reviewer: kitchenSinkReferenceField(kitchenSinkPerson, {
        cardinality: "one?",
        label: "Reviewer",
      }),
      approvedAt: dateTypeModule.field({
        cardinality: "one?",
        meta: {
          label: "Approved at",
        },
      }),
      notes: stringTypeModule.field({
        cardinality: "one?",
        meta: {
          label: "Review notes",
          editor: {
            kind: "textarea",
            multiline: true,
          },
        },
      }),
    },
    contact: {
      website: urlTypeModule.field({
        cardinality: "one?",
        meta: {
          label: "Support website",
          display: {
            kind: "external-link",
          },
        },
      }),
      email: emailTypeModule.field({
        cardinality: "one?",
        meta: {
          label: "Support email",
        },
      }),
    },
  },
});

export const kitchenSinkTypeSchema = {
  company: kitchenSinkCompany,
  block: kitchenSinkBlock,
  secret: kitchenSinkSecret,
  person: kitchenSinkPerson,
  record: kitchenSinkRecord,
} as const;
