import { describe, expect, it } from "bun:test";

import { createBootstrappedSnapshot } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { createGraphStore } from "@io/graph-kernel";
import { core, coreBuiltInQuerySurfaceIds, coreGraphBootstrapOptions } from "@io/graph-module-core";

import { createInstalledQueryEditorCatalog } from "../components/query-editor.js";
import {
  builtInQueryRendererRegistry,
  createQueryRendererCapabilityMap,
} from "../components/query-renderers.js";
import { createQueryEditorDraft } from "./query-editor.js";
import { getInstalledModuleQuerySurfaceRendererCompatibility } from "./query-surface-registry.js";
import {
  createGraphBackedSavedQueryRepository,
  createSavedQueryRecordSourceResolver,
  createSavedQueryDefinitionInputFromDraft,
  createSavedViewDefinitionInput,
  deriveSavedQueryRecord,
  resolveSavedQueryDefinition,
  resolveSavedViewDefinition,
  validateSavedQueryCompatibility,
} from "./saved-query.js";

function createGraphBackedRepository(ownerId: string) {
  const store = createGraphStore(createBootstrappedSnapshot(core, coreGraphBootstrapOptions));
  const graph = createGraphClient(store, core);
  return {
    graph,
    repository: createGraphBackedSavedQueryRepository(graph, ownerId),
  };
}

function requireSurfaceCompatibility(surfaceId: string) {
  const surface = getInstalledModuleQuerySurfaceRendererCompatibility(surfaceId);
  if (!surface) {
    throw new Error(`Expected installed surface compatibility for "${surfaceId}".`);
  }
  return surface;
}

