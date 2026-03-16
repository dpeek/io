import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { act } from "react";

import { bootstrap, createStore, createTypeClient, core } from "@io/graph";

import { app } from "../graph/app.js";
import { getAllByData, getByData, getReactProps, getRequiredElement } from "../test-dom.js";
import { CompanyProofSurface } from "./company-proof.js";

function setupGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);
  const graph = createTypeClient(store, app);

  const companyId = graph.company.create({
    name: "Acme",
    website: new URL("https://acme.com"),
    status: app.status.values.active.id,
    tags: ["enterprise", "saas"],
    address: {
      address_line1: "1 Graph Way",
      locality: "Sydney",
      postal_code: "2000",
    },
  });

  const estiiId = graph.company.create({
    name: "Estii",
    website: new URL("https://estii.com"),
    status: app.status.values.paused.id,
  });

  const personId = graph.person.create({
    name: "Alice",
    worksAt: [companyId],
  });

  return {
    company: graph.company.ref(companyId),
    estiiId,
    person: graph.person.ref(personId),
  };
}

function findByProofProp(container: HTMLElement, prop: string, value: string): HTMLElement {
  return getByData(container, prop, value);
}

function readProofCounts(container: HTMLElement) {
  const counts = getAllByData(container, "data-proof-count");
  return Object.fromEntries(
    counts.map((node) => [
      node.getAttribute("data-proof-count") ?? "",
      Number(node.textContent ?? ""),
    ]),
  ) as Record<string, number>;
}

function getInstrumentationValue(container: HTMLElement, attribute: string): string {
  const node = getRequiredElement(
    container.querySelector<HTMLElement>(`[${attribute}]`),
    `Expected instrumentation node for ${attribute}.`,
  );
  return node.getAttribute(attribute) ?? "";
}

async function waitForInstrumentation(container: HTMLElement, timeoutMs = 100): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    });
    if (getInstrumentationValue(container, "data-proof-last-check") !== "pending") {
      return;
    }
  }
  throw new Error("Timed out waiting for proof instrumentation to settle.");
}

