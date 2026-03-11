import { describe, expect, it } from "bun:test";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { app } from "../graph/app.js";
import { bootstrap } from "../graph/bootstrap.js";
import { createTypeClient } from "../graph/client.js";
import { core } from "../graph/core.js";
import { createStore } from "../graph/store.js";

import { CompanyProofSurface } from "./company-proof.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

function findByProofProp(
  renderer: ReturnType<typeof create>,
  prop: string,
  value: string,
): ReactTestInstance {
  return renderer.root.find((node) => node.props[prop] === value);
}

function readProofCounts(renderer: ReturnType<typeof create>) {
  const counts = renderer.root.findAll((node) => typeof node.props["data-proof-count"] === "string");
  return Object.fromEntries(
    counts.map((node) => [
      node.props["data-proof-count"] as string,
      Number(node.children.join("")),
    ]),
  ) as Record<string, number>;
}

async function waitForInstrumentation(
  renderer: ReturnType<typeof create>,
  timeoutMs = 100,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    const lastCheck = renderer.root.find(
      (node) => typeof node.props["data-proof-last-check"] === "string",
    );
    if (lastCheck.props["data-proof-last-check"] !== "pending") return;
  }
  throw new Error("Timed out waiting for proof instrumentation to settle.");
}

describe("company proof surface", () => {
  it("renders the combined proof and mutates nested, many, and relationship fields through predicate refs", async () => {
    const { company, estiiId, person } = setupGraph();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<CompanyProofSurface company={company} person={person} />);
    });

    const nameRow = findByProofProp(renderer!, "data-proof-field", "name");
    const statusRow = findByProofProp(renderer!, "data-proof-field", "status");
    const websiteRow = findByProofProp(renderer!, "data-proof-field", "website");
    const foundedYearRow = findByProofProp(renderer!, "data-proof-field", "foundedYear");
    const tagsRow = findByProofProp(renderer!, "data-proof-field", "tags");
    const addressLine1Row = findByProofProp(renderer!, "data-proof-field", "address.address_line1");
    const localityRow = findByProofProp(renderer!, "data-proof-field", "address.locality");
    const postalCodeRow = findByProofProp(renderer!, "data-proof-field", "address.postal_code");
    const worksAtRow = findByProofProp(renderer!, "data-proof-field", "worksAt");

    const nameInput = nameRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );
    const statusSelect = statusRow.find(
      (node) => node.type === "select" && node.props["data-web-field-kind"] === "select",
    );
    const websiteInput = websiteRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "url",
    );
    const foundedYearInput = foundedYearRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "number",
    );
    const tagsInput = tagsRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "token-list-input",
    );
    const addTagButton = tagsRow.find(
      (node) => node.type === "button" && node.props["data-web-field-action"] === "add-token",
    );
    const removeTagButton = tagsRow.find(
      (node) =>
        node.type === "button" &&
        node.props["data-web-field-action"] === "remove-token" &&
        node.props["data-web-token-value"] === "saas",
    );
    const addressLine1Input = addressLine1Row.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );
    const localityInput = localityRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );
    const postalCodeInput = postalCodeRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );
    const worksAtToggle = worksAtRow
      .find((node) => node.type === "label" && node.props["data-web-reference-option-id"] === estiiId)
      .findByType("input");
    const removeCurrentEmployer = worksAtRow.find(
      (node) =>
        node.type === "button" &&
        node.props["data-web-field-action"] === "remove-reference" &&
        node.props["data-web-reference-remove-id"] === company.id,
    );

    await act(async () => {
      nameRow.props.onChangeCapture();
      nameInput.props.onChange({ target: { value: "Acme Labs" } });
      statusRow.props.onChangeCapture();
      statusSelect.props.onChange({ target: { value: app.status.values.paused.id } });
      websiteRow.props.onChangeCapture();
      websiteInput.props.onChange({ target: { value: "https://labs.acme.com" } });
      foundedYearRow.props.onChangeCapture();
      foundedYearInput.props.onChange({ target: { value: "1999" } });
      addressLine1Row.props.onChangeCapture();
      addressLine1Input.props.onChange({ target: { value: "99 Schema Rd" } });
      localityRow.props.onChangeCapture();
      localityInput.props.onChange({ target: { value: "Melbourne" } });
      postalCodeRow.props.onChangeCapture();
      postalCodeInput.props.onChange({ target: { value: "3000" } });
      tagsInput.props.onChange({ target: { value: "ai" } });
    });

    await act(async () => {
      tagsRow.props.onClickCapture({
        target: {
          getAttribute: (name: string) => (name === "data-proof-mutation" ? "collection" : null),
        },
      });
      addTagButton.props.onClick();
      tagsRow.props.onClickCapture({
        target: {
          getAttribute: (name: string) => (name === "data-proof-mutation" ? "collection" : null),
        },
      });
      removeTagButton.props.onClick();
      worksAtRow.props.onChangeCapture();
      worksAtToggle.props.onChange({ target: { checked: true } });
      worksAtRow.props.onClickCapture({
        target: {
          getAttribute: (name: string) =>
            name === "data-proof-mutation" ? "entity-reference" : null,
        },
      });
      removeCurrentEmployer.props.onClick();
      await waitForInstrumentation(renderer!);
    });

    expect(company.fields.name.get()).toBe("Acme Labs");
    expect(company.fields.status.get()).toBe(app.status.values.paused.id);
    expect(company.fields.website.get().toString()).toBe("https://labs.acme.com/");
    expect(company.fields.foundedYear.get()).toBe(1999);
    expect(company.fields.tags.get()).toEqual(["enterprise", "ai"]);
    expect(company.fields.address.address_line1.get()).toBe("99 Schema Rd");
    expect(company.fields.address.locality.get()).toBe("Melbourne");
    expect(company.fields.address.postal_code.get()).toBe("3000");
    expect(person.fields.worksAt.get()).toEqual([estiiId]);
    expect(statusSelect.props.value).toBe(app.status.values.paused.id);

    act(() => {
      renderer?.unmount();
    });
  });

  it("records predicate-local rerender instrumentation for nested leaves and relationship edits", async () => {
    const { company, estiiId, person } = setupGraph();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<CompanyProofSurface company={company} person={person} />);
    });

    const initialCounts = readProofCounts(renderer!);
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

    const localityRow = findByProofProp(renderer!, "data-proof-field", "address.locality");
    const localityInput = localityRow.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );
    const worksAtRow = findByProofProp(renderer!, "data-proof-field", "worksAt");
    const worksAtToggle = worksAtRow
      .find((node) => node.type === "label" && node.props["data-web-reference-option-id"] === estiiId)
      .findByType("input");

    await act(async () => {
      localityRow.props.onChangeCapture();
      localityInput.props.onChange({ target: { value: "Melbourne" } });
      await waitForInstrumentation(renderer!);
    });

    const localityCounts = readProofCounts(renderer!);
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

    const lastCheck = renderer!.root.find(
      (node) => typeof node.props["data-proof-last-check"] === "string",
    );
    const changed = renderer!.root.find(
      (node) => typeof node.props["data-proof-changed"] === "string",
    );

    expect(lastCheck.props["data-proof-last-check"]).toBe("holds");
    expect(changed.props["data-proof-changed"]).toBe("address.locality");

    await act(async () => {
      worksAtRow.props.onChangeCapture();
      worksAtToggle.props.onChange({ target: { checked: true } });
      await waitForInstrumentation(renderer!);
    });

    const relationshipCounts = readProofCounts(renderer!);
    expect(relationshipCounts.surface).toBe(localityCounts.surface);
    expect(relationshipCounts.name).toBe(localityCounts.name);
    expect(relationshipCounts.status).toBe(localityCounts.status);
    expect(relationshipCounts.website).toBe(localityCounts.website);
    expect(relationshipCounts.foundedYear).toBe(localityCounts.foundedYear);
    expect(relationshipCounts.tags).toBe(localityCounts.tags);
    expect(relationshipCounts["address.address_line1"]).toBe(localityCounts["address.address_line1"]);
    expect(relationshipCounts["address.locality"]).toBe(localityCounts["address.locality"]);
    expect(relationshipCounts["address.postal_code"]).toBe(localityCounts["address.postal_code"]);
    expect(relationshipCounts.worksAt ?? 0).toBeGreaterThan(localityCounts.worksAt ?? 0);
    expect(person.fields.worksAt.get()).toEqual([company.id, estiiId]);
    expect(lastCheck.props["data-proof-last-check"]).toBe("holds");
    expect(changed.props["data-proof-changed"]).toBe("worksAt");

    act(() => {
      renderer?.unmount();
    });
  });
});
