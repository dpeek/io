import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  addQueryEditorFilter,
  createQueryEditorCatalog,
  createQueryEditorDraft,
  updateQueryEditorFilter,
} from "../lib/query-editor.js";
import { installedModuleQueryEditorCatalog } from "../lib/query-surface-registry.js";
import { createInstalledQueryEditorCatalog, QueryEditor } from "./query-editor.js";

describe("app query editor wrapper", () => {
  it("keeps the app wrapper bound to the installed shared query-editor catalog", () => {
    const catalog = createInstalledQueryEditorCatalog();

    expect(catalog).toBe(installedModuleQueryEditorCatalog);
    expect(
      catalog.surfaces.some((surface) => surface.surfaceId === "workflow:project-branch-board"),
    ).toBeTrue();
    expect(
      catalog.surfaces.some((surface) => surface.surfaceId === "core:saved-query-library"),
    ).toBeTrue();
  });

  it("renders richer supported controls and explicit unsupported notices through the app wrapper", () => {
    const catalog = createQueryEditorCatalog([
      {
        defaultPageSize: 25,
        fields: [
          {
            control: "text",
            fieldId: "homepage",
            filterOperators: ["eq"],
            kind: "url",
            label: "Homepage",
          },
          {
            control: "text",
            fieldId: "cycleTime",
            filterOperators: ["gt"],
            kind: "duration",
            label: "Cycle Time",
          },
          {
            control: "number",
            fieldId: "completionPercent",
            filterOperators: ["gte"],
            kind: "percent",
            label: "Completion",
          },
          {
            control: "entity-ref",
            fieldId: "reviewers",
            filterOperators: ["exists"],
            kind: "entity-ref-list",
            label: "Reviewers",
            options: [{ label: "Avery", value: "person:avery" }],
          },
        ],
        label: "Rich Wrapper Surface",
        queryKind: "collection",
        sourceKind: "projection",
        surfaceId: "test:wrapper-surface",
        surfaceVersion: "query-surface:test:wrapper-surface:v1",
      },
    ]);
    let draft = createQueryEditorDraft(catalog, "test:wrapper-surface");

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[0]!.id,
      {
        fieldId: "homepage",
        operator: "eq",
        value: { kind: "literal", value: "https://example.com/docs" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[1]!.id,
      {
        fieldId: "cycleTime",
        operator: "gt",
        value: { kind: "literal", value: "30 min" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[2]!.id,
      {
        fieldId: "completionPercent",
        operator: "gte",
        value: { kind: "literal", value: "25%" },
      },
      catalog,
    );

    draft = addQueryEditorFilter(draft, catalog);
    draft = updateQueryEditorFilter(
      draft,
      draft.filters[3]!.id,
      {
        fieldId: "reviewers",
        operator: "exists",
        value: { kind: "literal", value: true },
      },
      catalog,
    );

    const html = renderToStaticMarkup(<QueryEditor catalog={catalog} initialDraft={draft} />);

    expect(html).toContain('data-query-editor=""');
    expect(html).toContain('data-query-editor-control="url"');
    expect(html).toContain('data-query-editor-control="duration"');
    expect(html).toContain('data-query-editor-control="percent"');
    expect(html).toContain('data-query-editor-control="unsupported"');
    expect(html).toContain('data-query-editor-unsupported-kind="entity-ref-list"');
  });
});
