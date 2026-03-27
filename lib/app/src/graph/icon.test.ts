import { describe, expect, it } from "bun:test";

import { createStore, sanitizeSvgMarkup, typeId } from "@io/app/graph";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient, GraphValidationError } from "@io/graph-client";
import {
  colorTypeModule,
  core,
  coreGraphBootstrapOptions,
  resolveDefinitionIconId,
  stringTypeModule,
} from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";

function createGraph() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, workflow, coreGraphBootstrapOptions);
  return createGraphClient(store, { ...core, ...workflow });
}

const stringIconId = resolveDefinitionIconId(stringTypeModule.type.values.icon);
const colorIconId = resolveDefinitionIconId(colorTypeModule.type.values.icon);

describe("graph icons", () => {
  it("stores sanitized svg markup on create", () => {
    const graph = createGraph();

    const iconId = graph.icon.create({
      key: "spark",
      name: "Spark",
      svg: graph.icon.get(stringIconId).svg,
    });

    const created = graph.icon.get(iconId);
    expect(created.svg).toContain('viewBox="0 0 24 24"');
    expect(created.svg).not.toContain('width="24"');
    expect(created.svg).not.toContain('height="24"');
  });

  it("preserves child shape dimensions while stripping root svg dimensions", () => {
    const graph = createGraph();
    const result = sanitizeSvgMarkup(graph.icon.get(colorIconId).svg);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected color icon SVG to sanitize.");

    expect(result.svg).toContain('<rect width="16" height="6"');
    expect(result.svg).toContain('<rect width="4" height="6"');
    expect(result.svg).not.toContain('<svg width="24"');
    expect(result.svg).not.toContain('<svg height="24"');
  });

  it("rejects unsafe svg on create and update", () => {
    const graph = createGraph();

    const createResult = graph.icon.validateCreate({
      key: "unsafe",
      name: "Unsafe",
      svg: '<svg viewBox="0 0 24 24"><script /></svg>',
    });

    expect(createResult).toMatchObject({
      ok: false,
      event: "create",
      phase: "local",
    });
    if (createResult.ok) throw new Error("Expected unsafe SVG create validation to fail.");
    expect(createResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "svg.tag.unsupported",
          source: "field",
        }),
      ]),
    );

    const iconId = graph.icon.create({
      key: "safe",
      name: "Safe",
      svg: graph.icon.get(stringIconId).svg,
    });

    const updateResult = graph.icon.validateUpdate(iconId, {
      svg: '<svg viewBox="0 0 24 24"><foreignObject /></svg>',
    });

    expect(updateResult).toMatchObject({
      ok: false,
      event: "update",
      phase: "local",
    });
    if (updateResult.ok) throw new Error("Expected unsafe SVG update validation to fail.");
    expect(updateResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "svg.tag.unsupported",
          source: "field",
        }),
      ]),
    );

    let error: unknown;
    try {
      graph.icon.update(iconId, {
        svg: '<svg viewBox="0 0 24 24"><foreignObject /></svg>',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
  });

  it("blocks icon deletes while inbound references still exist", () => {
    const graph = createGraph();

    const iconId = graph.icon.create({
      key: "planning",
      name: "Planning",
      svg: graph.icon.get(stringIconId).svg,
    });
    const documentTypeId = typeId(workflow.document);
    graph.type.ref(documentTypeId).fields.icon.set(iconId);

    const blockedDelete = graph.icon.validateDelete(iconId);
    expect(blockedDelete).toMatchObject({
      ok: false,
      event: "delete",
      phase: "local",
    });
    if (blockedDelete.ok) throw new Error("Expected icon delete validation to fail.");
    expect(blockedDelete.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "reference.missing",
          nodeId: documentTypeId,
          predicateKey: core.type.fields.icon.key,
          source: "runtime",
        }),
      ]),
    );

    graph.type.ref(documentTypeId).fields.icon.clear();

    const allowedDelete = graph.icon.validateDelete(iconId);
    expect(allowedDelete).toMatchObject({
      ok: true,
      event: "delete",
      phase: "local",
    });

    graph.icon.delete(iconId);
    expect(graph.icon.list().map((icon) => icon.id)).not.toContain(iconId);
  });
});
