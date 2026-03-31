import { applyIdMap, createIdMap, createStore } from "@io/app/graph";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient, type PredicateRef } from "@io/graph-client";
import {
  defineDefaultEnumTypeModule,
  defineEnum,
  defineType,
  entityReferenceComboboxEditorKind,
  existingEntityReferenceField,
} from "@io/graph-module";
import {
  booleanTypeModule,
  colorTypeModule,
  core,
  coreGraphBootstrapOptions,
  dateTypeModule,
  defaultMoneyCurrencyKey,
  durationTypeModule,
  markdownTypeModule,
  moneyTypeModule,
  numberTypeModule,
  percentTypeModule,
  quantityTypeModule,
  rangeTypeModule,
  rateTypeModule,
  stringTypeModule,
  svgTypeModule,
  urlTypeModule,
} from "@io/graph-module-core";

type AnyPredicateRef = PredicateRef<any, any>;

export type ViewsExample = {
  readonly id: string;
  readonly label: string;
  readonly createPredicate: () => AnyPredicateRef;
};

export type ViewsFamily = {
  readonly id: string;
  readonly label: string;
  readonly examples: readonly ViewsExample[];
};

const viewsStatusType = defineEnum({
  values: { key: "views:status", name: "Views Status" },
  options: {
    draft: {
      name: "Draft",
      order: 0,
    },
    inReview: {
      name: "In review",
      order: 1,
    },
    approved: {
      name: "Approved",
      order: 2,
    },
  },
});

const viewsStatusTypeModule = defineDefaultEnumTypeModule(viewsStatusType);

const viewsPerson = defineType({
  values: { key: "views:person", name: "Views Person" },
  fields: {
    ...core.node.fields,
  },
});

const viewsRecord = defineType({
  values: { key: "views:record", name: "Views Record" },
  fields: {
    ...core.node.fields,
    text: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Text",
      },
    }),
    textarea: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Textarea",
        editor: {
          kind: "textarea",
          multiline: true,
        },
      },
    }),
    markdown: markdownTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Markdown",
      },
    }),
    svg: svgTypeModule.field({
      cardinality: "one",
      meta: {
        label: "SVG",
      },
    }),
    number: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Number",
      },
    }),
    enabled: booleanTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Boolean",
      },
    }),
    website: urlTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Link",
      },
    }),
    externalWebsite: urlTypeModule.field({
      cardinality: "one",
      meta: {
        label: "External Link",
        display: {
          kind: "external-link",
        },
      },
    }),
    publishedAt: dateTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Date",
      },
    }),
    estimate: durationTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Duration",
      },
    }),
    accentColor: colorTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Color",
      },
    }),
    completion: percentTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Percent",
      },
    }),
    weight: quantityTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Quantity",
      },
    }),
    completionBand: rangeTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Range",
      },
    }),
    burnRate: rateTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Rate",
      },
    }),
    budget: moneyTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Money",
      },
    }),
    status: viewsStatusTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Status",
        display: {
          kind: "badge",
        },
      },
    }),
    reviewers: existingEntityReferenceField(viewsPerson, {
      cardinality: "many",
      collection: "ordered",
      editorKind: entityReferenceComboboxEditorKind,
      label: "Reviewers",
    }),
  },
});

const viewsNamespace = applyIdMap(createIdMap({ viewsPerson, viewsRecord, viewsStatusType }).map, {
  viewsPerson,
  viewsRecord,
  viewsStatusType,
});

const viewsGraph = { ...core, ...viewsNamespace } as const;

