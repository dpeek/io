import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { act } from "react";

import { bootstrap, createStore, createTypeClient, core } from "@io/graph";

import { app } from "../graph/app.js";
import { getAllByData, getByData, getReactProps, getRequiredElement } from "../test-dom.js";
import { CompanyQueryProofSurface } from "./company-query-proof.js";

function setupGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);
  const graph = createTypeClient(store, app);

  const acmeId = graph.company.create({
    name: "Acme Corp",
    status: app.status.values.active.id,
    foundedYear: 1987,
    website: new URL("https://acme.com"),
  });

  const estiiId = graph.company.create({
    name: "Estii",
    status: app.status.values.paused.id,
    website: new URL("https://estii.com"),
  });

  const atlasId = graph.company.create({
    name: "Atlas Labs",
    status: app.status.values.active.id,
    foundedYear: 2015,
    website: new URL("https://atlas.io"),
  });

  return {
    acme: graph.company.ref(acmeId),
    atlas: graph.company.ref(atlasId),
    companies: [
      graph.company.ref(acmeId),
      graph.company.ref(estiiId),
      graph.company.ref(atlasId),
    ] as const,
  };
}

function readLoweredQuery(container: HTMLElement) {
  const node = getByData(container, "data-company-query-json", "");
  return JSON.parse(node.textContent ?? "") as {
    entityTypeKey: string;
    combinator: string;
    clauses: Array<{
      cardinality: string;
      predicateId: string;
      predicateKey: string;
      rangeKey: string;
      operatorKey: string;
      operatorLabel: string;
      operand: {
        kind: string;
        selection?: string;
        value: string;
      };
    }>;
  };
}