describe("saved query repository", () => {
  it("cruds owner-scoped graph-backed saved queries and views", async () => {
    const catalog = createInstalledQueryEditorCatalog();
    const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);
    const ownerId = "principal:owner";
    const otherOwnerId = "principal:other";
    const { graph, repository } = createGraphBackedRepository(ownerId);
    const otherRepository = createGraphBackedSavedQueryRepository(graph, otherOwnerId);
    const draft = createQueryEditorDraft(catalog);

    const query = await repository.saveSavedQuery(
      createSavedQueryDefinitionInputFromDraft({
        catalog,
        draft,
        name: "Owner board",
        ownerId,
      }),
    );
    const view = await repository.saveSavedView(
      createSavedViewDefinitionInput({
        name: "Owner board view",
        ownerId,
        queryId: query.id,
        rendererCapabilities,
        spec: {
          containerId: "saved-view-preview",
          pagination: {
            mode: "paged",
            pageSize: 25,
          },
          refresh: {
            mode: "manual",
          },
          renderer: {
            rendererId: "core:list",
          },
        },
        surface: getInstalledModuleQuerySurfaceRendererCompatibility(
          "workflow:project-branch-board",
        )!,
      }),
    );
    const otherQuery = await otherRepository.saveSavedQuery(
      createSavedQueryDefinitionInputFromDraft({
        catalog,
        draft,
        name: "Other board",
        ownerId: otherOwnerId,
      }),
    );

    expect((await repository.listSavedQueries()).map((entry) => entry.id)).toEqual([query.id]);
    expect((await repository.listSavedViews()).map((entry) => entry.id)).toEqual([view.id]);
    expect((await otherRepository.listSavedQueries()).map((entry) => entry.id)).toEqual([
      otherQuery.id,
    ]);

    await repository.deleteSavedQuery(query.id);

    expect(await repository.getSavedQuery(query.id)).toBeUndefined();
    expect(await repository.getSavedView(view.id)).toBeUndefined();
    expect(await otherRepository.getSavedQuery(otherQuery.id)).toMatchObject({
      id: otherQuery.id,
    });
  });

  for (const testCase of [
    {
      catalogId: "workflow:query-surfaces",
      defaultParamValue: "active",
      overrideParamValue: "ready",
      resolvedViewParamValue: "blocked",
      surface: requireSurfaceCompatibility("workflow:project-branch-board"),
      surfaceId: "workflow:project-branch-board",
      draft: (catalog: ReturnType<typeof createInstalledQueryEditorCatalog>) => ({
        ...createQueryEditorDraft(catalog, "workflow:project-branch-board"),
        filters: [
          {
            fieldId: "state",
            id: "filter:state",
            operator: "eq" as const,
            value: { kind: "param" as const, name: "state" },
          },
        ],
        parameters: [
          {
            defaultValue: "active",
            id: "param:state",
            label: "State",
            name: "state",
            required: false,
            type: "enum" as const,
          },
        ],
      }),
      resolvedParamName: "state",
    },
    {
      catalogId: "core:query-surfaces",
      defaultParamValue: "core",
      overrideParamValue: "workflow",
      resolvedViewParamValue: "core",
      surface: requireSurfaceCompatibility(coreBuiltInQuerySurfaceIds.savedQueryLibrary),
      surfaceId: coreBuiltInQuerySurfaceIds.savedQueryLibrary,
      draft: (catalog: ReturnType<typeof createInstalledQueryEditorCatalog>) => ({
        ...createQueryEditorDraft(catalog, coreBuiltInQuerySurfaceIds.savedQueryLibrary),
        filters: [
          {
            fieldId: "surfaceModuleId",
            id: "filter:surface-module-id",
            operator: "eq" as const,
            value: { kind: "param" as const, name: "surface-module-id" },
          },
        ],
        parameters: [
          {
            defaultValue: "core",
            id: "param:surface-module-id",
            label: "Surface Module",
            name: "surface-module-id",
            required: false,
            type: "string" as const,
          },
        ],
      }),
      resolvedParamName: "surface-module-id",
    },
  ]) {
    it(`resolves graph-backed saved queries and views from graph-native definitions for ${testCase.surfaceId}`, async () => {
      const catalog = createInstalledQueryEditorCatalog();
      const ownerId = "principal:owner";
      const { repository } = createGraphBackedRepository(ownerId);
      const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);
      const draft = testCase.draft(catalog);

      const query = await repository.saveSavedQuery(
        createSavedQueryDefinitionInputFromDraft({
          catalog,
          draft,
          name: "Owner board",
          ownerId,
        }),
      );
      const view = await repository.saveSavedView(
        createSavedViewDefinitionInput({
          name: "Owner board view",
          ownerId,
          queryId: query.id,
          rendererCapabilities,
          spec: {
            containerId: "saved-view-preview",
            pagination: {
              mode: "paged",
              pageSize: 25,
            },
            refresh: {
              mode: "manual",
            },
            renderer: {
              rendererId: "core:list",
            },
          },
          surface: testCase.surface,
        }),
      );
      const sourceResolver = createSavedQueryRecordSourceResolver(
        {
          getSavedQuery(id) {
            return repository.getSavedQuery(id).then((saved) => {
              return saved ? deriveSavedQueryRecord(saved) : undefined;
            });
          },
        },
        { catalog },
      );

      const resolvedQuery = await resolveSavedQueryDefinition({
        catalog,
        executionContext: {
          policyFilterVersion: "policy:7",
          principalId: ownerId,
        },
        params: { [testCase.resolvedParamName]: testCase.overrideParamValue },
        query,
      });
      const resolvedView = await resolveSavedViewDefinition({
        catalog,
        executionContext: {
          policyFilterVersion: "policy:7",
          principalId: ownerId,
        },
        params: { [testCase.resolvedParamName]: testCase.resolvedViewParamValue },
        query,
        rendererCapabilities,
        resolveSurfaceCompatibility: getInstalledModuleQuerySurfaceRendererCompatibility,
        view,
      });
      const resolvedSource = await sourceResolver(
        {
          kind: "saved",
          params: { [testCase.resolvedParamName]: testCase.resolvedViewParamValue },
          queryId: query.id,
        },
        {},
      );

      expect(deriveSavedQueryRecord(query).catalogId).toBe(testCase.catalogId);
      expect(resolvedQuery.request.params?.[testCase.resolvedParamName]).toBe(
        testCase.overrideParamValue,
      );
      expect(resolvedQuery.normalizedRequest.params[0]).toMatchObject({
        name: testCase.resolvedParamName,
        value: testCase.overrideParamValue,
      });
      expect(resolvedView.request.params?.[testCase.resolvedParamName]).toBe(
        testCase.resolvedViewParamValue,
      );
      expect(resolvedView.view.containerId).toBe("saved-view-preview");
      expect(
        "request" in resolvedSource
          ? resolvedSource.request.params?.[testCase.resolvedParamName]
          : undefined,
      ).toBe(testCase.resolvedViewParamValue);
      expect(query.surface?.surfaceId).toBe(testCase.surfaceId);
      expect(query.request.query.kind).toBe("collection");
      expect(query.request.params?.[testCase.resolvedParamName]).toBe(testCase.defaultParamValue);
    });
  }

  it("validates workflow and core saved queries through one shared catalog and source resolver", async () => {
    const catalog = createInstalledQueryEditorCatalog();
    const ownerId = "principal:owner";
    const { repository } = createGraphBackedRepository(ownerId);

    const workflowQuery = await repository.saveSavedQuery(
      createSavedQueryDefinitionInputFromDraft({
        catalog,
        draft: {
          ...createQueryEditorDraft(catalog, "workflow:project-branch-board"),
          filters: [
            {
              fieldId: "state",
              id: "filter:state",
              operator: "eq",
              value: { kind: "param", name: "state" },
            },
          ],
          parameters: [
            {
              defaultValue: "active",
              id: "param:state",
              label: "State",
              name: "state",
              required: false,
              type: "enum",
            },
          ],
        },
        name: "Workflow board",
        ownerId,
      }),
    );
    const coreQuery = await repository.saveSavedQuery(
      createSavedQueryDefinitionInputFromDraft({
        catalog,
        draft: {
          ...createQueryEditorDraft(catalog, coreBuiltInQuerySurfaceIds.savedQueryLibrary),
          filters: [
            {
              fieldId: "surfaceModuleId",
              id: "filter:surface-module-id",
              operator: "eq",
              value: { kind: "param", name: "surface-module-id" },
            },
          ],
          parameters: [
            {
              defaultValue: "core",
              id: "param:surface-module-id",
              label: "Surface Module",
              name: "surface-module-id",
              required: false,
              type: "string",
            },
          ],
        },
        name: "Saved query library",
        ownerId,
      }),
    );
    const sourceResolver = createSavedQueryRecordSourceResolver(
      {
        getSavedQuery(id) {
          return repository.getSavedQuery(id).then((saved) => {
            return saved ? deriveSavedQueryRecord(saved) : undefined;
          });
        },
      },
      { catalog },
    );

    for (const testCase of [
      {
        catalogId: "workflow:query-surfaces",
        params: { state: "ready" },
        query: workflowQuery,
        resolvedParamName: "state",
        surfaceId: "workflow:project-branch-board",
      },
      {
        catalogId: "core:query-surfaces",
        params: { "surface-module-id": "workflow" },
        query: coreQuery,
        resolvedParamName: "surface-module-id",
        surfaceId: coreBuiltInQuerySurfaceIds.savedQueryLibrary,
      },
    ] as const) {
      const saved = deriveSavedQueryRecord(testCase.query);
      const compatibility = validateSavedQueryCompatibility(saved, catalog);
      const resolved = await resolveSavedQueryDefinition({
        catalog,
        executionContext: {
          policyFilterVersion: "policy:7",
          principalId: ownerId,
        },
        params: testCase.params,
        query: testCase.query,
      });
      const resolvedSource = await sourceResolver(
        {
          kind: "saved",
          params: testCase.params,
          queryId: testCase.query.id,
        },
        {},
      );

      expect(saved.catalogId).toBe(testCase.catalogId);
      expect(compatibility).toMatchObject({
        ok: true,
        surface: {
          surfaceId: testCase.surfaceId,
        },
      });
      expect(resolved.surface.surfaceId).toBe(testCase.surfaceId);
      expect(resolved.request.params?.[testCase.resolvedParamName]).toBe(
        testCase.params[testCase.resolvedParamName],
      );
      expect(
        "request" in resolvedSource
          ? resolvedSource.request.params?.[testCase.resolvedParamName]
          : undefined,
      ).toBe(testCase.params[testCase.resolvedParamName]);
    }
  });

  it("reports removed saved-query surfaces explicitly against the installed multi-module catalog", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const input = createSavedQueryDefinitionInputFromDraft({
      catalog,
      draft: createQueryEditorDraft(catalog, "workflow:project-branch-board"),
      name: "Stale board",
    });
    const surface = input.surface;
    if (!surface) {
      throw new Error("Expected saved query draft to include installed surface metadata.");
    }

    expect(
      validateSavedQueryCompatibility(
        {
          catalogId: surface.catalogId,
          catalogVersion: surface.catalogVersion,
          id: "saved-query:stale-surface",
          name: "Stale board",
          parameterDefinitions: [],
          request: {
            query: {
              indexId: "workflow:missing-surface",
              kind: "collection",
              window: {
                limit: 25,
              },
            },
            version: input.request.version,
          },
          surfaceId: "workflow:missing-surface",
          surfaceVersion: "query-surface:workflow:missing-surface:v1",
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
        catalog,
      ),
    ).toEqual({
      code: "stale-query",
      message:
        'Saved query "saved-query:stale-surface" references removed query surface "workflow:missing-surface".',
      ok: false,
    });
  });

  it("fails closed when graph-backed saved-query definitions drift from the installed catalog", async () => {
    const catalog = createInstalledQueryEditorCatalog();
    const ownerId = "principal:owner";
    const { repository } = createGraphBackedRepository(ownerId);
    const draft = createQueryEditorDraft(catalog);

    const staleQuery = await repository.saveSavedQuery({
      ...createSavedQueryDefinitionInputFromDraft({
        catalog,
        draft,
        name: "Stale board",
        ownerId,
      }),
      surface: {
        ...createSavedQueryDefinitionInputFromDraft({
          catalog,
          draft,
          name: "Stale board",
          ownerId,
        }).surface!,
        catalogVersion: "query-catalog:workflow:v0",
      },
    });

    await expect(
      resolveSavedQueryDefinition({
        catalog,
        query: staleQuery,
      }),
    ).rejects.toMatchObject({
      code: "incompatible-query",
      message: expect.stringContaining("incompatible query catalog"),
    });
  });
});
