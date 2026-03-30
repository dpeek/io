import { describe, expect, it } from "bun:test";

import type { QueryFilterOperator, QueryLiteral, QueryParameterType } from "@io/graph-client";
import { querySurfaceFieldKindValues, type QuerySurfaceFieldKind } from "@io/graph-projection";

import {
  QueryEditorHydrationError,
  QueryEditorValidationError,
  addQueryEditorFilter,
  addQueryEditorParameter,
  createQueryEditorCatalog,
  createQueryEditorDraft,
  hydrateQueryEditorDraft,
  serializeQueryEditorDraft,
  updateQueryEditorFilter,
  updateQueryEditorParameter,
  validateQueryEditorDraft,
  type QueryEditorCatalog,
  type QueryEditorFieldControl,
  type QueryEditorFieldSpec,
} from "./query-editor.js";
import {
  isQueryEditorFieldKindSupported,
  queryEditorUnsupportedFieldKindValues,
  type QueryEditorSupportedFieldKind,
} from "./query-editor-value-semantics.js";

type SupportedFieldCase = {
  readonly control: QueryEditorFieldControl;
  readonly expectedListParameterDefault: QueryLiteral;
  readonly expectedSingleParameterDefault: QueryLiteral;
  readonly expectedValue: QueryLiteral;
  readonly kind: QueryEditorSupportedFieldKind;
  readonly listParameterDefault: QueryLiteral;
  readonly listParameterType: QueryParameterType;
  readonly operator: Exclude<QueryFilterOperator, "and" | "or" | "not" | "exists" | "in">;
  readonly options?: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly rawValue: QueryLiteral;
  readonly singleParameterDefault: QueryLiteral;
  readonly singleParameterType: QueryParameterType;
};

const surfaceId = "test:shared-query-authoring";
const surfaceVersion = "query-surface:test:shared-query-authoring:v1";

