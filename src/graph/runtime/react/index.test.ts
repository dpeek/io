import { describe, expect, it } from "bun:test";

import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient, GraphValidationError } from "@io/graph-client";

import { createIdMap, createStore, applyIdMap, defineType } from "../../index.js";
import { core, coreGraphBootstrapOptions } from "../../modules/index.js";
import {
  createWebFieldResolver,
  createWebFilterResolver,
  defaultWebFieldResolver,
  defaultWebFilterResolver,
  performValidatedMutation,
} from "./index.js";

const item = defineType({
  values: { key: "probe:item", name: "Item" },
  fields: {
    ...core.node.fields,
  },
});

const itemNamespace = applyIdMap(createIdMap({ item }).map, { item });
const itemDefinitions = { ...core, ...itemNamespace } as const;

function createNameRef() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, itemNamespace, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, itemNamespace, itemDefinitions);
  const itemId = graph.item.create({ name: "Probe item" });
  return { itemId, nameRef: graph.item.ref(itemId).fields.name };
}

describe("@io/core/graph/runtime/react", () => {
  it("keeps the default resolver host-neutral until a host provides capabilities", () => {
    const { nameRef } = createNameRef();

    expect(defaultWebFieldResolver.resolveView(nameRef)).toEqual({
      status: "unsupported",
      reason: "unsupported-display-kind",
      kind: "text",
    });
    expect(defaultWebFieldResolver.resolveEditor(nameRef)).toEqual({
      status: "unsupported",
      reason: "unsupported-editor-kind",
      kind: "text",
    });
  });

  it("resolves field capabilities once a host supplies them", () => {
    const { nameRef } = createNameRef();
    const resolver = createWebFieldResolver({
      view: [{ kind: "text", Component: () => null }],
      editor: [{ kind: "text", Component: () => null }],
    });

    const view = resolver.resolveView(nameRef);
    const editor = resolver.resolveEditor(nameRef);

    expect(view.status).toBe("resolved");
    expect(editor.status).toBe("resolved");
  });

  it("keeps the default filter resolver host-neutral until a host provides operand editors", () => {
    const resolution = defaultWebFilterResolver.resolveField(core.node.fields.name, core);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    expect(resolution.resolveOperator("contains")?.operand.editor).toEqual({
      status: "unsupported",
      reason: "unsupported-operand-kind",
      kind: "string",
    });
  });

  it("resolves filter operand editors once a host supplies them", () => {
    const resolution = createWebFilterResolver({
      operandEditors: [{ kind: "string", Component: () => null }],
    }).resolveField(core.node.fields.name, core);

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    expect(resolution.resolveOperator("contains")?.operand.editor.status).toBe("resolved");
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
