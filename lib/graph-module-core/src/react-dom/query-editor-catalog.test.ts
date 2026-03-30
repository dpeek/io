import { describe, expect, it } from "bun:test";

import {
  createQueryEditorCatalogFromRegistry,
  type QueryEditorInstalledSurfaceRegistry,
} from "./query-editor-catalog.js";

describe("query editor catalog adapter", () => {
  it("maps installed surface metadata into the shared query-editor catalog", () => {
    const registry = {
      surfaces: [
        {
          catalogId: "workflow:query-surfaces",
          catalogVersion: "query-catalog:workflow:v1",
          defaultPageSize: 25,
          filters: [
            {
              fieldId: "projectId",
              kind: "entity-ref",
              label: "Project",
              operators: ["eq", "neq", "in"],
              options: [{ label: "IO", value: "workflow-project:io" }],
            },
            {
              fieldId: "state",
              kind: "enum",
              label: "State",
              operators: ["eq", "neq", "in"],
              options: [{ label: "Active", value: "active" }],
            },
          ],
          label: "Workflow Branch Board",
          moduleId: "workflow",
          ordering: [{ directions: ["asc", "desc"], fieldId: "updatedAt", label: "Updated" }],
          queryKind: "collection",
          source: {
            kind: "projection",
            projectionId: "workflow:project-branch-board",
          },
          surfaceId: "workflow:project-branch-board",
          surfaceVersion: "query-surface:workflow:project-branch-board:v1",
        },
      ],
    } as const satisfies QueryEditorInstalledSurfaceRegistry;

    const catalog = createQueryEditorCatalogFromRegistry(registry);

    expect(catalog.surfaces).toEqual([
      expect.objectContaining({
        catalogId: "workflow:query-surfaces",
        catalogVersion: "query-catalog:workflow:v1",
        defaultPageSize: 25,
        label: "Workflow Branch Board",
        moduleId: "workflow",
        queryKind: "collection",
        sortFields: [{ directions: ["asc", "desc"], fieldId: "updatedAt", label: "Updated" }],
        sourceKind: "projection",
        surfaceId: "workflow:project-branch-board",
        surfaceVersion: "query-surface:workflow:project-branch-board:v1",
      }),
    ]);
    expect(catalog.surfaces[0]?.fields).toEqual([
      expect.objectContaining({
        control: "entity-ref",
        fieldId: "projectId",
        kind: "entity-ref",
      }),
      expect.objectContaining({
        control: "enum",
        fieldId: "state",
        kind: "enum",
      }),
    ]);
  });

  it("projects richer field kinds into the current query-editor control families", () => {
    const registry = {
      surfaces: [
        {
          catalogId: "workflow:query-surfaces:rich",
          catalogVersion: "query-catalog:workflow:v1",
          filters: [
            {
              fieldId: "homepage",
              kind: "url",
              label: "Homepage",
              operators: ["eq", "contains"],
            },
            {
              fieldId: "cycleTime",
              kind: "duration",
              label: "Cycle Time",
              operators: ["eq", "gt"],
            },
            {
              fieldId: "completionPercent",
              kind: "percent",
              label: "Completion",
              operators: ["gte", "lte", "in"],
            },
          ],
          label: "Rich Workflow Board",
          moduleId: "workflow",
          queryKind: "collection",
          source: {
            kind: "projection",
            projectionId: "workflow:rich-branch-board",
          },
          surfaceId: "workflow:rich-branch-board",
          surfaceVersion: "query-surface:workflow:rich-branch-board:v1",
        },
      ],
    } as const satisfies QueryEditorInstalledSurfaceRegistry;

    const surface = createQueryEditorCatalogFromRegistry(registry).surfaces[0];

    expect(surface?.fields).toEqual([
      expect.objectContaining({
        control: "text",
        fieldId: "homepage",
        kind: "url",
      }),
      expect.objectContaining({
        control: "text",
        fieldId: "cycleTime",
        kind: "duration",
      }),
      expect.objectContaining({
        control: "number",
        fieldId: "completionPercent",
        kind: "percent",
      }),
    ]);
  });

  it("keeps list-valued field families explicit instead of coercing them away", () => {
    const registry = {
      surfaces: [
        {
          catalogId: "workflow:query-surfaces:list",
          catalogVersion: "query-catalog:workflow:v1",
          filters: [
            {
              fieldId: "reviewers",
              kind: "entity-ref-list",
              label: "Reviewers",
              operators: ["exists"],
              options: [{ label: "Avery", value: "person:avery" }],
            },
            {
              fieldId: "durationHistory",
              kind: "duration-list",
              label: "Duration History",
              operators: ["exists"],
            },
          ],
          label: "List Workflow Board",
          moduleId: "workflow",
          queryKind: "collection",
          source: {
            kind: "projection",
            projectionId: "workflow:list-board",
          },
          surfaceId: "workflow:list-board",
          surfaceVersion: "query-surface:workflow:list-board:v1",
        },
      ],
    } as const satisfies QueryEditorInstalledSurfaceRegistry;

    const surface = createQueryEditorCatalogFromRegistry(registry).surfaces[0];

    expect(surface?.fields).toEqual([
      expect.objectContaining({
        control: "entity-ref",
        fieldId: "reviewers",
        kind: "entity-ref-list",
      }),
      expect.objectContaining({
        control: "text",
        fieldId: "durationHistory",
        kind: "duration-list",
      }),
    ]);
  });
});
