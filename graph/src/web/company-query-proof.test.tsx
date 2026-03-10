import { describe, expect, it } from "bun:test";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { app } from "../graph/app.js";
import { bootstrap } from "../graph/bootstrap.js";
import { createTypeClient } from "../graph/client.js";
import { core } from "../graph/core.js";
import { createStore } from "../graph/store.js";

import { CompanyQueryProofSurface } from "./company-query-proof.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
    companies: [graph.company.ref(acmeId), graph.company.ref(estiiId), graph.company.ref(atlasId)] as const,
  };
}

function findByProp(
  renderer: ReturnType<typeof create>,
  prop: string,
  value: string,
): ReactTestInstance {
  return renderer.root.find((node) => node.props[prop] === value);
}

function readLoweredQuery(renderer: ReturnType<typeof create>) {
  const node = findByProp(renderer, "data-company-query-json", "");
  return JSON.parse(node.children.join("")) as {
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

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<CompanyQueryProofSurface companies={companies} querySource={acme} />);
    });

    const nameRow = findByProp(renderer!, "data-company-query-row", "name");
    const statusRow = findByProp(renderer!, "data-company-query-row", "status");
    const websiteRow = findByProp(renderer!, "data-company-query-row", "website");
    const foundedYearRow = findByProp(renderer!, "data-company-query-row", "foundedYear");

    const nameOperator = nameRow.find(
      (node) => node.type === "select" && node.props["data-company-query-control"] === "operator",
    );
    const statusOperator = statusRow.find(
      (node) => node.type === "select" && node.props["data-company-query-control"] === "operator",
    );
    const websiteOperator = websiteRow.find(
      (node) => node.type === "select" && node.props["data-company-query-control"] === "operator",
    );
    const foundedYearOperator = foundedYearRow.find(
      (node) => node.type === "select" && node.props["data-company-query-control"] === "operator",
    );

    expect(nameOperator.props.value).toBe("contains");
    expect(statusOperator.props.value).toBe("is");
    expect(websiteOperator.props.value).toBe("equals");
    expect(foundedYearOperator.props.value).toBe("equals");

    const nameInput = nameRow.find(
      (node) => node.type === "input" && node.props["data-web-filter-operand-kind"] === "string",
    );
    const statusOperand = statusRow.find(
      (node) => node.type === "select" && node.props["data-web-filter-operand-kind"] === "enum",
    );
    const websiteInput = websiteRow.find(
      (node) => node.type === "input" && node.props["data-web-filter-operand-kind"] === "url",
    );
    const foundedYearInput = foundedYearRow.find(
      (node) => node.type === "input" && node.props["data-web-filter-operand-kind"] === "number",
    );

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Acme" } });
      statusOperand.props.onChange({ target: { value: app.status.values.active.id } });
      websiteInput.props.onChange({ target: { value: "https://acme.com" } });
      foundedYearInput.props.onChange({ target: { value: "1987" } });
    });

    const query = readLoweredQuery(renderer!);
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

    const matches = renderer!.root
      .findAll((node) => typeof node.props["data-company-query-match"] === "string")
      .map((node) => node.props["data-company-query-match"] as string);

    expect(matches).toEqual([acme.id]);

    act(() => {
      renderer?.unmount();
    });
  });

  it("switches operator-specific operands and filters optional founded years through the compiled query plan", async () => {
    const { acme, atlas, companies } = setupGraph();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<CompanyQueryProofSurface companies={companies} querySource={acme} />);
    });

    const websiteRow = findByProp(renderer!, "data-company-query-row", "website");
    const foundedYearRow = findByProp(renderer!, "data-company-query-row", "foundedYear");

    const websiteOperator = websiteRow.find(
      (node) => node.type === "select" && node.props["data-company-query-control"] === "operator",
    );
    const foundedYearOperator = foundedYearRow.find(
      (node) => node.type === "select" && node.props["data-company-query-control"] === "operator",
    );

    await act(async () => {
      websiteOperator.props.onChange({ target: { value: "host" } });
      foundedYearOperator.props.onChange({ target: { value: "gt" } });
    });

    const websiteHostInput = websiteRow.find(
      (node) => node.type === "input" && node.props["data-web-filter-operand-kind"] === "string",
    );
    const foundedYearInput = foundedYearRow.find(
      (node) => node.type === "input" && node.props["data-web-filter-operand-kind"] === "number",
    );

    await act(async () => {
      websiteHostInput.props.onChange({ target: { value: "atlas.io" } });
      foundedYearInput.props.onChange({ target: { value: "2000" } });
    });

    const query = readLoweredQuery(renderer!);
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

    const matches = renderer!.root
      .findAll((node) => typeof node.props["data-company-query-match"] === "string")
      .map((node) => node.props["data-company-query-match"] as string);

    expect(matches).toEqual([atlas.id]);

    act(() => {
      renderer?.unmount();
    });
  });
});
