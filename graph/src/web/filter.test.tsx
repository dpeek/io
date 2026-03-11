import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";

import { app } from "../graph/app.js";
import { core } from "../graph/core.js";
import { defineType } from "../graph/schema.js";
import { statusTypeModule } from "../type/status/index.js";
import { FilterOperandEditor, defaultWebFilterResolver, lowerWebFilterClause } from "./bindings.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const defs = { ...core, ...app };

describe("web filter resolver", () => {
  it("resolves narrowed string operators from schema metadata", () => {
    const resolution = defaultWebFilterResolver.resolveField(app.block.fields.text, defs);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    expect(resolution.defaultOperator).toBe("contains");
    expect(resolution.operators.map((operator) => operator.key)).toEqual(["contains", "prefix"]);

    const prefixOperator = resolution.resolveOperator("prefix");
    expect(prefixOperator?.operand.kind).toBe("string");
    expect(prefixOperator?.operand.editor.status).toBe("resolved");

    let nextOperand: string | undefined;
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        <FilterOperandEditor
          onChange={(value) => {
            nextOperand = value;
          }}
          operator={prefixOperator!}
          value="Ac"
        />,
      );
    });

    const input = renderer?.root.findByType("input");
    expect(input?.props["data-web-filter-operand-kind"]).toBe("string");
    expect(input?.props.value).toBe("Ac");

    act(() => {
      input?.props.onChange({ target: { value: "Acme" } });
    });

    expect(nextOperand).toBe("Acme");

    act(() => {
      renderer?.unmount();
    });
  });

  it("parses number operands through the resolved operator contract", () => {
    const resolution = defaultWebFilterResolver.resolveField(app.company.fields.foundedYear, defs);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    expect(resolution.defaultOperator).toBe("equals");
    expect(resolution.operators.map((operator) => operator.key)).toEqual(["equals", "gt", "lt"]);

    const greaterThan = resolution.resolveOperator("gt");
    expect(greaterThan?.operand.kind).toBe("number");
    expect(greaterThan?.operand.editor.status).toBe("resolved");
    if (!greaterThan) return;

    let nextOperand: number | undefined;
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        <FilterOperandEditor
          onChange={(value) => {
            nextOperand = value;
          }}
          operator={greaterThan}
          value={1999}
        />,
      );
    });

    const input = renderer?.root.findByType("input");
    expect(input?.props["data-web-filter-operand-kind"]).toBe("number");
    expect(input?.props.value).toBe("1999");

    act(() => {
      input?.props.onChange({ target: { value: "2001" } });
    });

    expect(nextOperand === 2001).toBe(true);

    act(() => {
      input?.props.onChange({ target: { value: "not-a-number" } });
    });

    expect(nextOperand === 2001).toBe(true);
    expect(renderer?.root.findByType("input").props["aria-invalid"]).toBe(true);

    act(() => {
      renderer?.unmount();
    });
  });

  it("parses url operands into URL instances", () => {
    const resolution = defaultWebFilterResolver.resolveField(app.company.fields.website, defs);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    const equalsOperator = resolution.resolveOperator("equals");
    expect(equalsOperator?.operand.kind).toBe("url");
    expect(equalsOperator?.operand.editor.status).toBe("resolved");
    if (!equalsOperator) return;

    let nextOperand: URL | undefined;
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        <FilterOperandEditor
          onChange={(value) => {
            nextOperand = value;
          }}
          operator={equalsOperator}
          value={new URL("https://acme.com")}
        />,
      );
    });

    const input = renderer?.root.findByType("input");
    expect(input?.props["data-web-filter-operand-kind"]).toBe("url");
    expect(input?.props.value).toBe("https://acme.com/");

    act(() => {
      input?.props.onChange({ target: { value: "https://labs.acme.com" } });
    });

    expect(nextOperand).toBeInstanceOf(URL);
    if (!(nextOperand instanceof URL)) {
      throw new Error("expected a URL operand");
    }
    expect(nextOperand.toString()).toBe("https://labs.acme.com/");

    act(() => {
      renderer?.unmount();
    });
  });

  it("resolves built-in validated string helpers through field filter metadata", () => {
    const emailResolution = defaultWebFilterResolver.resolveField(
      app.company.fields.contactEmail,
      defs,
    );

    expect(emailResolution.status).toBe("resolved");
    if (emailResolution.status !== "resolved") return;

    expect(emailResolution.defaultOperator).toBe("domain");
    expect(emailResolution.operators.map((operator) => operator.key)).toEqual(["equals", "domain"]);

    const domainOperator = emailResolution.resolveOperator("domain");
    expect(domainOperator?.operand.kind).toBe("string");
    expect(domainOperator?.operand.editor.status).toBe("resolved");
    expect(domainOperator?.parse("ACME.COM")).toBe("acme.com");
    expect(domainOperator?.test("team@acme.com", "acme.com")).toBe(true);

    const slugResolution = defaultWebFilterResolver.resolveField(app.company.fields.slug, defs);

    expect(slugResolution.status).toBe("resolved");
    if (slugResolution.status !== "resolved") return;

    expect(slugResolution.defaultOperator).toBe("prefix");
    expect(slugResolution.operators.map((operator) => operator.key)).toEqual(["equals", "prefix"]);

    const prefixOperator = slugResolution.resolveOperator("prefix");
    expect(prefixOperator?.operand.kind).toBe("string");
    expect(prefixOperator?.parse("Acme Labs")).toBe("acme-labs");
    expect(prefixOperator?.test("acme-labs", "acme-labs")).toBe(true);
  });

  it("adapts enum operators to resolved member identities", () => {
    const resolution = defaultWebFilterResolver.resolveField(app.company.fields.status, defs);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    expect(resolution.defaultOperator).toBe("is");
    expect(resolution.operators.map((operator) => operator.key)).toEqual(["is"]);

    const isOperator = resolution.resolveOperator("is");
    expect(isOperator).toBeDefined();
    if (!isOperator) return;
    expect(isOperator.operand.kind).toBe("enum");
    expect(isOperator.operand.selection).toBe("one");
    expect(isOperator.operand.editor.status).toBe("resolved");
    expect(isOperator.operand.options).toEqual([
      {
        value: app.status.values.active.id,
        key: app.status.values.active.key,
        label: "Active",
      },
      {
        value: app.status.values.paused.id,
        key: app.status.values.paused.key,
        label: "Paused",
      },
    ]);
    expect(isOperator.parse(app.status.values.active.id)).toBe(app.status.values.active.id);
    expect(isOperator.format(app.status.values.paused.id)).toBe(app.status.values.paused.id);
    expect(isOperator.test(app.status.values.active.id, app.status.values.active.id)).toBe(true);

    let nextOperand: string | undefined;
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        <FilterOperandEditor
          onChange={(value) => {
            nextOperand = value;
          }}
          operator={isOperator}
          value={app.status.values.active.id}
        />,
      );
    });

    const select = renderer?.root.findByType("select");
    expect(select?.props["data-web-filter-operand-kind"]).toBe("enum");
    expect(select?.props["data-web-filter-selection"]).toBe("one");
    expect(select?.props.value).toBe(app.status.values.active.id);

    act(() => {
      select?.props.onChange({ target: { value: app.status.values.paused.id } });
    });

    expect(nextOperand === app.status.values.paused.id).toBe(true);

    act(() => {
      renderer?.unmount();
    });
  });

  it("lowers resolved operators into serializable runtime clauses", () => {
    const urlResolution = defaultWebFilterResolver.resolveField(app.company.fields.website, defs);

    expect(urlResolution.status).toBe("resolved");
    if (urlResolution.status !== "resolved") return;

    const equalsOperator = urlResolution.resolveOperator("equals");
    expect(equalsOperator).toBeDefined();
    if (!equalsOperator) return;

    const urlClause = lowerWebFilterClause(
      {
        predicateId: "predicate:website",
        field: app.company.fields.website,
      },
      equalsOperator,
      new URL("https://acme.com"),
    );

    expect(urlClause).toEqual({
      predicateId: "predicate:website",
      predicateKey: app.company.fields.website.key,
      rangeKey: app.company.fields.website.range,
      cardinality: app.company.fields.website.cardinality,
      operatorKey: "equals",
      operatorLabel: "Equals",
      operand: {
        kind: "url",
        value: "https://acme.com/",
      },
    });

    const enumResolution = defaultWebFilterResolver.resolveField(app.company.fields.status, defs);

    expect(enumResolution.status).toBe("resolved");
    if (enumResolution.status !== "resolved") return;

    const isOperator = enumResolution.resolveOperator("is");
    expect(isOperator).toBeDefined();
    if (!isOperator) return;

    const statusClause = lowerWebFilterClause(
      {
        predicateId: "predicate:status",
        field: app.company.fields.status,
      },
      isOperator,
      app.status.values.active.id,
    );

    expect(statusClause).toEqual({
      predicateId: "predicate:status",
      predicateKey: app.company.fields.status.key,
      rangeKey: app.company.fields.status.range,
      cardinality: app.company.fields.status.cardinality,
      operatorKey: "is",
      operatorLabel: "Is",
      operand: {
        kind: "enum",
        selection: "one",
        value: app.status.values.active.id,
      },
    });
  });

  it("supports multi-select enum operands from the module filter contract", () => {
    const probeType = defineType({
      values: { key: "probe:status-filter", name: "Probe Status Filter" },
      fields: {
        status: statusTypeModule.field({
          cardinality: "one",
        }),
      },
    });
    const resolution = defaultWebFilterResolver.resolveField(probeType.fields.status, defs);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    expect(resolution.operators.map((operator) => operator.key)).toEqual(["is", "oneOf"]);

    const oneOfOperator = resolution.resolveOperator("oneOf");
    expect(oneOfOperator).toBeDefined();
    if (!oneOfOperator) return;
    expect(oneOfOperator.operand.kind).toBe("enum");
    expect(oneOfOperator.operand.selection).toBe("many");
    expect(oneOfOperator.operand.editor.status).toBe("resolved");
    expect(
      oneOfOperator.parse(`${app.status.values.active.id},${app.status.values.paused.id}`),
    ).toEqual([app.status.values.active.id, app.status.values.paused.id]);

    let nextOperand: string[] | undefined;
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        <FilterOperandEditor
          onChange={(value) => {
            nextOperand = value;
          }}
          operator={oneOfOperator}
          value={[app.status.values.active.id]}
        />,
      );
    });

    const select = renderer?.root.findByType("select");
    expect(select?.props.multiple).toBe(true);
    expect(select?.props["data-web-filter-selection"]).toBe("many");

    act(() => {
      select?.props.onChange({
        target: {
          selectedOptions: [
            { value: app.status.values.active.id },
            { value: app.status.values.paused.id },
          ],
        },
      });
    });

    expect(nextOperand?.join(",")).toBe(
      [app.status.values.active.id, app.status.values.paused.id].join(","),
    );

    act(() => {
      renderer?.unmount();
    });
  });
});
