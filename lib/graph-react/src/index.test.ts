import { describe, expect, it } from "bun:test";

import { type PredicateRef, GraphValidationError } from "@io/graph-client";
import {
  defineDefaultEnumTypeModule,
  defineEnum,
  defineType,
  defineValidatedStringTypeModule,
} from "@io/graph-module";

import {
  createGraphFieldResolver,
  createGraphFilterResolver,
  defaultGraphFieldResolver,
  defaultGraphFilterResolver,
  performValidatedMutation,
} from "./index.js";

const probeStatusType = defineEnum({
  values: { key: "probe:status", name: "Status" },
  options: {
    draft: { name: "Draft" },
    published: { name: "Published" },
  },
});

const probeStatusTypeModule = defineDefaultEnumTypeModule(probeStatusType);

const probeTextTypeModule = defineValidatedStringTypeModule({
  values: { key: "probe:text", name: "Text" },
  parse: (raw: string) => raw.trim(),
  filter: {
    defaultOperator: "contains",
    operators: {
      contains: {
        label: "Contains",
        operand: {
          kind: "string",
          placeholder: "Probe item",
        },
        parse: (raw: string) => raw.trim(),
        format: (operand: string) => operand,
        test: (value: string, operand: string) => value.includes(operand),
      },
    },
  },
  placeholder: "Probe item",
});

const item = defineType({
  values: { key: "probe:item", name: "Item" },
  fields: {
    name: probeTextTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Name",
        display: {
          kind: "text",
        },
        editor: {
          kind: "text",
        },
      },
    }),
    status: probeStatusTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Status",
      },
    }),
  },
});

const defs = {
  item,
  status: probeStatusType,
  text: probeTextTypeModule.type,
} as const;

function createNameRef() {
  return {
    itemId: "entity:probe:item",
    nameRef: {
      field: item.fields.name,
    } as unknown as PredicateRef<typeof item.fields.name, typeof defs>,
  };
}

const statusField = item.fields.status;

describe("@io/graph-react", () => {
  it("keeps the default resolver host-neutral until a host provides capabilities", () => {
    const { nameRef } = createNameRef();

    expect(defaultGraphFieldResolver.resolveView(nameRef)).toEqual({
      status: "unsupported",
      reason: "unsupported-display-kind",
      kind: "text",
    });
    expect(defaultGraphFieldResolver.resolveEditor(nameRef)).toEqual({
      status: "unsupported",
      reason: "unsupported-editor-kind",
      kind: "text",
    });
  });

  it("resolves field capabilities once a host supplies them", () => {
    const { nameRef } = createNameRef();
    const resolver = createGraphFieldResolver({
      view: [{ kind: "text", Component: () => null }],
      editor: [{ kind: "text", Component: () => null }],
    });

    const view = resolver.resolveView(nameRef);
    const editor = resolver.resolveEditor(nameRef);

    expect(view.status).toBe("resolved");
    expect(editor.status).toBe("resolved");
  });

  it("keeps the default filter resolver host-neutral until a host provides operand editors", () => {
    const resolution = defaultGraphFilterResolver.resolveField(item.fields.name, defs);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    expect(resolution.resolveOperator("contains")?.operand.editor).toEqual({
      status: "unsupported",
      reason: "unsupported-operand-kind",
      kind: "string",
    });
  });

  it("resolves filter operand editors once a host supplies them", () => {
    const resolution = createGraphFilterResolver({
      operandEditors: [{ kind: "string", Component: () => null }],
    }).resolveField(item.fields.name, defs);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    expect(resolution.resolveOperator("contains")?.operand.editor.status).toBe("resolved");
  });

  it("resolves enum filter metadata once a host provides no operand editors", () => {
    const resolution = defaultGraphFilterResolver.resolveField(statusField, defs);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    const operator = resolution.resolveOperator("is");
    expect(operator?.operand.kind).toBe("enum");
  });

  it("surfaces validation failures through GraphValidationError before mutation", () => {
    const { itemId, nameRef } = createNameRef();
    let reportedError: unknown;
    let mutateCalls = 0;

    const applied = performValidatedMutation(
      {
        onMutationError(error) {
          reportedError = error;
        },
      },
      () => ({
        ok: false,
        phase: "local",
        event: "update",
        value: {},
        changedPredicateKeys: [nameRef.field.key],
        issues: [
          {
            code: "field.required",
            message: "Name is required",
            source: "field",
            path: ["name"],
            predicateKey: nameRef.field.key,
            nodeId: itemId,
          },
        ],
      }),
      () => {
        mutateCalls += 1;
        return true;
      },
    );

    expect(applied).toBe(false);
    expect(mutateCalls).toBe(0);
    expect(reportedError).toBeInstanceOf(GraphValidationError);
    expect((reportedError as GraphValidationError<Record<string, unknown>>).result).toMatchObject({
      ok: false,
      event: "update",
      phase: "local",
    });
  });
});
