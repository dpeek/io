import { describe, expect, it } from "bun:test";

import {
  QueryEditorHydrationError,
  QueryEditorValidationError,
  addQueryEditorFilter,
  addQueryEditorParameter,
  addQueryEditorSort,
  createQueryEditorCatalog,
  createQueryEditorDraft,
  hydrateQueryEditorDraft,
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
          kind: "enum",
          label: "Status",
          options: [
            { label: "Draft", value: "draft" },
            { label: "Ready", value: "ready" },
          ],
        },
        {
          control: "entity-ref",
          fieldId: "ownerId",
          filterOperators: ["eq", "neq", "in"],
          kind: "entity-ref",
          label: "Owner",
          options: [
            { label: "Avery", value: "person:avery" },
            { label: "Sam", value: "person:sam" },
          ],
        },
        {
          control: "date",
          fieldId: "updatedAt",
          filterOperators: ["eq", "gt", "gte", "lt", "lte"],
          kind: "date",
          label: "Updated",
        },
        {
          control: "boolean",
          fieldId: "needsReview",
          filterOperators: ["eq", "neq", "exists"],
          kind: "boolean",
          label: "Needs review",
        },
        {
          control: "text",
          fieldId: "title",
          filterOperators: ["eq", "neq", "contains", "starts-with", "in"],
          kind: "text",
          label: "Title",
        },
        {
          control: "number",
          fieldId: "openPullRequests",
          filterOperators: ["eq", "neq", "gt", "gte", "lt", "lte"],
          kind: "number",
          label: "Open pull requests",
        },
        {
          control: "text",
          fieldId: "homepage",
          filterOperators: ["eq", "contains"],
          kind: "url",
          label: "Homepage",
        },
        {
          control: "text",
          fieldId: "cycleTime",
          filterOperators: ["eq", "gt"],
          kind: "duration",
          label: "Cycle time",
        },
        {
          control: "number",
          fieldId: "completionPercent",
          filterOperators: ["eq", "gte", "lte", "in"],
          kind: "percent",
          label: "Completion",
        },
      ],
      label: "Workflow Branch Board",
      queryKind: "collection",
      sortFields: [
        { directions: ["asc", "desc"], fieldId: "status", label: "Status" },
        { directions: ["asc", "desc"], fieldId: "ownerId", label: "Owner" },
        { directions: ["asc", "desc"], fieldId: "updatedAt", label: "Updated" },
        { directions: ["asc", "desc"], fieldId: "needsReview", label: "Needs review" },
        { directions: ["asc", "desc"], fieldId: "title", label: "Title" },
        { directions: ["asc", "desc"], fieldId: "openPullRequests", label: "Open pull requests" },
      ],
      sourceKind: "projection",
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: "query-surface:workflow:project-branch-board:v1",
    },
    {
      defaultPageSize: 50,
      fields: [
        {
          control: "enum",
          fieldId: "queueState",
          filterOperators: ["eq", "neq", "in"],
          kind: "enum",
          label: "Queue state",
          options: [{ label: "Queued", value: "queued" }],
        },
      ],
      label: "Branch Commit Queue",
      queryKind: "collection",
      sortFields: [{ directions: ["asc", "desc"], fieldId: "queueState", label: "Queue state" }],
      sourceKind: "projection",
      surfaceId: "workflow:branch-commit-queue",
      surfaceVersion: "query-surface:workflow:branch-commit-queue:v1",
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
            value: { kind: "literal", value: "2026-03-26T00:00:00.000Z" },
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

  it("keeps richer string-backed and numeric list contracts coherent across draft serialization", () => {
    const catalog = createCatalog();
    let draft = createQueryEditorDraft(catalog);

    draft = addQueryEditorParameter(draft);
    draft = updateQueryEditorParameter(draft, draft.parameters[0]!.id, {
      defaultValue: "30 min",
      label: "Cycle time",
      name: "cycle-time",
      type: "duration",
    });

    draft = addQueryEditorParameter(draft);
    draft = updateQueryEditorParameter(draft, draft.parameters[1]!.id, {
      defaultValue: [25, 50],
      label: "Completion bands",
      name: "completion-bands",
      type: "percent-list",
    });

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "cycleTime",
        operator: "gt",
        value: { kind: "param", name: "cycle-time" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[1]!.id,
      {
        fieldId: "completionPercent",
        operator: "in",
        value: { kind: "param", name: "completion-bands" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[2]!.id,
      {
        fieldId: "homepage",
        operator: "contains",
        value: { kind: "literal", value: "example.com" },
      },
      catalog,
    );

    const serialized = serializeQueryEditorDraft(draft, catalog);
    expect(serialized.parameterDefinitions).toEqual([
      {
        defaultValue: "30 min",
        label: "Cycle time",
        name: "cycle-time",
        required: undefined,
        type: "duration",
      },
      {
        defaultValue: [25, 50],
        label: "Completion bands",
        name: "completion-bands",
        required: undefined,
        type: "percent-list",
      },
    ]);
    expect(serialized.request.params).toEqual({
      "completion-bands": [25, 50],
      "cycle-time": "30 min",
    });
    expect(serialized.request.query).toMatchObject({
      filter: {
        op: "and",
        clauses: [
          {
            fieldId: "cycleTime",
            op: "gt",
            value: { kind: "param", name: "cycle-time" },
          },
          {
            fieldId: "completionPercent",
            op: "in",
            values: [{ kind: "param", name: "completion-bands" }],
          },
          {
            fieldId: "homepage",
            op: "contains",
            value: { kind: "literal", value: "example.com" },
          },
        ],
      },
    });
  });

  it("hydrates richer list literals and parameter definitions back into the editor draft", () => {
    const catalog = createCatalog();
    const draft = hydrateQueryEditorDraft({
      catalog,
      parameterDefinitions: [
        {
          defaultValue: "30 min",
          label: "Cycle time",
          name: "cycle-time",
          type: "duration",
        },
        {
          defaultValue: [25, 50],
          label: "Completion bands",
          name: "completion-bands",
          type: "percent-list",
        },
      ],
      request: {
        params: {
          "completion-bands": [25, 50],
          "cycle-time": "30 min",
        },
        query: {
          filter: {
            op: "and",
            clauses: [
              {
                fieldId: "cycleTime",
                op: "gt",
                value: { kind: "param", name: "cycle-time" },
              },
              {
                fieldId: "completionPercent",
                op: "in",
                values: [{ kind: "literal", value: [25, 50] }],
              },
            ],
          },
          indexId: "workflow:project-branch-board",
          kind: "collection",
          window: {
            limit: 25,
          },
        },
        version: 1,
      },
    });

    expect(draft.parameters).toEqual([
      {
        defaultValue: "30 min",
        id: "param:cycle-time",
        label: "Cycle time",
        name: "cycle-time",
        required: false,
        type: "duration",
      },
      {
        defaultValue: [25, 50],
        id: "param:completion-bands",
        label: "Completion bands",
        name: "completion-bands",
        required: false,
        type: "percent-list",
      },
    ]);
    expect(draft.filters).toEqual([
      {
        fieldId: "cycleTime",
        id: "filter:1",
        operator: "gt",
        value: {
          kind: "param",
          name: "cycle-time",
        },
      },
      {
        fieldId: "completionPercent",
        id: "filter:2",
        operator: "in",
        value: {
          kind: "literal",
          value: [25, 50],
        },
      },
    ]);
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

  it("fails closed when a surface exposes excluded list-valued field families", () => {
    const catalog = createQueryEditorCatalog([
      {
        defaultPageSize: 25,
        fields: [
          {
            control: "entity-ref",
            fieldId: "reviewers",
            filterOperators: ["exists"],
            kind: "entity-ref-list",
            label: "Reviewers",
            options: [{ label: "Avery", value: "person:avery" }],
          },
        ],
        label: "List Workflow Board",
        queryKind: "collection",
        sourceKind: "projection",
        surfaceId: "workflow:list-board",
        surfaceVersion: "query-surface:workflow:list-board:v1",
      },
    ]);
    const draft = addQueryEditorFilter(
      createQueryEditorDraft(catalog, "workflow:list-board"),
      catalog,
    );

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
            indexId: "workflow:list-board",
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
});