describe("company query proof surface", () => {
  it("builds filter rows from typed refs and lowers a four-clause company query", async () => {
    const { acme, companies } = setupGraph();
    const { container, unmount } = render(
      <CompanyQueryProofSurface companies={companies} querySource={acme} />,
    );

    const nameRow = getByData(container, "data-company-query-row", "name");
    const statusRow = getByData(container, "data-company-query-row", "status");
    const websiteRow = getByData(container, "data-company-query-row", "website");
    const foundedYearRow = getByData(container, "data-company-query-row", "foundedYear");

    const nameOperator = getRequiredElement(
      nameRow.querySelector<HTMLSelectElement>('select[data-company-query-control="operator"]'),
      "Expected name operator select.",
    );
    const statusOperator = getRequiredElement(
      statusRow.querySelector<HTMLSelectElement>('select[data-company-query-control="operator"]'),
      "Expected status operator select.",
    );
    const websiteOperator = getRequiredElement(
      websiteRow.querySelector<HTMLSelectElement>('select[data-company-query-control="operator"]'),
      "Expected website operator select.",
    );
    const foundedYearOperator = getRequiredElement(
      foundedYearRow.querySelector<HTMLSelectElement>('select[data-company-query-control="operator"]'),
      "Expected founded year operator select.",
    );

    expect(nameOperator.value).toBe("contains");
    expect(statusOperator.value).toBe("is");
    expect(websiteOperator.value).toBe("equals");
    expect(foundedYearOperator.value).toBe("equals");

    const nameInput = getRequiredElement(
      nameRow.querySelector<HTMLInputElement>('input[data-web-filter-operand-kind="string"]'),
      "Expected name input.",
    );
    const statusOperand = getRequiredElement(
      statusRow.querySelector<HTMLSelectElement>('select[data-web-filter-operand-kind="enum"]'),
      "Expected status operand select.",
    );
    const websiteInput = getRequiredElement(
      websiteRow.querySelector<HTMLInputElement>('input[data-web-filter-operand-kind="url"]'),
      "Expected website input.",
    );
    const foundedYearInput = getRequiredElement(
      foundedYearRow.querySelector<HTMLInputElement>('input[data-web-filter-operand-kind="number"]'),
      "Expected founded year input.",
    );

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(nameInput).onChange({
        target: { value: "Acme" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(statusOperand).onChange({
        target: { value: app.status.values.active.id },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(websiteInput).onChange({
        target: { value: "https://acme.com" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(foundedYearInput).onChange({
        target: { value: "1987" },
      });
    });

    const query = readLoweredQuery(container);
    expect(query.entityTypeKey).toBe(app.company.values.key);
    expect(query.combinator).toBe("and");
    expect(query.clauses).toEqual([
      {
        cardinality: "one",
        predicateId: acme.fields.name.predicateId,
        predicateKey: acme.fields.name.field.key,
        rangeKey: acme.fields.name.field.range,
        operatorKey: "contains",
        operatorLabel: "Contains",
        operand: {
          kind: "string",
          value: "Acme",
        },
      },
      {
        cardinality: "one",
        predicateId: acme.fields.status.predicateId,
        predicateKey: acme.fields.status.field.key,
        rangeKey: acme.fields.status.field.range,
        operatorKey: "is",
        operatorLabel: "Is",
        operand: {
          kind: "enum",
          selection: "one",
          value: app.status.values.active.id,
        },
      },
      {
        cardinality: "one",
        predicateId: acme.fields.website.predicateId,
        predicateKey: acme.fields.website.field.key,
        rangeKey: acme.fields.website.field.range,
        operatorKey: "equals",
        operatorLabel: "Equals",
        operand: {
          kind: "url",
          value: "https://acme.com/",
        },
      },
      {
        cardinality: "one?",
        predicateId: acme.fields.foundedYear.predicateId,
        predicateKey: acme.fields.foundedYear.field.key,
        rangeKey: acme.fields.foundedYear.field.range,
        operatorKey: "equals",
        operatorLabel: "Equals",
        operand: {
          kind: "number",
          value: "1987",
        },
      },
    ]);

    const matches = getAllByData(container, "data-company-query-match").map(
      (node) => node.getAttribute("data-company-query-match") ?? "",
    );

    expect(matches).toEqual([acme.id]);

    unmount();
  });

  it("switches operator-specific operands and filters optional founded years through the compiled query plan", async () => {
    const { acme, atlas, companies } = setupGraph();
    const { container, unmount } = render(
      <CompanyQueryProofSurface companies={companies} querySource={acme} />,
    );

    const websiteRow = getByData(container, "data-company-query-row", "website");
    const foundedYearRow = getByData(container, "data-company-query-row", "foundedYear");

    const websiteOperator = getRequiredElement(
      websiteRow.querySelector<HTMLSelectElement>('select[data-company-query-control="operator"]'),
      "Expected website operator select.",
    );
    const foundedYearOperator = getRequiredElement(
      foundedYearRow.querySelector<HTMLSelectElement>('select[data-company-query-control="operator"]'),
      "Expected founded year operator select.",
    );

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(
        websiteOperator,
      ).onChange({
        target: { value: "host" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(
        foundedYearOperator,
      ).onChange({
        target: { value: "gt" },
      });
    });

    const websiteHostInput = getRequiredElement(
      websiteRow.querySelector<HTMLInputElement>('input[data-web-filter-operand-kind="string"]'),
      "Expected website host input.",
    );
    const foundedYearInput = getRequiredElement(
      foundedYearRow.querySelector<HTMLInputElement>('input[data-web-filter-operand-kind="number"]'),
      "Expected founded year input.",
    );

    act(() => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(
        websiteHostInput,
      ).onChange({
        target: { value: "atlas.io" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(foundedYearInput).onChange({
        target: { value: "2000" },
      });
    });

    const query = readLoweredQuery(container);
    expect(query.clauses).toEqual([
      {
        cardinality: "one",
        predicateId: acme.fields.website.predicateId,
        predicateKey: acme.fields.website.field.key,
        rangeKey: acme.fields.website.field.range,
        operatorKey: "host",
        operatorLabel: "Host",
        operand: {
          kind: "string",
          value: "atlas.io",
        },
      },
      {
        cardinality: "one?",
        predicateId: acme.fields.foundedYear.predicateId,
        predicateKey: acme.fields.foundedYear.field.key,
        rangeKey: acme.fields.foundedYear.field.range,
        operatorKey: "gt",
        operatorLabel: "Greater than",
        operand: {
          kind: "number",
          value: "2000",
        },
      },
    ]);

    const matches = getAllByData(container, "data-company-query-match").map(
      (node) => node.getAttribute("data-company-query-match") ?? "",
    );

    expect(matches).toEqual([atlas.id]);

    unmount();
  });
});
