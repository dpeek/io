import { describe, expect, it } from "bun:test";

import { applyIdMap, createStore } from "@io/app/graph";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { defineType } from "@io/graph-module";
import { core, coreGraphBootstrapOptions, stringTypeModule } from "@io/graph-module-core";

import { buildLiveEntitySurfacePlan } from "./entity-surface-plan.js";

const plannerItem = defineType({
  values: { key: "test:plannerItem", name: "Planner Item" },
  fields: {
    ...core.node.fields,
    details: stringTypeModule.field({ cardinality: "one?" }),
    priority: stringTypeModule.field({ cardinality: "one?" }),
    notes: stringTypeModule.field({ cardinality: "one?" }),
  },
});

const namespace = applyIdMap({}, { plannerItem }, { strict: false });
const definitions = { ...core, ...namespace } as const;

function createPlannerEntity() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, namespace, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, namespace, definitions);
  const entityId = graph.plannerItem.create({
    description: "Surface planning fixture",
    details: "Alpha details",
    name: "Alpha",
    notes: "Planner notes",
    priority: "High",
  });

  return graph.plannerItem.ref(entityId);
}

function summarizePlan(entity: ReturnType<typeof createPlannerEntity>, mode?: "view" | "edit") {
  return buildLiveEntitySurfacePlan(entity, mode ? { mode } : undefined).rows.map((row) => ({
    chrome: row.chrome,
    pathLabel: row.pathLabel,
    role: row.role,
  }));
}

describe("entity surface plan", () => {
  it("applies the default live-entity field policy and preserves authored body order", () => {
    const entity = createPlannerEntity();

    expect(summarizePlan(entity)).toEqual([
      {
        chrome: {
          descriptionVisibility: "hide",
          labelVisibility: "hide",
          validationPlacement: "summary-only",
        },
        pathLabel: "name",
        role: "title",
      },
      {
        chrome: {
          descriptionVisibility: "auto",
          labelVisibility: "auto",
          validationPlacement: "inline",
        },
        pathLabel: "description",
        role: "body",
      },
      {
        chrome: {
          descriptionVisibility: "auto",
          labelVisibility: "auto",
          validationPlacement: "inline",
        },
        pathLabel: "details",
        role: "body",
      },
      {
        chrome: {
          descriptionVisibility: "auto",
          labelVisibility: "auto",
          validationPlacement: "inline",
        },
        pathLabel: "priority",
        role: "body",
      },
      {
        chrome: {
          descriptionVisibility: "auto",
          labelVisibility: "auto",
          validationPlacement: "inline",
        },
        pathLabel: "notes",
        role: "body",
      },
      {
        chrome: {
          descriptionVisibility: "hide",
          labelVisibility: "show",
          validationPlacement: "summary-only",
        },
        pathLabel: "updatedAt",
        role: "meta",
      },
      {
        chrome: {
          descriptionVisibility: "hide",
          labelVisibility: "hide",
          validationPlacement: "summary-only",
        },
        pathLabel: "id",
        role: "hidden",
      },
      {
        chrome: {
          descriptionVisibility: "hide",
          labelVisibility: "hide",
          validationPlacement: "summary-only",
        },
        pathLabel: "type",
        role: "hidden",
      },
      {
        chrome: {
          descriptionVisibility: "hide",
          labelVisibility: "hide",
          validationPlacement: "summary-only",
        },
        pathLabel: "createdAt",
        role: "hidden",
      },
    ]);
  });

  it("keeps name in the normal field body when edit mode is requested", () => {
    const entity = createPlannerEntity();

    expect(summarizePlan(entity, "edit")).toEqual([
      {
        chrome: {
          descriptionVisibility: "auto",
          labelVisibility: "auto",
          validationPlacement: "inline",
        },
        pathLabel: "name",
        role: "body",
      },
      {
        chrome: {
          descriptionVisibility: "auto",
          labelVisibility: "auto",
          validationPlacement: "inline",
        },
        pathLabel: "description",
        role: "body",
      },
      {
        chrome: {
          descriptionVisibility: "auto",
          labelVisibility: "auto",
          validationPlacement: "inline",
        },
        pathLabel: "details",
        role: "body",
      },
      {
        chrome: {
          descriptionVisibility: "auto",
          labelVisibility: "auto",
          validationPlacement: "inline",
        },
        pathLabel: "priority",
        role: "body",
      },
      {
        chrome: {
          descriptionVisibility: "auto",
          labelVisibility: "auto",
          validationPlacement: "inline",
        },
        pathLabel: "notes",
        role: "body",
      },
      {
        chrome: {
          descriptionVisibility: "hide",
          labelVisibility: "show",
          validationPlacement: "summary-only",
        },
        pathLabel: "updatedAt",
        role: "meta",
      },
      {
        chrome: {
          descriptionVisibility: "hide",
          labelVisibility: "hide",
          validationPlacement: "summary-only",
        },
        pathLabel: "id",
        role: "hidden",
      },
      {
        chrome: {
          descriptionVisibility: "hide",
          labelVisibility: "hide",
          validationPlacement: "summary-only",
        },
        pathLabel: "type",
        role: "hidden",
      },
      {
        chrome: {
          descriptionVisibility: "hide",
          labelVisibility: "hide",
          validationPlacement: "summary-only",
        },
        pathLabel: "createdAt",
        role: "hidden",
      },
    ]);
  });
});