function createViewsFixture() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, viewsNamespace, coreGraphBootstrapOptions);

  const graph = createGraphClient(store, viewsGraph);
  const ownerId = graph.viewsPerson.create({
    name: "Avery Operator",
  });
  const reviewerId = graph.viewsPerson.create({
    name: "Sam Reviewer",
  });
  const recordId = graph.viewsRecord.create({
    accentColor: "#2563eb",
    budget: { amount: 1250, currency: defaultMoneyCurrencyKey },
    burnRate: {
      denominator: {
        kind: "duration",
        value: 86_400_000,
      },
      numerator: {
        kind: "money",
        value: { amount: 1250, currency: defaultMoneyCurrencyKey },
      },
    },
    completion: 72.5,
    completionBand: {
      kind: "percent",
      max: 80,
      min: 10,
    },
    enabled: true,
    estimate: 5_400_000,
    externalWebsite: new URL("https://docs.example.com/views"),
    markdown: "# Views\n\nEditable markdown example.",
    name: "Views Fixture",
    number: 42,
    publishedAt: new Date("2026-03-31T09:30:00.000Z"),
    reviewers: [ownerId, reviewerId],
    status: viewsNamespace.viewsStatusType.options.inReview.id,
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/></svg>',
    text: "Plain text example",
    textarea: "First line of text.\nSecond line of text.",
    website: new URL("https://io.example.com/views"),
    weight: { amount: 12.5, unit: "kg" },
  });

  return {
    record: graph.viewsRecord.ref(recordId),
  };
}

type ViewsFixture = ReturnType<typeof createViewsFixture>;

function createExample(
  id: string,
  label: string,
  select: (fixture: ViewsFixture) => AnyPredicateRef,
): ViewsExample {
  return {
    id,
    label,
    createPredicate() {
      return select(createViewsFixture());
    },
  };
}

export const viewsFamilies = [
  {
    id: "number",
    label: "Number",
    examples: [
      createExample("number-default", "Number", (fixture) => fixture.record.fields.number),
    ],
  },
  {
    id: "string",
    label: "String",
    examples: [
      createExample("string-text", "Text", (fixture) => fixture.record.fields.text),
      createExample("string-textarea", "Textarea", (fixture) => fixture.record.fields.textarea),
      createExample("string-markdown", "Markdown", (fixture) => fixture.record.fields.markdown),
      createExample("string-svg", "SVG", (fixture) => fixture.record.fields.svg),
    ],
  },
  {
    id: "boolean",
    label: "Boolean",
    examples: [
      createExample("boolean-default", "Boolean", (fixture) => fixture.record.fields.enabled),
    ],
  },
  {
    id: "url",
    label: "URL",
    examples: [
      createExample("url-link", "Link", (fixture) => fixture.record.fields.website),
      createExample(
        "url-external",
        "External Link",
        (fixture) => fixture.record.fields.externalWebsite,
      ),
    ],
  },
  {
    id: "date",
    label: "Date",
    examples: [
      createExample("date-default", "Date", (fixture) => fixture.record.fields.publishedAt),
    ],
  },
  {
    id: "duration",
    label: "Duration",
    examples: [
      createExample("duration-default", "Duration", (fixture) => fixture.record.fields.estimate),
    ],
  },
  {
    id: "color",
    label: "Color",
    examples: [
      createExample("color-default", "Color", (fixture) => fixture.record.fields.accentColor),
    ],
  },
  {
    id: "percent",
    label: "Percent",
    examples: [
      createExample("percent-default", "Percent", (fixture) => fixture.record.fields.completion),
    ],
  },
  {
    id: "quantity",
    label: "Quantity",
    examples: [
      createExample("quantity-default", "Quantity", (fixture) => fixture.record.fields.weight),
    ],
  },
  {
    id: "range",
    label: "Range",
    examples: [
      createExample("range-default", "Range", (fixture) => fixture.record.fields.completionBand),
    ],
  },
  {
    id: "rate",
    label: "Rate",
    examples: [createExample("rate-default", "Rate", (fixture) => fixture.record.fields.burnRate)],
  },
  {
    id: "money",
    label: "Money",
    examples: [createExample("money-default", "Money", (fixture) => fixture.record.fields.budget)],
  },
  {
    id: "enum",
    label: "Enum",
    examples: [createExample("enum-badge", "Badge", (fixture) => fixture.record.fields.status)],
  },
  {
    id: "entity-reference",
    label: "Entity Reference",
    examples: [
      createExample(
        "entity-reference-list",
        "Entity Reference",
        (fixture) => fixture.record.fields.reviewers,
      ),
    ],
  },
] as const satisfies readonly ViewsFamily[];