const supportedFieldCases = [
  {
    control: "enum",
    expectedListParameterDefault: ["draft", "ready"],
    expectedSingleParameterDefault: "ready",
    expectedValue: "draft",
    kind: "enum",
    listParameterDefault: ["draft", "ready"],
    listParameterType: "enum-list",
    operator: "eq",
    options: [
      { label: "Draft", value: "draft" },
      { label: "Ready", value: "ready" },
    ],
    rawValue: "draft",
    singleParameterDefault: "ready",
    singleParameterType: "enum",
  },
  {
    control: "entity-ref",
    expectedListParameterDefault: ["person:avery", "person:sam"],
    expectedSingleParameterDefault: "person:avery",
    expectedValue: "person:sam",
    kind: "entity-ref",
    listParameterDefault: ["person:avery", "person:sam"],
    listParameterType: "entity-ref-list",
    operator: "eq",
    options: [
      { label: "Avery", value: "person:avery" },
      { label: "Sam", value: "person:sam" },
    ],
    rawValue: "person:sam",
    singleParameterDefault: "person:avery",
    singleParameterType: "entity-ref",
  },
  {
    control: "date",
    expectedListParameterDefault: ["2026-03-27T00:00:00.000Z", "2026-03-28T00:00:00.000Z"],
    expectedSingleParameterDefault: "2026-03-27T00:00:00.000Z",
    expectedValue: "2026-03-26T00:00:00.000Z",
    kind: "date",
    listParameterDefault: ["2026-03-27", "2026-03-28"],
    listParameterType: "date-list",
    operator: "gte",
    rawValue: "2026-03-26",
    singleParameterDefault: "2026-03-27",
    singleParameterType: "date",
  },
  {
    control: "boolean",
    expectedListParameterDefault: [true, false],
    expectedSingleParameterDefault: false,
    expectedValue: true,
    kind: "boolean",
    listParameterDefault: [true, false],
    listParameterType: "boolean-list",
    operator: "eq",
    rawValue: true,
    singleParameterDefault: false,
    singleParameterType: "boolean",
  },
  {
    control: "text",
    expectedListParameterDefault: ["workflow", "graph"],
    expectedSingleParameterDefault: "shared query",
    expectedValue: "operator shell",
    kind: "text",
    listParameterDefault: ["workflow", "graph"],
    listParameterType: "string-list",
    operator: "contains",
    rawValue: "operator shell",
    singleParameterDefault: "shared query",
    singleParameterType: "string",
  },
  {
    control: "number",
    expectedListParameterDefault: [2, 5],
    expectedSingleParameterDefault: 3,
    expectedValue: 2,
    kind: "number",
    listParameterDefault: ["2", "5"],
    listParameterType: "number-list",
    operator: "gte",
    rawValue: "2",
    singleParameterDefault: "3",
    singleParameterType: "number",
  },
  {
    control: "text",
    expectedListParameterDefault: ["https://example.com/docs", "https://example.com/releases"],
    expectedSingleParameterDefault: "https://example.com/releases",
    expectedValue: "https://example.com/docs",
    kind: "url",
    listParameterDefault: ["https://example.com/docs", "https://example.com/releases"],
    listParameterType: "url-list",
    operator: "eq",
    rawValue: "https://example.com/docs",
    singleParameterDefault: "https://example.com/releases",
    singleParameterType: "url",
  },
  {
    control: "text",
    expectedListParameterDefault: ["team@example.com", "alerts@example.com"],
    expectedSingleParameterDefault: "admin@example.com",
    expectedValue: "review@example.com",
    kind: "email",
    listParameterDefault: ["Team@Example.com", "Alerts@Example.com"],
    listParameterType: "email-list",
    operator: "eq",
    rawValue: "Review@Example.com",
    singleParameterDefault: "Admin@Example.com",
    singleParameterType: "email",
  },
  {
    control: "text",
    expectedListParameterDefault: ["#2563eb", "#0f172a"],
    expectedSingleParameterDefault: "#0f172a",
    expectedValue: "#2563eb",
    kind: "color",
    listParameterDefault: ["#2563EB", "#0F172A"],
    listParameterType: "color-list",
    operator: "eq",
    rawValue: "#2563EB",
    singleParameterDefault: "#0F172A",
    singleParameterType: "color",
  },
  {
    control: "number",
    expectedListParameterDefault: [25, 50],
    expectedSingleParameterDefault: 50,
    expectedValue: 25,
    kind: "percent",
    listParameterDefault: ["25%", "50%"],
    listParameterType: "percent-list",
    operator: "gte",
    rawValue: "25%",
    singleParameterDefault: "50%",
    singleParameterType: "percent",
  },
  {
    control: "text",
    expectedListParameterDefault: ["30 min", "2 hr"],
    expectedSingleParameterDefault: "2 hr",
    expectedValue: "30 min",
    kind: "duration",
    listParameterDefault: ["30 min", "2 hr"],
    listParameterType: "duration-list",
    operator: "gt",
    rawValue: "30 min",
    singleParameterDefault: "2 hr",
    singleParameterType: "duration",
  },
  {
    control: "text",
    expectedListParameterDefault: ["12 USD", "5 EUR"],
    expectedSingleParameterDefault: "5 EUR",
    expectedValue: "12 USD",
    kind: "money",
    listParameterDefault: ["12 usd", "5 eur"],
    listParameterType: "money-list",
    operator: "eq",
    rawValue: "12 usd",
    singleParameterDefault: "5 eur",
    singleParameterType: "money",
  },
  {
    control: "text",
    expectedListParameterDefault: ["5 kg", "7 m"],
    expectedSingleParameterDefault: "7 m",
    expectedValue: "5 kg",
    kind: "quantity",
    listParameterDefault: ["5 kg", "7 m"],
    listParameterType: "quantity-list",
    operator: "eq",
    rawValue: "5 kg",
    singleParameterDefault: "7 m",
    singleParameterType: "quantity",
  },
  {
    control: "text",
    expectedListParameterDefault: ["percent(10%) .. percent(80%)", "money(5 USD) .. money(12 USD)"],
    expectedSingleParameterDefault: "money(5 USD) .. money(12 USD)",
    expectedValue: "percent(10%) .. percent(80%)",
    kind: "range",
    listParameterDefault: ["percent(10%) .. percent(80%)", "money(5 USD) .. money(12 USD)"],
    listParameterType: "range-list",
    operator: "eq",
    rawValue: "percent(10%) .. percent(80%)",
    singleParameterDefault: "money(5 USD) .. money(12 USD)",
    singleParameterType: "range",
  },
  {
    control: "text",
    expectedListParameterDefault: [
      "money(125 USD) / duration(1 day)",
      "quantity(5 kg) / duration(2 hr)",
    ],
    expectedSingleParameterDefault: "quantity(5 kg) / duration(2 hr)",
    expectedValue: "money(125 USD) / duration(1 day)",
    kind: "rate",
    listParameterDefault: ["money(125 USD) / duration(1 day)", "quantity(5 kg) / duration(2 hr)"],
    listParameterType: "rate-list",
    operator: "eq",
    rawValue: "money(125 USD) / duration(1 day)",
    singleParameterDefault: "quantity(5 kg) / duration(2 hr)",
    singleParameterType: "rate",
  },
] as const satisfies readonly SupportedFieldCase[];

