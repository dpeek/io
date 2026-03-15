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

describe("@io/graph adapter entry surfaces", () => {
  it("declares the reserved adapter subpath exports", async () => {
    const packageJson = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as GraphPackageJson;

    expect(packageJson.exports).toMatchObject({
      ".": "./src/index.ts",
      "./react": "./src/react/index.ts",
      "./react-dom": "./src/react-dom/index.ts",
      "./react-opentui": "./src/react-opentui/index.ts",
      "./schema": "./src/schema/index.ts",
      "./taxonomy/*": "./src/taxonomy/*.ts",
    });
  });

  it("exports the host-neutral React adapter while keeping host widgets on later subpaths", async () => {
    const [reactExports, reactDomExports, reactOpentuiExports] = await Promise.all([
      import("./react/index.js"),
      import("./react-dom/index.js"),
      import("./react-opentui/index.js"),
    ]);

    expect(Object.keys(reactExports).sort()).toEqual([
      "FilterOperandEditor",
      "GraphMutationRuntimeProvider",
      "PredicateFieldEditor",
      "PredicateFieldView",
      "clearOptionalReference",
      "compileWebFilterQuery",
      "countIssuesByStatus",
      "createWebFieldResolver",
      "createWebFilterResolver",
      "defaultWebFieldResolver",
      "defaultWebFilterResolver",
      "findIssueName",
      "formatPredicateEditorValue",
      "formatPredicateValue",
      "formatWorkspaceMutationError",
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
      "setPredicateValue",
      "useOptionalMutationRuntime",
      "usePersistedMutationCallbacks",
      "usePredicateField",
      "usePredicateValue",
      "useWorkspaceManagementModel",
      "useWorkspaceSync",
      "validatePredicateValue",
    ]);
    expect(Object.keys(reactDomExports).sort()).toEqual([
      "FilterOperandEditor",
      "HostNeutralFilterOperandEditor",
      "PredicateFieldEditor",
      "PredicateFieldView",
      "WorkspaceManagementSurface",
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
