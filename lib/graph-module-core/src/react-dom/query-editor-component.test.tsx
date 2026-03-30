import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  addQueryEditorFilter,
  addQueryEditorParameter,
  createQueryEditorCatalog,
  createQueryEditorDraft,
  updateQueryEditorFilter,
  type QueryEditorCatalog,
} from "./query-editor.js";
import { QueryEditor } from "./query-editor-component.js";

function createCatalog(): QueryEditorCatalog {
  return createQueryEditorCatalog([
    {
      defaultPageSize: 25,
      fields: [
        {
          control: "entity-ref",
          fieldId: "projectId",
          filterOperators: ["eq", "neq", "in"],
          kind: "entity-ref",
          label: "Project",
          options: [{ label: "IO", value: "workflow-project:io" }],
        },
        {
          control: "enum",
          fieldId: "state",
          filterOperators: ["eq", "neq", "in"],
          kind: "enum",
          label: "State",
          options: [
            { label: "Active", value: "active" },
            { label: "Ready", value: "ready" },
          ],
        },
        {
          control: "boolean",
          fieldId: "hasActiveCommit",
          filterOperators: ["eq", "neq", "exists"],
          kind: "boolean",
          label: "Has Active Commit",
        },
        {
          control: "boolean",
          fieldId: "showUnmanagedRepositoryBranches",
          filterOperators: ["eq", "neq", "exists"],
          kind: "boolean",
          label: "Show Unmanaged Repository Branches",
        },
      ],
      label: "Workflow Branch Board",
      queryKind: "collection",
      sortFields: [{ directions: ["asc", "desc"], fieldId: "state", label: "State" }],
      sourceKind: "projection",
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: "query-surface:workflow:project-branch-board:v1",
    },
    {
      defaultPageSize: 50,
      fields: [
        {
          control: "text",
          fieldId: "name",
          filterOperators: ["eq", "contains"],
          kind: "text",
          label: "Name",
        },
      ],
      label: "Saved Query Library",
      queryKind: "collection",
      sortFields: [{ directions: ["asc", "desc"], fieldId: "name", label: "Name" }],
      sourceKind: "projection",
      surfaceId: "core:saved-query-library",
      surfaceVersion: "query-surface:core:saved-query-library:v1",
    },
  ]);
}

describe("query editor component", () => {
  it("renders the form-first authoring sections with typed field controls", () => {
    const catalog = createCatalog();
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
    expect(html).toContain('value="workflow:project-branch-board"');
    expect(html).toContain(">Workflow Branch Board</option>");
    expect(html).toContain('value="core:saved-query-library"');
    expect(html).toContain(">Saved Query Library</option>");
    expect(html).toContain('data-query-editor-section="filters"');
    expect(html).toContain('data-query-editor-section="sort"');
    expect(html).toContain('data-query-editor-section="parameters"');
    expect(html).toContain('data-query-editor-control="enum"');
    expect(html).toContain('data-query-editor-control="entity-ref"');
    expect(html).toContain('data-query-editor-control="boolean"');
    expect(html).toContain("&quot;indexId&quot;: &quot;workflow:project-branch-board&quot;");
  });

  it("renders inline validation feedback near invalid pagination controls", () => {
    const catalog = createCatalog();
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
