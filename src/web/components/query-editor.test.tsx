import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  addQueryEditorFilter,
  addQueryEditorParameter,
  createQueryEditorDraft,
  updateQueryEditorFilter,
} from "../lib/query-editor.js";
import { QueryEditor, createQueryEditorDemoCatalog } from "./query-editor.js";

describe("query editor component", () => {
  it("renders the form-first authoring sections with typed field controls", () => {
    const catalog = createQueryEditorDemoCatalog();
    let draft = createQueryEditorDraft(catalog);

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "status",
        operator: "eq",
        value: { kind: "literal", value: "draft" },
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
        operator: "eq",
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
        value: { kind: "literal", value: 3 },
      },
      catalog,
    );

    draft = addQueryEditorParameter(draft);

    const html = renderToStaticMarkup(<QueryEditor catalog={catalog} initialDraft={draft} />);

    expect(html).toContain('data-query-editor-section="source"');
    expect(html).toContain('data-query-editor-section="filters"');
    expect(html).toContain('data-query-editor-section="sort"');
    expect(html).toContain('data-query-editor-section="parameters"');
    expect(html).toContain('data-query-editor-control="enum"');
    expect(html).toContain('data-query-editor-control="entity-ref"');
    expect(html).toContain('data-query-editor-control="date"');
    expect(html).toContain('data-query-editor-control="boolean"');
    expect(html).toContain('data-query-editor-control="text"');
    expect(html).toContain('data-query-editor-control="number"');
    expect(html).toContain("&quot;indexId&quot;: &quot;ops/workflow:project-branch-board&quot;");
  });

  it("renders inline validation feedback near invalid pagination controls", () => {
    const catalog = createQueryEditorDemoCatalog();
    const draft = {
      ...createQueryEditorDraft(catalog),
      pagination: {
        after: "",
        limit: 0,
      },
    };

    const html = renderToStaticMarkup(<QueryEditor catalog={catalog} initialDraft={draft} />);

    expect(html).toContain("Page size must be a positive integer.");
    expect(html).toContain("After cursor");
  });
});
