import { describe, expect, it } from "bun:test";

import { edgeId, type EdgeOutput } from "@dpeek/graphle-kernel";
import type { RecordSurfaceSpec } from "@dpeek/graphle-module";
import { stringTypeModule } from "@dpeek/graphle-module-core";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  AnyEntitySurfaceEntityRef,
  AnyEntitySurfacePredicateRef,
} from "../entity-surface-plan.js";
import { EntitySurface, EntitySurfaceFieldSection, PredicateRow } from "./entity-surface.js";

const textField = {
  ...stringTypeModule.field({
    cardinality: "one",
    meta: {
      display: {
        kind: "text",
      },
      editor: {
        kind: "text",
      },
      label: "Name",
    },
  }),
  key: "test:entity:name",
} as EdgeOutput;

function createPredicate(value: unknown): AnyEntitySurfacePredicateRef {
  return {
    batch<TResult>(fn: () => TResult) {
      return fn();
    },
    field: textField,
    get() {
      return value;
    },
    listEntities() {
      return [];
    },
    predicateId: edgeId(textField),
    rangeType: stringTypeModule.type,
    resolveEntity() {
      return undefined;
    },
    set() {
      return undefined;
    },
    subjectId: "test:entity",
    subscribe() {
      return () => undefined;
    },
    validateSet() {
      return {
        changedPredicateKeys: [],
        event: "update",
        ok: true,
        phase: "mutation",
        value: {},
      };
    },
  } as AnyEntitySurfacePredicateRef;
}

function createEntity(): AnyEntitySurfaceEntityRef {
  return {
    id: "test:entity:alpha",
    fields: {
      name: createPredicate("Alpha"),
    },
  } as AnyEntitySurfaceEntityRef;
}

const testSurface = {
  key: "test:entity:surface",
  subject: "test:entity",
  titleField: "name",
  sections: [
    {
      key: "content",
      title: "Content",
      fields: [{ path: "name", label: "Name" }],
    },
  ],
} as const satisfies RecordSurfaceSpec;

describe("entity surface react-dom", () => {
  it("renders view mode through the shared module-core field view when supported", () => {
    const predicate = createPredicate("Alpha");

    const html = renderToStaticMarkup(
      <PredicateRow
        labelVisibility={{ edit: "show", view: "hide" }}
        mode="view"
        pathLabel="name"
        predicate={predicate}
        readOnly
      />,
    );

    expect(html).toContain('data-explorer-field-mode="view"');
    expect(html).not.toContain('data-explorer-field-label="name"');
    expect(html).toContain('data-web-field-kind="text"');
    expect(html).toContain("Alpha");
  });

  it("renders path-keyed validation on the shared field section", () => {
    const html = renderToStaticMarkup(
      <EntitySurfaceFieldSection
        chrome={false}
        mode="edit"
        rows={[
          {
            pathLabel: "name",
            title: "Name",
            value: "Alpha",
          },
          {
            pathLabel: "description",
            title: "Description",
            value: "Body copy",
          },
        ]}
        validationMessagesByPath={
          new Map([
            [
              "description",
              [
                {
                  id: "description:type:required:0",
                  message: "Description is required.",
                  pathLabel: "description",
                  source: "type",
                },
              ],
            ],
          ])
        }
      />,
    );

    expect(html).toContain('data-explorer-field-validation="description"');
    expect(html).not.toContain('data-explorer-field-validation="name"');
    expect(html).toContain("Description is required.");
  });

  it("allows hosts to supply app-specific editor overrides", () => {
    const predicate = createPredicate("opaque-secret-handle");

    const html = renderToStaticMarkup(
      <PredicateRow
        mode="edit"
        pathLabel="secret"
        predicate={predicate}
        renderEditor={() => <span data-custom-editor="secret">Secret editor</span>}
      />,
    );

    expect(html).toContain('data-custom-editor="secret"');
    expect(html).toContain("Secret editor");
  });

  it("can render authored section chrome and labels for live entity surfaces", () => {
    const html = renderToStaticMarkup(
      <EntitySurface
        entity={createEntity()}
        mode="edit"
        sectionChrome={true}
        showModeToggle={false}
        surface={testSurface}
      />,
    );

    expect(html).toContain("Content");
    expect(html).toContain('data-explorer-field-label="name"');
    expect(html).toContain("Name");
  });

  it("renders authored title fields as semantic headings in view mode", () => {
    const html = renderToStaticMarkup(
      <EntitySurface
        entity={createEntity()}
        mode="view"
        showModeToggle={false}
        surface={testSurface}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain('data-entity-surface-title="name"');
    expect(html).toContain('data-explorer-field-role="title"');
    expect(html).toContain("Alpha");
    expect(html).not.toContain('data-explorer-field-label="name"');
  });
});
