import { describe, expect, it } from "bun:test";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { app } from "../graph/app.js";
import { createTypeClient } from "../graph/client.js";
import { core } from "../graph/core.js";
import { createExampleRuntime } from "../graph/runtime.js";
import { edgeId, typeId } from "../graph/schema.js";

import { ExplorerSurface } from "./explorer.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function collectText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : collectText(child)))
    .join(" ");
}

function findByProp(
  renderer: ReturnType<typeof create>,
  prop: string,
  value: string,
): ReactTestInstance {
  return renderer.root.find((node) => node.props[prop] === value);
}

describe("explorer surface", () => {
  it("edits entity values and schema metadata from one surface", async () => {
    const runtime = createExampleRuntime();
    const graph = createTypeClient(runtime.store, { ...core, ...app });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <ExplorerSurface graph={graph} store={runtime.store} sync={runtime.sync} />,
      );
    });

    const companyNodeButton = findByProp(renderer!, "data-explorer-item-id", runtime.ids.acme);
    await act(async () => {
      companyNodeButton.props.onClick();
    });

    const nameRow = findByProp(renderer!, "data-explorer-field", "name");
    const nameInput = nameRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );

    expect(collectText(nameRow)).toContain("Valid");
    expect(collectText(nameRow)).toContain("Required");

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Acme Graph Labs" } });
    });

    expect(graph.company.ref(runtime.ids.acme).fields.name.get()).toBe("Acme Graph Labs");
    expect(collectText(findByProp(renderer!, "data-explorer-item-id", runtime.ids.acme))).toContain(
      "Acme Graph Labs",
    );

    const typesButton = findByProp(renderer!, "data-explorer-schema-section", "types");
    await act(async () => {
      typesButton.props.onClick();
    });

    const companyTypeId = typeId(app.company);
    const companyTypeButton = findByProp(renderer!, "data-explorer-item-id", companyTypeId);
    await act(async () => {
      companyTypeButton.props.onClick();
    });

    const typeNameRow = findByProp(renderer!, "data-explorer-field", "name");
    const typeNameInput = typeNameRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );

    await act(async () => {
      typeNameInput.props.onChange({ target: { value: "Company Model" } });
    });

    expect(graph.type.ref(companyTypeId).fields.name.get()).toBe("Company Model");
    expect(collectText(findByProp(renderer!, "data-explorer-item-id", companyTypeId))).toContain(
      "Company Model",
    );

    const predicatesButton = findByProp(renderer!, "data-explorer-schema-section", "predicates");
    await act(async () => {
      predicatesButton.props.onClick();
    });

    const websitePredicateId = edgeId(app.company.fields.website);
    const websitePredicateButton = findByProp(renderer!, "data-explorer-item-id", websitePredicateId);
    await act(async () => {
      websitePredicateButton.props.onClick();
    });

    const predicateNameRow = findByProp(renderer!, "data-explorer-field", "name");
    const predicateNameInput = predicateNameRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );

    expect(collectText(findByProp(renderer!, "data-explorer-predicate-owner", "website"))).toContain(
      "Company",
    );

    await act(async () => {
      predicateNameInput.props.onChange({ target: { value: "Website predicate" } });
    });

    expect(graph.predicate.ref(websitePredicateId).fields.name.get()).toBe("Website predicate");
    expect(
      collectText(findByProp(renderer!, "data-explorer-item-id", websitePredicateId)),
    ).toContain("Website predicate");

    act(() => {
      renderer?.unmount();
    });
  });
});
