import { describe, expect, it } from "bun:test";

import {
  probeContractItem,
  probeContractObjectView,
  probeContractWorkflow,
  probeSaveContractItemCommand,
} from "./runtime/contracts.probe.js";

type GraphPackageJson = {
  exports: Record<string, string>;
};

describe("@io/core/graph package entry surfaces", () => {
  it("declares canonical module, adapter, and compatibility subpath exports", async () => {
    const packageJson = (await Bun.file(
      new URL("../../package.json", import.meta.url),
    ).json()) as GraphPackageJson;

    expect(packageJson.exports).toMatchObject({
      "./graph": "./src/graph/index.ts",
      "./graph/runtime": "./src/graph/runtime/index.ts",
      "./graph/authority": "./src/graph/runtime/authority.ts",
      "./graph/def": "./src/graph/runtime/def.ts",
      "./graph/modules": "./src/graph/modules/index.ts",
      "./graph/modules/app": "./src/graph/modules/app.ts",
      "./graph/modules/app/env-vars": "./src/graph/modules/app/env-vars/index.ts",
      "./graph/modules/app/topic": "./src/graph/modules/app/topic/index.ts",
      "./graph/modules/core": "./src/graph/modules/core.ts",
      "./graph/react": "./src/graph/react/index.ts",
      "./graph/react-dom": "./src/graph/react-dom/index.ts",
      "./graph/react-opentui": "./src/graph/react-opentui/index.ts",
      "./graph/adapters/react": "./src/graph/adapters/react/index.ts",
      "./graph/adapters/react-dom": "./src/graph/adapters/react-dom/index.ts",
      "./graph/adapters/react-opentui": "./src/graph/adapters/react-opentui/index.ts",
      "./graph/schema": "./src/graph/schema/index.ts",
      "./graph/schema/app": "./src/graph/schema/app.ts",
      "./graph/schema/app/env-vars": "./src/graph/schema/app/env-vars/index.ts",
      "./graph/schema/app/topic": "./src/graph/schema/app/topic/index.ts",
      "./graph/schema/core": "./src/graph/schema/core.ts",
    });
    expect(packageJson.exports["./graph/modules/*"]).toBeUndefined();
    expect(packageJson.exports["./graph/adapters/*"]).toBeUndefined();
    expect(packageJson.exports["./graph/schema/*"]).toBeUndefined();
    expect(packageJson.exports["./graph/taxonomy/*"]).toBeUndefined();
  });

  it("keeps canonical adapter exports aligned with the stable adapter shims", async () => {
    const [
      reactExports,
      reactAdapterExports,
      reactDomExports,
      reactDomAdapterExports,
      reactOpentuiExports,
      reactOpentuiAdapterExports,
    ] = await Promise.all([
      import("./react/index.js"),
      import("./adapters/react/index.js"),
      import("./react-dom/index.js"),
      import("./adapters/react-dom/index.js"),
      import("./react-opentui/index.js"),
      import("./adapters/react-opentui/index.js"),
    ]);

    expect(Object.keys(reactExports).sort()).toEqual([
      "EntityPredicates",
      "FilterOperandEditor",
      "GraphMutationRuntimeProvider",
      "PredicateFieldEditor",
      "PredicateFieldView",
      "PredicateRelatedEntities",
      "compileWebFilterQuery",
      "createWebFieldResolver",
      "createWebFilterResolver",
      "defaultWebFieldResolver",
      "defaultWebFilterResolver",
      "formatPredicateEditorValue",
      "formatPredicateValue",
      "getPredicateCollectionKind",
      "getPredicateDisplayKind",
      "getPredicateEditorAutocomplete",
      "getPredicateEditorInputMode",
      "getPredicateEditorInputType",
      "getPredicateEditorKind",
      "getPredicateEditorParser",
      "getPredicateEditorPlaceholder",
      "getPredicateEntityReferenceOptions",
      "getPredicateEntityReferencePolicy",
      "getPredicateEntityReferenceSelection",
      "getPredicateEnumOptions",
      "getPredicateFieldMeta",
      "lowerWebFilterClause",
      "lowerWebFilterQuery",
      "performValidatedMutation",
      "persistSyncedGraphChanges",
      "useEntityPredicateEntries",
      "useOptionalMutationRuntime",
      "usePersistedMutationCallbacks",
      "usePredicateField",
      "usePredicateRelatedEntities",
      "usePredicateValue",
    ]);
    expect(Object.keys(reactAdapterExports).sort()).toEqual(Object.keys(reactExports).sort());
    expect(reactAdapterExports.createWebFieldResolver).toBe(reactExports.createWebFieldResolver);
    expect(reactAdapterExports.usePredicateField).toBe(reactExports.usePredicateField);
    expect(Object.keys(reactDomExports).sort()).toEqual([
      "FilterOperandEditor",
      "GraphIcon",
      "HostNeutralFilterOperandEditor",
      "PredicateFieldEditor",
      "PredicateFieldView",
      "SvgMarkup",
      "compileWebFilterQuery",
      "createWebFieldResolver",
      "createWebFilterResolver",
      "defaultHostNeutralWebFilterResolver",
      "defaultWebFieldResolver",
      "defaultWebFilterResolver",
      "genericWebFieldEditorCapabilities",
      "genericWebFieldViewCapabilities",
      "genericWebFilterOperandEditorCapabilities",
      "lowerWebFilterClause",
      "lowerWebFilterQuery",
    ]);
    expect(Object.keys(reactDomAdapterExports).sort()).toEqual(Object.keys(reactDomExports).sort());
    expect(reactDomAdapterExports.GraphIcon).toBe(reactDomExports.GraphIcon);
    expect(reactDomAdapterExports.PredicateFieldEditor).toBe(reactDomExports.PredicateFieldEditor);
    expect(Object.keys(reactOpentuiExports)).toEqual([]);
    expect(Object.keys(reactOpentuiAdapterExports)).toEqual([]);
  });

  it("supports root-safe contract authoring from the package root without exposing host widgets", async () => {
    const rootExports = await import("./index.js");

    expect(rootExports).toMatchObject({
      core: expect.any(Object),
      createIdMap: expect.any(Function),
      defineNamespace: expect.any(Function),
      defineReferenceField: expect.any(Function),
      defineType: expect.any(Function),
      existingEntityReferenceField: expect.any(Function),
      existingEntityReferenceFieldMeta: expect.any(Function),
      stringTypeModule: expect.any(Object),
    });
    expect(Object.keys(rootExports)).not.toContain("FilterOperandEditor");
    expect(Object.keys(rootExports)).not.toContain("PredicateFieldView");

    expect(probeContractItem.kind).toBe("entity");
    expect(probeContractObjectView.entity).toBe(probeContractItem.values.key);
    expect(probeContractObjectView.commands).toEqual([probeSaveContractItemCommand.key]);
    expect(probeContractWorkflow.subjects).toEqual([probeContractItem.values.key]);
    expect(probeContractWorkflow.steps).toEqual([
      {
        key: "review",
        title: "Review details",
        objectView: probeContractObjectView.key,
      },
      {
        key: "save",
        title: "Save item",
        command: probeSaveContractItemCommand.key,
      },
    ]);
    expect(probeSaveContractItemCommand).toMatchObject({
      subject: probeContractItem.values.key,
      execution: "optimisticVerify",
      policy: {
        capabilities: ["probe.contract.write"],
        touchesPredicates: [
          probeContractItem.fields.name.key,
          probeContractItem.fields.summary.key,
        ],
      },
    });
  });
});
