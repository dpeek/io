import { describe, expect, it } from "bun:test";

import {
  QueryEditorValidationError,
  addQueryEditorFilter,
  addQueryEditorParameter,
  addQueryEditorSort,
  createQueryEditorCatalog,
  createQueryEditorDraft,
  normalizeQueryEditorDraft,
  serializeQueryEditorDraft,
  updateQueryEditorFilter,
  updateQueryEditorParameter,
  updateQueryEditorSort,
  validateQueryEditorDraft,
  type QueryEditorCatalog,
} from "./query-editor.js";

function createCatalog(): QueryEditorCatalog {
  return createQueryEditorCatalog([
    {
      defaultPageSize: 25,
      fields: [
        {
          control: "enum",
          fieldId: "status",
          filterOperators: ["eq", "neq", "in"],
          label: "Status",
          options: [
            { label: "Draft", value: "draft" },
            { label: "Ready", value: "ready" },
          ],
          sortable: true,
        },
        {
          control: "entity-ref",
          fieldId: "ownerId",
          filterOperators: ["eq", "neq", "in"],
          label: "Owner",
          options: [
            { label: "Avery", value: "person:avery" },
            { label: "Sam", value: "person:sam" },
          ],
          sortable: true,
        },
        {
          control: "date",
          fieldId: "updatedAt",
          filterOperators: ["eq", "gt", "gte", "lt", "lte"],
          label: "Updated",
          sortable: true,
        },
        {
          control: "boolean",
          fieldId: "needsReview",
          filterOperators: ["eq", "neq", "exists"],
          label: "Needs review",
          sortable: true,
        },
        {
          control: "text",
          fieldId: "title",
          filterOperators: ["eq", "neq", "contains", "starts-with", "in"],
          label: "Title",
          sortable: true,
        },
        {
          control: "number",
          fieldId: "openPullRequests",
          filterOperators: ["eq", "neq", "gt", "gte", "lt", "lte"],
          label: "Open pull requests",
          sortable: true,
        },
      ],
      label: "Workflow Branch Board",
      queryKind: "collection",
      sourceKind: "projection",
      surfaceId: "workflow:project-branch-board",
    },
    {
      defaultPageSize: 50,
      fields: [
        {
          control: "enum",
          fieldId: "queueState",
          filterOperators: ["eq", "neq", "in"],
          label: "Queue state",
          options: [{ label: "Queued", value: "queued" }],
          sortable: true,
        },
      ],
      label: "Branch Commit Queue",
      queryKind: "collection",
      sourceKind: "projection",
      surfaceId: "workflow:branch-commit-queue",
    },
  ]);
}

