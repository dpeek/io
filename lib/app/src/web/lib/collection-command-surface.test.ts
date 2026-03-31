import { describe, expect, it } from "bun:test";

import type { CollectionSurfaceSpec, GraphCommandSurfaceSpec } from "@io/graph-module";

import {
  resolveCollectionCommandBindings,
  type CollectionCommandSurfaceBinding,
} from "./collection-command-surface.js";

const baseCollection = {
  key: "views:test-collection",
  title: "Test collection",
  source: {
    kind: "query",
    query: "saved-query:test",
  },
  presentation: {
    kind: "table",
  },
  commandSurfaces: [
    "views:test:row",
    "views:test:selection",
    "views:test:missing",
    "views:test:scope",
  ],
} as const satisfies CollectionSurfaceSpec;

function createSurface(surface: GraphCommandSurfaceSpec): CollectionCommandSurfaceBinding {
  return {
    surface,
    execute: () => undefined,
  };
}

describe("collection command surface resolution", () => {
  it("keeps entity and selection commands ordered while surfacing unsupported bindings", () => {
    const rowSurface = {
      key: "views:test:row",
      command: "test:row",
      label: "Row action",
      subject: {
        kind: "entity",
        entity: "workflow:branch",
      },
      inputPresentation: {
        kind: "inline",
      },
      submitBehavior: {
        kind: "blocking",
      },
      postSuccess: [{ kind: "refresh" }],
    } as const satisfies GraphCommandSurfaceSpec;
    const selectionSurface = {
      key: "views:test:selection",
      command: "test:selection",
      label: "Selection action",
      subject: {
        kind: "selection",
        entity: "workflow:branch",
      },
      inputPresentation: {
        kind: "dialog",
      },
      submitBehavior: {
        kind: "confirm",
      },
      postSuccess: [{ kind: "refresh" }],
    } as const satisfies GraphCommandSurfaceSpec;
    const scopeSurface = {
      key: "views:test:scope",
      command: "test:scope",
      label: "Scope action",
      subject: {
        kind: "scope",
        scope: "collection",
      },
      inputPresentation: {
        kind: "sheet",
      },
      submitBehavior: {
        kind: "blocking",
      },
      postSuccess: [{ kind: "refresh" }],
    } as const satisfies GraphCommandSurfaceSpec;

    const result = resolveCollectionCommandBindings(baseCollection, {
      [rowSurface.key]: createSurface(rowSurface),
      [selectionSurface.key]: createSurface(selectionSurface),
      [scopeSurface.key]: createSurface(scopeSurface),
    });

    expect(result.entityCommands.map((command) => command.key)).toEqual([rowSurface.key]);
    expect(result.selectionCommands.map((command) => command.key)).toEqual([selectionSurface.key]);
    expect(result.issues).toEqual([
      {
        code: "binding-missing",
        commandSurfaceKey: "views:test:missing",
        message:
          'Collection surface "views:test-collection" references missing command surface binding "views:test:missing".',
      },
      {
        code: "unsupported-subject-kind",
        commandSurfaceKey: scopeSurface.key,
        message:
          'Collection command surface "views:test:scope" uses unsupported subject kind "scope" for the current proving-ground browser host.',
      },
    ]);
  });
});
