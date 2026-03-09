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
  });

  return { company: graph.company.ref(companyId) };
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

function waitForInstrumentation() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("company proof surface", () => {
  it("renders the generated editor and mutates company fields through predicate refs", async () => {
    const { company } = setupGraph();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<CompanyProofSurface company={company} />);
    });

    const nameRow = findByProofProp(renderer!, "data-proof-field", "name");
    const statusRow = findByProofProp(renderer!, "data-proof-field", "status");
    const websiteRow = findByProofProp(renderer!, "data-proof-field", "website");
    const foundedYearRow = findByProofProp(renderer!, "data-proof-field", "foundedYear");

    const nameInput = renderer!.root.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );
    const statusSelect = renderer!.root.find(
      (node) => node.type === "select" && node.props["data-web-field-kind"] === "select",
    );
    const websiteInput = renderer!.root.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "url",
    );
    const foundedYearInput = renderer!.root.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "number",
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
      await waitForInstrumentation();
    });

    expect(company.fields.name.get()).toBe("Acme Labs");
    expect(company.fields.status.get()).toBe(app.status.values.paused.id);
    expect(company.fields.website.get().toString()).toBe("https://labs.acme.com/");
    expect(company.fields.foundedYear.get()).toBe(1999);
    expect(statusSelect.props.value).toBe(app.status.values.paused.id);

    act(() => {
      renderer?.unmount();
    });
  });

  it("records predicate-local rerender instrumentation for the edited field only", async () => {
    const { company } = setupGraph();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<CompanyProofSurface company={company} />);
    });

    const initialCounts = readProofCounts(renderer!);
    expect(initialCounts).toEqual({
      surface: 1,
      name: 1,
      status: 1,
      website: 1,
      foundedYear: 1,
    });

    const nameRow = findByProofProp(renderer!, "data-proof-field", "name");
    const nameInput = renderer!.root.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );

    await act(async () => {
      nameRow.props.onChangeCapture();
      nameInput.props.onChange({ target: { value: "Acme 2" } });
      await waitForInstrumentation();
    });

    const nextCounts = readProofCounts(renderer!);
    expect(nextCounts.surface).toBe(initialCounts.surface);
    expect(nextCounts.name ?? 0).toBeGreaterThan(initialCounts.name ?? 0);
    expect(nextCounts.status).toBe(initialCounts.status);
    expect(nextCounts.website).toBe(initialCounts.website);
    expect(nextCounts.foundedYear).toBe(initialCounts.foundedYear);

    const lastCheck = renderer!.root.find(
      (node) => typeof node.props["data-proof-last-check"] === "string",
    );
    const changed = renderer!.root.find(
      (node) => typeof node.props["data-proof-changed"] === "string",
    );

    expect(lastCheck.props["data-proof-last-check"]).toBe("holds");
    expect(changed.props["data-proof-changed"]).toBe("name");

    act(() => {
      renderer?.unmount();
    });
  });
});
