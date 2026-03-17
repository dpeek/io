import { describe, expect, it } from "bun:test";

import {
  probeContractItem,
  probeContractObjectView,
  probeContractWorkflow,
  probeSaveContractItemCommand,
} from "./graph/contracts.probe.js";

type GraphPackageJson = {
  exports: Record<string, string>;
};

describe("@io/core/graph adapter entry surfaces", () => {
  it("declares the reserved adapter subpath exports", async () => {
    const packageJson = (await Bun.file(
      new URL("../../package.json", import.meta.url),
    ).json()) as GraphPackageJson;

    expect(packageJson.exports).toMatchObject({
      "./graph": "./src/graph/index.ts",
      "./graph/react": "./src/graph/react/index.ts",
      "./graph/react-dom": "./src/graph/react-dom/index.ts",
      "./graph/react-opentui": "./src/graph/react-opentui/index.ts",
      "./graph/schema": "./src/graph/schema/index.ts",
      "./graph/schema/app": "./src/graph/schema/app.ts",
      "./graph/schema/app/env-vars": "./src/graph/schema/app/env-vars/index.ts",
      "./graph/schema/core": "./src/graph/schema/core.ts",
    });
    expect(packageJson.exports["./graph/schema/*"]).toBeUndefined();
    expect(packageJson.exports["./graph/taxonomy/*"]).toBeUndefined();
  });

  it("exports the host-neutral React adapter while keeping host widgets on later subpaths", async () => {
    const [reactExports, reactDomExports, reactOpentuiExports] = await Promise.all([
      import("./react/index.js"),
      import("./react-dom/index.js"),
      import("./react-opentui/index.js"),
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
    expect(Object.keys(reactOpentuiExports)).toEqual([]);
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
