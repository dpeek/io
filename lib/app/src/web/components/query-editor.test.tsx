import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  addQueryEditorFilter,
  addQueryEditorParameter,
  createQueryEditorDraft,
  updateQueryEditorFilter,
} from "../lib/query-editor.js";
import { QueryEditor, createInstalledQueryEditorCatalog } from "./query-editor.js";

describe("query editor component", () => {
  it("renders the form-first authoring sections with typed field controls", () => {
    const catalog = createInstalledQueryEditorCatalog();
    let draft = createQueryEditorDraft(catalog);

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "projectId",
        operator: "eq",
        value: { kind: "literal", value: "workflow-project:io" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[1]!.id,
      {
        fieldId: "state",
        operator: "eq",
        value: { kind: "literal", value: "active" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[2]!.id,
      {
        fieldId: "hasActiveCommit",
        operator: "eq",
        value: { kind: "literal", value: true },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[3]!.id,
      {
        fieldId: "showUnmanagedRepositoryBranches",
        operator: "eq",
        value: { kind: "literal", value: true },
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
    expect(html).toContain('data-query-editor-control="boolean"');
    expect(html).toContain("&quot;indexId&quot;: &quot;workflow:project-branch-board&quot;");
  });

  it("renders inline validation feedback near invalid pagination controls", () => {
    const catalog = createInstalledQueryEditorCatalog();
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
