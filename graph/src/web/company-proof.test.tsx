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
    const tagsRow = findByProofProp(renderer!, "data-proof-field", "tags");

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
    const tagsInput = renderer!.root.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "token-list-input",
    );
    const addTagButton = renderer!.root.find(
      (node) => node.type === "button" && node.props["data-web-field-action"] === "add-token",
    );
    const removeTagButton = renderer!.root.find(
      (node) =>
        node.type === "button" &&
        node.props["data-web-field-action"] === "remove-token" &&
        node.props["data-web-token-value"] === "saas",
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
      await waitForInstrumentation();
    });

    expect(company.fields.name.get()).toBe("Acme Labs");
    expect(company.fields.status.get()).toBe(app.status.values.paused.id);
    expect(company.fields.website.get().toString()).toBe("https://labs.acme.com/");
    expect(company.fields.foundedYear.get()).toBe(1999);
    expect(company.fields.tags.get()).toEqual(["enterprise", "ai"]);
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
      tags: 1,
    });

    const tagsRow = findByProofProp(renderer!, "data-proof-field", "tags");
    const tagsInput = renderer!.root.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "token-list-input",
    );
    const addTagButton = renderer!.root.find(
      (node) => node.type === "button" && node.props["data-web-field-action"] === "add-token",
    );

    await act(async () => {
      tagsInput.props.onChange({ target: { value: "ai" } });
    });

    const draftCounts = readProofCounts(renderer!);

    await act(async () => {
      tagsRow.props.onClickCapture({
        target: {
          getAttribute: (name: string) => (name === "data-proof-mutation" ? "collection" : null),
        },
      });
      addTagButton.props.onClick();
      await waitForInstrumentation();
    });

    const nextCounts = readProofCounts(renderer!);
    expect(nextCounts.surface).toBe(draftCounts.surface);
    expect(nextCounts.name).toBe(draftCounts.name);
    expect(nextCounts.status).toBe(draftCounts.status);
    expect(nextCounts.website).toBe(draftCounts.website);
    expect(nextCounts.foundedYear).toBe(draftCounts.foundedYear);
    expect(nextCounts.tags ?? 0).toBeGreaterThan(draftCounts.tags ?? 0);

    const lastCheck = renderer!.root.find(
      (node) => typeof node.props["data-proof-last-check"] === "string",
    );
    const changed = renderer!.root.find(
      (node) => typeof node.props["data-proof-changed"] === "string",
    );

    expect(lastCheck.props["data-proof-last-check"]).toBe("holds");
    expect(changed.props["data-proof-changed"]).toBe("tags");

    act(() => {
      renderer?.unmount();
    });
  });
});