function fieldIdForKind(kind: QuerySurfaceFieldKind): string {
  return `${kind}-field`;
}

function parameterNameForKind(kind: QuerySurfaceFieldKind, suffix: string): string {
  return `${kind}-${suffix}`;
}

function createCollectionCatalog(fields: readonly QueryEditorFieldSpec[]): QueryEditorCatalog {
  return createQueryEditorCatalog([
    {
      defaultPageSize: 25,
      fields,
      label: "Shared Query Authoring Coverage",
      queryKind: "collection",
      sourceKind: "projection",
      surfaceId,
      surfaceVersion,
    },
  ]);
}

function createFieldSpec(
  fieldCase: SupportedFieldCase,
  operators: readonly QueryFilterOperator[],
): QueryEditorFieldSpec {
  return {
    control: fieldCase.control,
    fieldId: fieldIdForKind(fieldCase.kind),
    filterOperators: operators,
    kind: fieldCase.kind,
    label: `${fieldCase.kind} field`,
    ...(fieldCase.options ? { options: fieldCase.options } : {}),
  };
}

describe("query editor shared authoring coverage", () => {
  it("keeps the supported and excluded predicate-family boundary explicit", () => {
    expect(
      querySurfaceFieldKindValues.filter((kind) => isQueryEditorFieldKindSupported(kind)),
    ).toEqual(supportedFieldCases.map((fieldCase) => fieldCase.kind));
    expect(queryEditorUnsupportedFieldKindValues).toEqual(
      querySurfaceFieldKindValues.filter((kind) => kind.endsWith("-list")),
    );
    expect(supportedFieldCases.length + queryEditorUnsupportedFieldKindValues.length).toBe(
      querySurfaceFieldKindValues.length,
    );
  });

  for (const fieldCase of supportedFieldCases) {
    it(`serializes and hydrates ${fieldCase.kind} literals through the shared authoring path`, () => {
      const fieldId = fieldIdForKind(fieldCase.kind);
      const catalog = createCollectionCatalog([createFieldSpec(fieldCase, [fieldCase.operator])]);
      let draft = createQueryEditorDraft(catalog);

      draft = addQueryEditorFilter(draft, catalog);
      draft = updateQueryEditorFilter(
        draft,
        draft.filters[0]!.id,
        {
          operator: fieldCase.operator,
          value: { kind: "literal", value: fieldCase.rawValue },
        },
        catalog,
      );

      const serialized = serializeQueryEditorDraft(draft, catalog);

      expect(serialized.parameterDefinitions).toEqual([]);
      expect(serialized.request.query).toMatchObject({
        filter: {
          fieldId,
          op: fieldCase.operator,
          value: { kind: "literal", value: fieldCase.expectedValue },
        },
        indexId: surfaceId,
        kind: "collection",
        window: { limit: 25 },
      });

      expect(
        hydrateQueryEditorDraft({
          catalog,
          request: serialized.request,
        }),
      ).toEqual({
        filters: [
          {
            fieldId,
            id: "filter:1",
            operator: fieldCase.operator,
            value: { kind: "literal", value: fieldCase.expectedValue },
          },
        ],
        pagination: {
          after: "",
          limit: 25,
        },
        parameters: [],
        sorts: [],
        surfaceId,
      });
    });

    it(`serializes and hydrates ${fieldCase.kind} parameter-backed filters with the matching scalar type`, () => {
      const fieldId = fieldIdForKind(fieldCase.kind);
      const parameterName = parameterNameForKind(fieldCase.kind, "param");
      const catalog = createCollectionCatalog([createFieldSpec(fieldCase, [fieldCase.operator])]);
      let draft = createQueryEditorDraft(catalog);

      draft = addQueryEditorParameter(draft);
      draft = updateQueryEditorParameter(draft, draft.parameters[0]!.id, {
        defaultValue: fieldCase.singleParameterDefault,
        label: `${fieldCase.kind} parameter`,
        name: parameterName,
        type: fieldCase.singleParameterType,
      });
      draft = addQueryEditorFilter(draft, catalog);
      draft = updateQueryEditorFilter(
        draft,
        draft.filters[0]!.id,
        {
          operator: fieldCase.operator,
          value: { kind: "param", name: parameterName },
        },
        catalog,
      );

      const serialized = serializeQueryEditorDraft(draft, catalog);

      expect(serialized.parameterDefinitions).toEqual([
        {
          defaultValue: fieldCase.expectedSingleParameterDefault,
          label: `${fieldCase.kind} parameter`,
          name: parameterName,
          required: undefined,
          type: fieldCase.singleParameterType,
        },
      ]);
      expect(serialized.request.params).toEqual({
        [parameterName]: fieldCase.expectedSingleParameterDefault,
      });
      expect(serialized.request.query).toMatchObject({
        filter: {
          fieldId,
          op: fieldCase.operator,
          value: { kind: "param", name: parameterName },
        },
        indexId: surfaceId,
        kind: "collection",
        window: { limit: 25 },
      });

      expect(
        hydrateQueryEditorDraft({
          catalog,
          parameterDefinitions: serialized.parameterDefinitions,
          request: serialized.request,
        }),
      ).toEqual({
        filters: [
          {
            fieldId,
            id: "filter:1",
            operator: fieldCase.operator,
            value: { kind: "param", name: parameterName },
          },
        ],
        pagination: {
          after: "",
          limit: 25,
        },
        parameters: [
          {
            defaultValue: fieldCase.expectedSingleParameterDefault,
            id: `param:${parameterName}`,
            label: `${fieldCase.kind} parameter`,
            name: parameterName,
            required: false,
            type: fieldCase.singleParameterType,
          },
        ],
        sorts: [],
        surfaceId,
      });
    });

    it(`serializes and hydrates ${fieldCase.kind} in-filters with the matching list parameter type`, () => {
      const fieldId = fieldIdForKind(fieldCase.kind);
      const parameterName = parameterNameForKind(fieldCase.kind, "list");
      const catalog = createCollectionCatalog([createFieldSpec(fieldCase, ["in"])]);
      let draft = createQueryEditorDraft(catalog);

      draft = addQueryEditorParameter(draft);
      draft = updateQueryEditorParameter(draft, draft.parameters[0]!.id, {
        defaultValue: fieldCase.listParameterDefault,
        label: `${fieldCase.kind} list parameter`,
        name: parameterName,
        type: fieldCase.listParameterType,
      });
      draft = addQueryEditorFilter(draft, catalog);
      draft = updateQueryEditorFilter(
        draft,
        draft.filters[0]!.id,
        {
          operator: "in",
          value: { kind: "param", name: parameterName },
        },
        catalog,
      );

      const serialized = serializeQueryEditorDraft(draft, catalog);

      expect(serialized.parameterDefinitions).toEqual([
        {
          defaultValue: fieldCase.expectedListParameterDefault,
          label: `${fieldCase.kind} list parameter`,
          name: parameterName,
          required: undefined,
          type: fieldCase.listParameterType,
        },
      ]);
      expect(serialized.request.params).toEqual({
        [parameterName]: fieldCase.expectedListParameterDefault,
      });
      expect(serialized.request.query).toMatchObject({
        filter: {
          fieldId,
          op: "in",
          values: [{ kind: "param", name: parameterName }],
        },
        indexId: surfaceId,
        kind: "collection",
        window: { limit: 25 },
      });

      expect(
        hydrateQueryEditorDraft({
          catalog,
          parameterDefinitions: serialized.parameterDefinitions,
          request: serialized.request,
        }),
      ).toEqual({
        filters: [
          {
            fieldId,
            id: "filter:1",
            operator: "in",
            value: { kind: "param", name: parameterName },
          },
        ],
        pagination: {
          after: "",
          limit: 25,
        },
        parameters: [
          {
            defaultValue: fieldCase.expectedListParameterDefault,
            id: `param:${parameterName}`,
            label: `${fieldCase.kind} list parameter`,
            name: parameterName,
            required: false,
            type: fieldCase.listParameterType,
          },
        ],
        sorts: [],
        surfaceId,
      });
    });
  }

  it("treats url and email text-search operators as string semantics", () => {
    const catalog = createCollectionCatalog([
      {
        control: "text",
        fieldId: "homepage",
        filterOperators: ["contains"],
        kind: "url",
        label: "Homepage",
      },
      {
        control: "text",
        fieldId: "contact",
        filterOperators: ["starts-with"],
        kind: "email",
        label: "Contact",
      },
    ]);
    let draft = createQueryEditorDraft(catalog);

    draft = addQueryEditorParameter(draft);
    draft = updateQueryEditorParameter(draft, draft.parameters[0]!.id, {
      defaultValue: "team@",
      label: "Contact prefix",
      name: "contact-prefix",
      type: "string",
    });

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "homepage",
        operator: "contains",
        value: { kind: "literal", value: "example.com/docs" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[1]!.id,
      {
        fieldId: "contact",
        operator: "starts-with",
        value: { kind: "param", name: "contact-prefix" },
      },
      catalog,
    );

    const serialized = serializeQueryEditorDraft(draft, catalog);

    expect(serialized.parameterDefinitions).toEqual([
      {
        defaultValue: "team@",
        label: "Contact prefix",
        name: "contact-prefix",
        required: undefined,
        type: "string",
      },
    ]);
    expect(serialized.request.query).toMatchObject({
      filter: {
        clauses: [
          {
            fieldId: "homepage",
            op: "contains",
            value: { kind: "literal", value: "example.com/docs" },
          },
          {
            fieldId: "contact",
            op: "starts-with",
            value: { kind: "param", name: "contact-prefix" },
          },
        ],
        op: "and",
      },
      indexId: surfaceId,
      kind: "collection",
      window: { limit: 25 },
    });
  });

  it("rejects url and email text-search params that keep the richer scalar parameter types", () => {
    const catalog = createCollectionCatalog([
      {
        control: "text",
        fieldId: "homepage",
        filterOperators: ["contains"],
        kind: "url",
        label: "Homepage",
      },
      {
        control: "text",
        fieldId: "contact",
        filterOperators: ["starts-with"],
        kind: "email",
        label: "Contact",
      },
    ]);
    let draft = createQueryEditorDraft(catalog);

    draft = addQueryEditorParameter(draft);
    draft = updateQueryEditorParameter(draft, draft.parameters[0]!.id, {
      defaultValue: "https://example.com/docs",
      label: "Homepage fragment",
      name: "homepage-fragment",
      type: "url",
    });
    draft = addQueryEditorParameter(draft);
    draft = updateQueryEditorParameter(draft, draft.parameters[1]!.id, {
      defaultValue: "alerts@example.com",
      label: "Contact prefix",
      name: "contact-prefix",
      type: "email",
    });

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "homepage",
        operator: "contains",
        value: { kind: "param", name: "homepage-fragment" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[1]!.id,
      {
        fieldId: "contact",
        operator: "starts-with",
        value: { kind: "param", name: "contact-prefix" },
      },
      catalog,
    );

    const validation = validateQueryEditorDraft(draft, catalog);

    expect(validation.ok).toBeFalse();
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-value",
          message: 'Parameter "homepage-fragment" must use type "string" for field "homepage".',
          path: "draft.filters[0].value",
        }),
        expect.objectContaining({
          code: "invalid-value",
          message: 'Parameter "contact-prefix" must use type "string" for field "contact".',
          path: "draft.filters[1].value",
        }),
      ]),
    );
    expect(() => serializeQueryEditorDraft(draft, catalog)).toThrow(QueryEditorValidationError);
  });

  for (const unsupportedKind of queryEditorUnsupportedFieldKindValues) {
    it(`fails closed for excluded ${unsupportedKind} field families`, () => {
      const catalog = createCollectionCatalog([
        {
          control:
            unsupportedKind === "enum-list"
              ? "enum"
              : unsupportedKind === "entity-ref-list"
                ? "entity-ref"
                : unsupportedKind === "date-list"
                  ? "date"
                  : unsupportedKind === "boolean-list"
                    ? "boolean"
                    : unsupportedKind === "number-list" || unsupportedKind === "percent-list"
                      ? "number"
                      : "text",
          fieldId: fieldIdForKind(unsupportedKind),
          filterOperators: ["exists"],
          kind: unsupportedKind,
          label: `${unsupportedKind} field`,
          ...(unsupportedKind === "enum-list"
            ? {
                options: [
                  { label: "Draft", value: "draft" },
                  { label: "Ready", value: "ready" },
                ],
              }
            : unsupportedKind === "entity-ref-list"
              ? {
                  options: [
                    { label: "Avery", value: "person:avery" },
                    { label: "Sam", value: "person:sam" },
                  ],
                }
              : {}),
        },
      ]);
      const draft = addQueryEditorFilter(createQueryEditorDraft(catalog), catalog);

      const validation = validateQueryEditorDraft(draft, catalog);

      expect(validation.ok).toBeFalse();
      expect(validation.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unsupported-field-kind",
            path: "draft.surfaceId",
          }),
          expect.objectContaining({
            code: "unsupported-field-kind",
            message: expect.stringContaining(unsupportedKind),
            path: "draft.filters[0].fieldId",
          }),
        ]),
      );
      expect(() => serializeQueryEditorDraft(draft, catalog)).toThrow(QueryEditorValidationError);
      expect(() =>
        hydrateQueryEditorDraft({
          catalog,
          request: {
            query: {
              indexId: surfaceId,
              kind: "collection",
              window: {
                limit: 25,
              },
            },
            version: 1,
          },
        }),
      ).toThrow(QueryEditorHydrationError);
    });
  }
});