describe("query editor draft", () => {
  it("builds collection requests from the selected source surface", () => {
    const catalog = createCatalog();
    const draft = createQueryEditorDraft(catalog, "workflow:branch-commit-queue");
    const serialized = serializeQueryEditorDraft(draft, catalog);

    expect(serialized.request.query).toEqual({
      kind: "collection",
      indexId: "workflow:branch-commit-queue",
      order: undefined,
      filter: undefined,
      window: { limit: 50 },
    });
  });

  it("serializes field-aware filters across enum, entity-ref, date, boolean, text, and number fields", () => {
    const catalog = createCatalog();
    let draft = createQueryEditorDraft(catalog);

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "status",
        operator: "in",
        value: { kind: "literal", value: ["draft", "ready"] },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[1]!.id,
      {
        fieldId: "ownerId",
        operator: "eq",
        value: { kind: "literal", value: "person:avery" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[2]!.id,
      {
        fieldId: "updatedAt",
        operator: "gte",
        value: { kind: "literal", value: "2026-03-26" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[3]!.id,
      {
        fieldId: "needsReview",
        operator: "exists",
        value: { kind: "literal", value: true },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[4]!.id,
      {
        fieldId: "title",
        operator: "contains",
        value: { kind: "literal", value: "workflow" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[5]!.id,
      {
        fieldId: "openPullRequests",
        operator: "gte",
        value: { kind: "literal", value: "2" },
      },
      catalog,
    );

    const serialized = serializeQueryEditorDraft(draft, catalog);
    expect(serialized.request.query.kind).toBe("collection");
    expect(serialized.request.query).toMatchObject({
      filter: {
        op: "and",
        clauses: [
          {
            fieldId: "status",
            op: "in",
            values: [
              { kind: "literal", value: "draft" },
              { kind: "literal", value: "ready" },
            ],
          },
          {
            fieldId: "ownerId",
            op: "eq",
            value: { kind: "literal", value: "person:avery" },
          },
          {
            fieldId: "updatedAt",
            op: "gte",
            value: { kind: "literal", value: "2026-03-26" },
          },
          {
            fieldId: "needsReview",
            op: "exists",
            value: true,
          },
          {
            fieldId: "title",
            op: "contains",
            value: { kind: "literal", value: "workflow" },
          },
          {
            fieldId: "openPullRequests",
            op: "gte",
            value: { kind: "literal", value: 2 },
          },
        ],
      },
    });
  });

  it("serializes sort clauses and pagination defaults", () => {
    const catalog = createCatalog();
    let draft = createQueryEditorDraft(catalog);
    draft = addQueryEditorSort(draft, catalog);
    draft = updateQueryEditorSort(draft, draft.sorts[0]!.id, {
      direction: "desc",
      fieldId: "updatedAt",
    });
    draft = {
      ...draft,
      pagination: {
        after: "cursor:workflow-branch:2",
        limit: 75,
      },
    };

    const serialized = serializeQueryEditorDraft(draft, catalog);
    expect(serialized.request.query).toMatchObject({
      order: [{ direction: "desc", fieldId: "updatedAt" }],
      window: { after: "cursor:workflow-branch:2", limit: 75 },
    });
  });

  it("converts a valid draft into the normalized execution request used by the container runtime", async () => {
    const catalog = createCatalog();
    let draft = createQueryEditorDraft(catalog);
    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "openPullRequests",
        operator: "gte",
        value: { kind: "literal", value: "2" },
      },
      catalog,
    );

    const normalized = await normalizeQueryEditorDraft(draft, catalog);

    expect(normalized.request.query.kind).toBe("collection");
    expect(normalized.normalizedRequest.query).toMatchObject({
      filter: {
        fieldId: "openPullRequests",
        op: "gte",
        value: 2,
      },
      indexId: "workflow:project-branch-board",
      kind: "collection",
      window: { limit: 25 },
    });
  });

  it("serializes parameter definitions and param-backed filters for future saved-query persistence", () => {
    const catalog = createCatalog();
    let draft = createQueryEditorDraft(catalog);
    draft = addQueryEditorParameter(draft);
    draft = updateQueryEditorParameter(draft, draft.parameters[0]!.id, {
      defaultValue: "person:avery",
      label: "Owner",
      name: "owner-id",
      required: true,
      type: "entity-ref",
    });
    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "ownerId",
        operator: "eq",
        value: { kind: "param", name: "owner-id" },
      },
      catalog,
    );

    const serialized = serializeQueryEditorDraft(draft, catalog);
    expect(serialized.parameterDefinitions).toEqual([
      {
        defaultValue: "person:avery",
        label: "Owner",
        name: "owner-id",
        required: true,
        type: "entity-ref",
      },
    ]);
    expect(serialized.request.params).toEqual({
      "owner-id": "person:avery",
    });
    expect(serialized.request.query).toMatchObject({
      filter: {
        fieldId: "ownerId",
        op: "eq",
        value: { kind: "param", name: "owner-id" },
      },
    });
  });

  it("reports unsupported fields, operators, and parameter shapes before serialization", () => {
    const catalog = createCatalog();
    let draft = createQueryEditorDraft(catalog);
    draft = addQueryEditorParameter(draft);
    draft = updateQueryEditorParameter(draft, draft.parameters[0]!.id, {
      defaultValue: "not-a-number",
      label: "Pull request count",
      name: "pull-count",
      type: "number",
    });
    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "missingField",
        operator: "contains",
        value: { kind: "literal", value: "oops" },
      },
      catalog,
    );
    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[1]!.id,
      {
        fieldId: "openPullRequests",
        operator: "gte",
        value: { kind: "param", name: "pull-count" },
      },
      catalog,
    );
    draft = {
      ...draft,
      filters: draft.filters.map((filter, index) =>
        index === 1 ? { ...filter, operator: "contains" } : filter,
      ),
    };

    const validation = validateQueryEditorDraft(draft, catalog);
    expect(validation.ok).toBeFalse();
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-parameter-default" }),
        expect.objectContaining({ code: "missing-field" }),
        expect.objectContaining({ code: "unsupported-filter-operator" }),
      ]),
    );

    expect(() => serializeQueryEditorDraft(draft, catalog)).toThrow(QueryEditorValidationError);
  });
});
