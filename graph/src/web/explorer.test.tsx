import { describe, expect, it } from "bun:test";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { app } from "../graph/app.js";
import { createTypeClient } from "../graph/client.js";
import { core } from "../graph/core.js";
import { createExampleRuntime } from "../graph/runtime.js";
import { edgeId, typeId } from "../graph/schema.js";

import { Explorer } from "./explorer.js";

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
      renderer = create(<Explorer runtime={runtime} />);
    });

    const companyNodeButton = findByProp(renderer!, "data-explorer-item-entity", runtime.ids.acme);
    await act(async () => {
      companyNodeButton.props.onClick();
    });

    const nameRow = findByProp(renderer!, "data-explorer-field-path", "name");
    const nameInput = nameRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );

    expect(collectText(nameRow)).toContain("set");
    expect(collectText(nameRow)).toContain("required");

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Acme Graph Labs" } });
    });

    expect(graph.company.ref(runtime.ids.acme).fields.name.get()).toBe("Acme Graph Labs");
    expect(collectText(findByProp(renderer!, "data-explorer-item-entity", runtime.ids.acme))).toContain(
      "Acme Graph Labs",
    );

    const typesButton = findByProp(renderer!, "data-explorer-nav", "types");
    await act(async () => {
      typesButton.props.onClick();
    });

    const companyTypeId = typeId(app.company);
    const companyTypeButton = findByProp(renderer!, "data-explorer-item-type", companyTypeId);
    await act(async () => {
      companyTypeButton.props.onClick();
    });

    const typeNameRow = findByProp(renderer!, "data-explorer-field-path", "metadata.name");
    const typeNameInput = typeNameRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );

    await act(async () => {
      typeNameInput.props.onChange({ target: { value: "Company Model" } });
    });

    expect(graph.type.ref(companyTypeId).fields.name.get()).toBe("Company Model");
    expect(collectText(findByProp(renderer!, "data-explorer-item-type", companyTypeId))).toContain(
      "Company Model",
    );

    const predicatesButton = findByProp(renderer!, "data-explorer-nav", "predicates");
    await act(async () => {
      predicatesButton.props.onClick();
    });

    const websitePredicateId = edgeId(app.company.fields.website);
    const websitePredicateButton = findByProp(
      renderer!,
      "data-explorer-item-predicate",
      websitePredicateId,
    );
    await act(async () => {
      websitePredicateButton.props.onClick();
    });

    const predicateNameRow = findByProp(renderer!, "data-explorer-field-path", "metadata.name");
    const predicateNameInput = predicateNameRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );

    expect(
      collectText(findByProp(renderer!, "data-explorer-open-type", companyTypeId).parent!.parent!),
    ).toContain("Company");

    await act(async () => {
      predicateNameInput.props.onChange({ target: { value: "Website predicate" } });
    });

    expect(graph.predicate.ref(websitePredicateId).fields.name.get()).toBe("Website predicate");
    expect(
      collectText(findByProp(renderer!, "data-explorer-item-predicate", websitePredicateId)),
    ).toContain("Website predicate");

    act(() => {
      renderer?.unmount();
    });
  });
});
