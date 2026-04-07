import { describe, expect, it } from "bun:test";

import type { CollectionSurfaceSpec, RecordSurfaceSpec } from "@io/graph-module";
import { renderToStaticMarkup } from "react-dom/server";

import type { RecordSurfaceBinding } from "../record-surface.js";
import { RecordSurfaceMountView, RecordSurfaceSectionView } from "./record-surface-mount.js";

const surface = {
  key: "record:task",
  related: [
    {
      collection: "collection:children",
      key: "children",
      title: "Children",
    },
  ],
  sections: [
    {
      fields: [
        {
          path: "id",
        },
        {
          label: "Status",
          path: "status",
          span: 1,
        },
      ],
      key: "details",
      title: "Details",
    },
  ],
  subtitleField: "status",
  subject: "task",
  titleField: "name",
} as const satisfies RecordSurfaceSpec;

const relatedCollection = {
  key: "collection:children",
  presentation: {
    kind: "table",
  },
  source: {
    kind: "query",
    query: "saved-query:children",
  },
  title: "Child tasks",
} as const satisfies CollectionSurfaceSpec;

const binding = {
  commandSurfaces: [],
  related: [
    {
      collection: relatedCollection,
      key: "children",
      title: "Children",
    },
  ],
  sections: [
    {
      fields: [
        {
          label: "id",
          path: "id",
          value: "task:42",
        },
        {
          label: "Status",
          path: "status",
          span: 1,
          value: "active",
        },
      ],
      key: "details",
      title: "Details",
    },
  ],
  subtitle: "active",
  surface,
  title: "Runtime extraction",
} as const satisfies RecordSurfaceBinding;

describe("record surface mount", () => {
  it("renders the shared record shell and readonly field rows", () => {
    const html = renderToStaticMarkup(
      <RecordSurfaceMountView
        binding={binding}
        description="Shared record-surface mount for readonly detail views."
        surface={surface}
        summaryItems={["Created today"]}
        titlePrefix="Task"
      />,
    );

    expect(html).toContain('data-record-surface="record:task"');
    expect(html).toContain("Runtime extraction");
    expect(html).toContain("Created today");
    expect(html).toContain("Shared record-surface mount for readonly detail views.");
    expect(html).toContain('data-record-surface-field="id"');
    expect(html).toContain('data-record-surface-field="status"');
    expect(html).toContain("task:42");
    expect(html).toContain("active");
    expect(html).toContain("Children");
    expect(html).toContain(
      "Related collection panels need a collection-surface lookup and installed query-surface registry.",
    );
  });

  it("allows hosts to replace field rendering while keeping shared section chrome", () => {
    const html = renderToStaticMarkup(
      <RecordSurfaceSectionView
        columns={1}
        fields={binding.sections[0].fields}
        renderField={(field) => <div data-custom-field={field.path}>{field.label}</div>}
        section={binding.sections[0]}
      />,
    );

    expect(html).toContain('data-custom-field="id"');
    expect(html).toContain('data-custom-field="status"');
    expect(html).toContain('data-record-surface-section-columns="1"');
    expect(html).toContain("Details");
  });
});