describe("company proof surface", () => {
  it("renders the combined proof and mutates nested, many, and relationship fields through predicate refs", async () => {
    const { company, estiiId, person } = setupGraph();
    const { container, unmount } = render(<CompanyProofSurface company={company} person={person} />);

    const nameRow = findByProofProp(container, "data-proof-field", "name");
    const statusRow = findByProofProp(container, "data-proof-field", "status");
    const websiteRow = findByProofProp(container, "data-proof-field", "website");
    const foundedYearRow = findByProofProp(container, "data-proof-field", "foundedYear");
    const tagsRow = findByProofProp(container, "data-proof-field", "tags");
    const addressLine1Row = findByProofProp(container, "data-proof-field", "address.address_line1");
    const localityRow = findByProofProp(container, "data-proof-field", "address.locality");
    const postalCodeRow = findByProofProp(container, "data-proof-field", "address.postal_code");
    const worksAtRow = findByProofProp(container, "data-proof-field", "worksAt");

    const nameInput = getRequiredElement(
      nameRow.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected proof name input.",
    );
    const statusSelect = getRequiredElement(
      statusRow.querySelector<HTMLSelectElement>('select[data-web-field-kind="select"]'),
      "Expected proof status select.",
    );
    const websiteInput = getRequiredElement(
      websiteRow.querySelector<HTMLInputElement>('input[data-web-field-kind="url"]'),
      "Expected proof website input.",
    );
    const foundedYearInput = getRequiredElement(
      foundedYearRow.querySelector<HTMLInputElement>('input[data-web-field-kind="number"]'),
      "Expected proof founded year input.",
    );
    const tagsInput = getRequiredElement(
      tagsRow.querySelector<HTMLInputElement>('input[data-web-field-kind="token-list-input"]'),
      "Expected proof tags input.",
    );
    const addTagButton = getRequiredElement(
      tagsRow.querySelector<HTMLButtonElement>('button[data-web-field-action="add-token"]'),
      "Expected add-tag button.",
    );
    const removeTagButton = getRequiredElement(
      tagsRow.querySelector<HTMLButtonElement>(
        'button[data-web-field-action="remove-token"][data-web-token-value="saas"]',
      ),
      "Expected remove-tag button.",
    );
    const addressLine1Input = getRequiredElement(
      addressLine1Row.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected address line input.",
    );
    const localityInput = getRequiredElement(
      localityRow.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected locality input.",
    );
    const postalCodeInput = getRequiredElement(
      postalCodeRow.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected postal code input.",
    );
    const worksAtToggle = getRequiredElement(
      worksAtRow.querySelector<HTMLInputElement>(
        `label[data-web-reference-option-id="${estiiId}"] input`,
      ),
      "Expected worksAt checkbox.",
    );
    const removeCurrentEmployer = getRequiredElement(
      worksAtRow.querySelector<HTMLButtonElement>(
        `button[data-web-field-action="remove-reference"][data-web-reference-remove-id="${company.id}"]`,
      ),
      "Expected remove-reference button.",
    );

    await act(async () => {
      getReactProps<{ onChangeCapture(): void }>(nameRow).onChangeCapture();
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(nameInput).onChange({
        target: { value: "Acme Labs" },
      });
      getReactProps<{ onChangeCapture(): void }>(statusRow).onChangeCapture();
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(statusSelect).onChange({
        target: { value: app.status.values.paused.id },
      });
      getReactProps<{ onChangeCapture(): void }>(websiteRow).onChangeCapture();
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(websiteInput).onChange({
        target: { value: "https://labs.acme.com" },
      });
      getReactProps<{ onChangeCapture(): void }>(foundedYearRow).onChangeCapture();
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(foundedYearInput).onChange({
        target: { value: "1999" },
      });
      getReactProps<{ onChangeCapture(): void }>(addressLine1Row).onChangeCapture();
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(addressLine1Input).onChange({
        target: { value: "99 Schema Rd" },
      });
      getReactProps<{ onChangeCapture(): void }>(localityRow).onChangeCapture();
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(localityInput).onChange({
        target: { value: "Melbourne" },
      });
      getReactProps<{ onChangeCapture(): void }>(postalCodeRow).onChangeCapture();
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(postalCodeInput).onChange({
        target: { value: "3000" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(tagsInput).onChange({
        target: { value: "ai" },
      });
      getReactProps<{
        onClickCapture(event: { target: { getAttribute(name: string): string | null } }): void;
      }>(tagsRow).onClickCapture({
        target: {
          getAttribute: (name: string) => (name === "data-proof-mutation" ? "collection" : null),
        },
      });
      getReactProps<{ onClick(): void }>(addTagButton).onClick();
      getReactProps<{
        onClickCapture(event: { target: { getAttribute(name: string): string | null } }): void;
      }>(tagsRow).onClickCapture({
        target: {
          getAttribute: (name: string) => (name === "data-proof-mutation" ? "collection" : null),
        },
      });
      getReactProps<{ onClick(): void }>(removeTagButton).onClick();
      getReactProps<{ onChangeCapture(): void }>(worksAtRow).onChangeCapture();
      getReactProps<{ onChange(event: { target: { checked: boolean } }): void }>(worksAtToggle).onChange({
        target: { checked: true },
      });
      getReactProps<{
        onClickCapture(event: { target: { getAttribute(name: string): string | null } }): void;
      }>(worksAtRow).onClickCapture({
        target: {
          getAttribute: (name: string) => (name === "data-proof-mutation" ? "entity-reference" : null),
        },
      });
      getReactProps<{ onClick(): void }>(removeCurrentEmployer).onClick();
      await Promise.resolve();
    });
    await waitForInstrumentation(container);

    expect(company.fields.name.get()).toBe("Acme Labs");
    expect(company.fields.status.get()).toBe(app.status.values.paused.id);
    expect(company.fields.website.get().toString()).toBe("https://labs.acme.com/");
    expect(company.fields.foundedYear.get()).toBe(1999);
    expect(company.fields.tags.get()).toEqual(["enterprise", "ai"]);
    expect(company.fields.address.address_line1.get()).toBe("99 Schema Rd");
    expect(company.fields.address.locality.get()).toBe("Melbourne");
    expect(company.fields.address.postal_code.get()).toBe("3000");
    expect(person.fields.worksAt.get()).toEqual([estiiId]);
    expect(statusSelect.value).toBe(app.status.values.paused.id);

    unmount();
  });

  it("records predicate-local rerender instrumentation for nested leaves and relationship edits", async () => {
    const { company, estiiId, person } = setupGraph();
    const { container, unmount } = render(<CompanyProofSurface company={company} person={person} />);

    const initialCounts = readProofCounts(container);
    expect(initialCounts).toEqual({
      surface: 1,
      name: 1,
      status: 1,
      website: 1,
      foundedYear: 1,
      tags: 1,
      "address.address_line1": 1,
      "address.locality": 1,
      "address.postal_code": 1,
      worksAt: 1,
    });

    const localityRow = findByProofProp(container, "data-proof-field", "address.locality");
    const localityInput = getRequiredElement(
      localityRow.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected locality input.",
    );
    const worksAtRow = findByProofProp(container, "data-proof-field", "worksAt");
    const worksAtToggle = getRequiredElement(
      worksAtRow.querySelector<HTMLInputElement>(
        `label[data-web-reference-option-id="${estiiId}"] input`,
      ),
      "Expected worksAt checkbox.",
    );

    await act(async () => {
      getReactProps<{ onChangeCapture(): void }>(localityRow).onChangeCapture();
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(localityInput).onChange({
        target: { value: "Melbourne" },
      });
      await Promise.resolve();
    });
    await waitForInstrumentation(container);

    const localityCounts = readProofCounts(container);
    expect(localityCounts.surface).toBe(initialCounts.surface);
    expect(localityCounts.name).toBe(initialCounts.name);
    expect(localityCounts.status).toBe(initialCounts.status);
    expect(localityCounts.website).toBe(initialCounts.website);
    expect(localityCounts.foundedYear).toBe(initialCounts.foundedYear);
    expect(localityCounts.tags).toBe(initialCounts.tags);
    expect(localityCounts["address.address_line1"]).toBe(initialCounts["address.address_line1"]);
    expect(localityCounts["address.locality"] ?? 0).toBeGreaterThan(
      initialCounts["address.locality"] ?? 0,
    );
    expect(localityCounts["address.postal_code"]).toBe(initialCounts["address.postal_code"]);
    expect(localityCounts.worksAt).toBe(initialCounts.worksAt);

    expect(getInstrumentationValue(container, "data-proof-last-check")).toBe("holds");
    expect(getInstrumentationValue(container, "data-proof-changed")).toBe("address.locality");

    await act(async () => {
      getReactProps<{ onChangeCapture(): void }>(worksAtRow).onChangeCapture();
      getReactProps<{ onChange(event: { target: { checked: boolean } }): void }>(worksAtToggle).onChange({
        target: { checked: true },
      });
      await Promise.resolve();
    });
    await waitForInstrumentation(container);

    const relationshipCounts = readProofCounts(container);
    expect(relationshipCounts.surface).toBe(localityCounts.surface);
    expect(relationshipCounts.name).toBe(localityCounts.name);
    expect(relationshipCounts.status).toBe(localityCounts.status);
    expect(relationshipCounts.website).toBe(localityCounts.website);
    expect(relationshipCounts.foundedYear).toBe(localityCounts.foundedYear);
    expect(relationshipCounts.tags).toBe(localityCounts.tags);
    expect(relationshipCounts["address.address_line1"]).toBe(
      localityCounts["address.address_line1"],
    );
    expect(relationshipCounts["address.locality"]).toBe(localityCounts["address.locality"]);
    expect(relationshipCounts["address.postal_code"]).toBe(localityCounts["address.postal_code"]);
    expect(relationshipCounts.worksAt ?? 0).toBeGreaterThan(localityCounts.worksAt ?? 0);
    expect(person.fields.worksAt.get()).toEqual([company.id, estiiId]);
    expect(getInstrumentationValue(container, "data-proof-last-check")).toBe("holds");
    expect(getInstrumentationValue(container, "data-proof-changed")).toBe("worksAt");

    unmount();
  });
});
