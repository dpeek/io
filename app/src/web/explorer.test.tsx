import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { act } from "react";

import { createTypeClient, core, edgeId, typeId } from "@io/graph";

import { app } from "../graph/app.js";
import { createExampleRuntime } from "../graph/runtime.js";
import { getAllByData, getByData, getReactProps, getRequiredElement, textContent } from "../test-dom.js";
import { Explorer, ExplorerSurface } from "./explorer.js";

describe("explorer surface", () => {
  it("surfaces inline validation failures for invalid entity edits", async () => {
    const runtime = createExampleRuntime();
    const graph = createTypeClient(runtime.store, { ...core, ...app });
    const { container, unmount } = render(
      <ExplorerSurface graph={graph} store={runtime.store} sync={runtime.sync} />,
    );

    const companyNodeButton = getByData(container, "data-explorer-item-entity", runtime.ids.acme);
    fireEvent.click(companyNodeButton);

    const nameRow = getByData(container, "data-explorer-field-path", "name");
    const nameInput = getRequiredElement(
      nameRow.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected explorer name input.",
    );
    const initialName = graph.company.ref(runtime.ids.acme).fields.name.get();

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(nameInput).onChange({
        target: { value: "   " },
      });
    });

    expect(graph.company.ref(runtime.ids.acme).fields.name.get()).toBe(initialName);
    const validation = getByData(container, "data-explorer-field-validation", "name");
    expect(textContent(validation)).toContain("Validation");
    expect(textContent(validation)).toContain("field");
    expect(textContent(validation)).toContain("Name must not be blank.");

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(nameInput).onChange({
        target: { value: "Acme Graph Labs" },
      });
    });

    expect(graph.company.ref(runtime.ids.acme).fields.name.get()).toBe("Acme Graph Labs");
    expect(
      getAllByData(container, "data-explorer-field-validation").filter(
        (node) => node.getAttribute("data-explorer-field-validation") === "name",
      ),
    ).toHaveLength(0);

    unmount();
  });

  it("surfaces shared type validation results for invalid number edits", async () => {
    const runtime = createExampleRuntime();
    const graph = createTypeClient(runtime.store, { ...core, ...app });

    const { container, unmount } = render(
      <ExplorerSurface graph={graph} store={runtime.store} sync={runtime.sync} />,
    );

    const companyNodeButton = getByData(container, "data-explorer-item-entity", runtime.ids.acme);
    fireEvent.click(companyNodeButton);

    const foundedYearRow = getByData(container, "data-explorer-field-path", "foundedYear");
    const foundedYearInput = getRequiredElement(
      foundedYearRow.querySelector<HTMLInputElement>('input[data-web-field-kind="number"]'),
      "Expected founded year input.",
    );

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(
        foundedYearInput,
      ).onChange({
        target: { value: "Infinity" },
      });
    });

    expect(graph.company.ref(runtime.ids.acme).fields.foundedYear.get()).toBe(1987);
    const validation = getByData(container, "data-explorer-field-validation", "foundedYear");
    expect(textContent(validation)).toContain("Validation");
    expect(textContent(validation)).toContain("type");
    expect(textContent(validation)).toContain("Number values must be finite.");

    unmount();
  });

  it("preflights custom range editor mutations before updating predicate metadata", async () => {
    const runtime = createExampleRuntime();
    const graph = createTypeClient(runtime.store, { ...core, ...app });
    const websitePredicateId = edgeId(app.company.fields.website);
    const initialRange = graph.predicate.ref(websitePredicateId).fields.range.get();

    const { container, unmount } = render(
      <ExplorerSurface graph={graph} store={runtime.store} sync={runtime.sync} />,
    );

    fireEvent.click(getByData(container, "data-explorer-nav", "predicates"));

    fireEvent.click(getByData(container, "data-explorer-item-predicate", websitePredicateId));

    const rangeRow = getByData(container, "data-explorer-field-path", "metadata.range");
    const rangeSelect = getRequiredElement(
      rangeRow.querySelector<HTMLSelectElement>(`select[data-explorer-range-editor="${websitePredicateId}"]`),
      "Expected range select.",
    );

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(rangeSelect).onChange({
        target: { value: runtime.ids.acme },
      });
    });

    expect(graph.predicate.ref(websitePredicateId).fields.range.get()).toBe(initialRange);
    const validation = getByData(container, "data-explorer-field-validation", "metadata.range");
    expect(textContent(validation)).toContain("Validation");
    expect(textContent(validation)).toContain("runtime");
    expect(textContent(validation)).toContain('Field "range" must reference "Type" entities.');

    unmount();
  });

  it("edits entity values and schema metadata from one surface", async () => {
    const runtime = createExampleRuntime();
    const graph = createTypeClient(runtime.store, { ...core, ...app });

    const { container, unmount } = render(<Explorer runtime={runtime} />);

    fireEvent.click(getByData(container, "data-explorer-item-entity", runtime.ids.acme));

    const nameRow = getByData(container, "data-explorer-field-path", "name");
    const nameInput = getRequiredElement(
      nameRow.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected name input.",
    );

    expect(textContent(nameRow)).toContain("set");
    expect(textContent(nameRow)).toContain("required");

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(nameInput).onChange({
        target: { value: "Acme Graph Labs" },
      });
    });

    expect(textContent(getByData(container, "data-explorer-item-entity", runtime.ids.acme))).toContain(
      "Acme Graph Labs",
    );

    fireEvent.click(getByData(container, "data-explorer-nav", "types"));

    const companyTypeId = typeId(app.company);
    fireEvent.click(getByData(container, "data-explorer-item-type", companyTypeId));

    const typeNameRow = getByData(container, "data-explorer-field-path", "metadata.name");
    const typeNameInput = getRequiredElement(
      typeNameRow.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected type name input.",
    );

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(typeNameInput).onChange({
        target: { value: "Company Model" },
      });
    });

    expect(textContent(getByData(container, "data-explorer-item-type", companyTypeId))).toContain(
      "Company Model",
    );

    fireEvent.click(getByData(container, "data-explorer-nav", "predicates"));

    const websitePredicateId = edgeId(app.company.fields.website);
    fireEvent.click(getByData(container, "data-explorer-item-predicate", websitePredicateId));

    const predicateNameRow = getByData(container, "data-explorer-field-path", "metadata.name");
    const predicateNameInput = getRequiredElement(
      predicateNameRow.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected predicate name input.",
    );

    const ownerTypeButton = getByData(container, "data-explorer-open-type", companyTypeId);
    expect(textContent(ownerTypeButton.closest("section") ?? ownerTypeButton.parentElement ?? ownerTypeButton)).toContain("Company");

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(
        predicateNameInput,
      ).onChange({
        target: { value: "Website predicate" },
      });
    });

    expect(graph.predicate.ref(websitePredicateId).fields.name.get()).toBe("Website predicate");
    expect(textContent(getByData(container, "data-explorer-item-predicate", websitePredicateId))).toContain(
      "Website predicate",
    );

    unmount();
  });

  it("surfaces stream cursor, pending writes, authoritative deliveries, and reset fallbacks", async () => {
    const runtime = createExampleRuntime();

    const { container, unmount } = render(<Explorer runtime={runtime} />);

    expect(textContent(getByData(container, "data-explorer-stream-cursor", ""))).toContain(
      runtime.authority.getBaseCursor(),
    );
    getByData(container, "data-explorer-stream-pending-count", "0");

    await act(async () => {
      runtime.graph.company.update(runtime.ids.acme, {
        name: "Acme Pending Labs",
      });
    });

    const pendingWrite = getByData(container, "data-explorer-stream-pending-tx", "example:local");
    expect(textContent(pendingWrite)).toContain("assert");
    expect(textContent(pendingWrite)).toContain("retract");
    getByData(container, "data-explorer-stream-pending-count", "1");

    await act(async () => {
      await runtime.sync.flush();
    });

    const writeActivity = getByData(container, "data-explorer-stream-activity", "write");
    expect(textContent(writeActivity)).toContain("Authoritative write applied");
    expect(textContent(writeActivity)).toContain("example:1");
    expect(textContent(writeActivity)).toContain("example:local");
    getByData(container, "data-explorer-stream-pending-count", "0");

    await act(async () => {
      runtime.authority.resetAuthorityStream("reset:");
      try {
        await runtime.sync.sync();
      } catch {
        // The explorer should surface the recovery request without requiring the test to recover.
      }
    });

    const fallbackActivity = getByData(container, "data-explorer-stream-activity", "fallback");
    expect(textContent(fallbackActivity)).toContain("Snapshot recovery required");
    expect(textContent(fallbackActivity)).toContain("after example:1 -> reset:0");
    expect(textContent(fallbackActivity)).toContain("reset");
    expect(textContent(getByData(container, "data-explorer-stream-error", "error"))).toContain(
      'Incremental sync requires total snapshot recovery because the authority reported "reset".',
    );

    unmount();
  });
});
