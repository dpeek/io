import { describe, expect, it } from "bun:test";

import { applyIdMap, createStore } from "@io/app/graph";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { defineType } from "@io/graph-module";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";
import { renderToStaticMarkup } from "react-dom/server";

import { PredicateRow } from "../field-editor-row.js";

const rowItem = defineType({
  values: { key: "test:rowItem", name: "Row Item" },
  fields: {
    ...core.node.fields,
  },
});

const namespace = applyIdMap({}, { rowItem }, { strict: false });
const definitions = { ...core, ...namespace } as const;

function createRowEntity() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, namespace, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, namespace, definitions);
  const entityId = graph.rowItem.create({
    description: "Mode-aware field row fixture",
    name: "Alpha",
  });

  return graph.rowItem.ref(entityId);
}

describe("predicate row", () => {
  it("supports mode-aware label chrome while keeping readonly widget rendering stable", () => {
    const entity = createRowEntity();

    const viewHtml = renderToStaticMarkup(
      <PredicateRow
        labelVisibility={{ edit: "show", view: "hide" }}
        mode="view"
        pathLabel="name"
        predicate={entity.fields.name}
        readOnly
      />,
    );
    const editHtml = renderToStaticMarkup(
      <PredicateRow
        labelVisibility={{ edit: "show", view: "hide" }}
        mode="edit"
        pathLabel="name"
        predicate={entity.fields.name}
        readOnly
      />,
    );

    expect(viewHtml).toContain('data-explorer-field-mode="view"');
    expect(viewHtml).not.toContain('data-explorer-field-label="name"');
    expect(viewHtml).toContain("Alpha");

    expect(editHtml).toContain('data-explorer-field-mode="edit"');
    expect(editHtml).toContain('data-explorer-field-label="name"');
    expect(editHtml).toContain("Alpha");
  });

  it("renders injected validation messages on the shared field row", () => {
    const entity = createRowEntity();

    const html = renderToStaticMarkup(
      <PredicateRow
        mode="edit"
        pathLabel="name"
        predicate={entity.fields.name}
        readOnly
        validationMessages={[
          {
            id: "name:type:required:0",
            message: "Name is required.",
            pathLabel: "name",
            source: "type",
          },
        ]}
      />,
    );

    expect(html).toContain('data-explorer-field-validation-state="invalid"');
    expect(html).toContain('data-explorer-field-validation="name"');
    expect(html).toContain("Name is required.");
    expect(html).toContain(">type<");
  });
});
