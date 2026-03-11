import { describe, expect, it } from "bun:test";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { app } from "../graph/app.js";
import { createTypeClient } from "../graph/client.js";
import { core } from "../graph/core.js";
import { createExampleRuntime } from "../graph/runtime.js";
import { edgeId, typeId } from "../graph/schema.js";

import { Explorer, ExplorerSurface } from "./explorer.js";

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
  it("surfaces inline validation failures for invalid entity edits", async () => {
    const runtime = createExampleRuntime();
    const graph = createTypeClient(runtime.store, { ...core, ...app });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <ExplorerSurface graph={graph} store={runtime.store} sync={runtime.sync} />,
      );
    });

    const companyNodeButton = findByProp(renderer!, "data-explorer-item-entity", runtime.ids.acme);
    await act(async () => {
      companyNodeButton.props.onClick();
    });

    const nameRow = findByProp(renderer!, "data-explorer-field-path", "name");
    const nameInput = nameRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );
    const initialName = graph.company.ref(runtime.ids.acme).fields.name.get();

    await act(async () => {
      nameInput.props.onChange({ target: { value: "   " } });
    });

    expect(graph.company.ref(runtime.ids.acme).fields.name.get()).toBe(initialName);
    const validation = findByProp(renderer!, "data-explorer-field-validation", "name");
    expect(collectText(validation)).toContain("Validation");
    expect(collectText(validation)).toContain("field");
    expect(collectText(validation)).toContain("Name must not be blank.");

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Acme Graph Labs" } });
    });

    expect(graph.company.ref(runtime.ids.acme).fields.name.get()).toBe("Acme Graph Labs");
    expect(
      renderer!.root.findAll((node) => node.props["data-explorer-field-validation"] === "name"),
    ).toHaveLength(0);

    act(() => {
      renderer?.unmount();
    });
  });

  it("surfaces shared type validation results for invalid number edits", async () => {
    const runtime = createExampleRuntime();
    const graph = createTypeClient(runtime.store, { ...core, ...app });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <ExplorerSurface graph={graph} store={runtime.store} sync={runtime.sync} />,
      );
    });

    const companyNodeButton = findByProp(renderer!, "data-explorer-item-entity", runtime.ids.acme);
    await act(async () => {
      companyNodeButton.props.onClick();
    });

    const foundedYearRow = findByProp(renderer!, "data-explorer-field-path", "foundedYear");
    const foundedYearInput = foundedYearRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "number",
    );

    await act(async () => {
      foundedYearInput.props.onChange({ target: { value: "Infinity" } });
    });

    expect(graph.company.ref(runtime.ids.acme).fields.foundedYear.get()).toBe(1987);
    const validation = findByProp(renderer!, "data-explorer-field-validation", "foundedYear");
    expect(collectText(validation)).toContain("Validation");
    expect(collectText(validation)).toContain("type");
    expect(collectText(validation)).toContain("Number values must be finite.");

    act(() => {
      renderer?.unmount();
    });
  });

  it("preflights custom range editor mutations before updating predicate metadata", async () => {
    const runtime = createExampleRuntime();
    const graph = createTypeClient(runtime.store, { ...core, ...app });
    const websitePredicateId = edgeId(app.company.fields.website);
    const initialRange = graph.predicate.ref(websitePredicateId).fields.range.get();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <ExplorerSurface graph={graph} store={runtime.store} sync={runtime.sync} />,
      );
    });

    const predicatesButton = findByProp(renderer!, "data-explorer-nav", "predicates");
    await act(async () => {
      predicatesButton.props.onClick();
    });

    const websitePredicateButton = findByProp(
      renderer!,
      "data-explorer-item-predicate",
      websitePredicateId,
    );
    await act(async () => {
      websitePredicateButton.props.onClick();
    });

    const rangeRow = findByProp(renderer!, "data-explorer-field-path", "metadata.range");
    const rangeSelect = rangeRow.find(
      (node) => node.type === "select" && node.props["data-explorer-range-editor"] === websitePredicateId,
    );

    await act(async () => {
      rangeSelect.props.onChange({ target: { value: runtime.ids.acme } });
    });

    expect(graph.predicate.ref(websitePredicateId).fields.range.get()).toBe(initialRange);
    const validation = findByProp(renderer!, "data-explorer-field-validation", "metadata.range");
    expect(collectText(validation)).toContain("Validation");
    expect(collectText(validation)).toContain("runtime");
    expect(collectText(validation)).toContain('Field "range" must reference "Type" entities.');

    act(() => {
      renderer?.unmount();
    });
  });

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

    expect(
      collectText(findByProp(renderer!, "data-explorer-item-entity", runtime.ids.acme)),
    ).toContain(
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

    expect(
      collectText(findByProp(renderer!, "data-explorer-item-type", companyTypeId)),
    ).toContain(
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

    const ownerTypeButton = findByProp(renderer!, "data-explorer-open-type", companyTypeId);
    expect(collectText(ownerTypeButton.parent!.parent!)).toContain("Company");

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
