import { describe, expect, it } from "bun:test";

import { edgeId, type GraphStore, typeId } from "@io/app/graph";
import { type GraphMutationValidationResult } from "@io/graph-client";
import { defineType } from "@io/graph-module";
import { stringTypeModule } from "@io/graph-module-core";
import type { MutableRefObject } from "react";

import { createDraftController } from "./create-draft-controller.js";
import type { EntityCatalogEntry } from "./model.js";

const draftItemType = defineType({
  values: { key: "test:draftItem", name: "Draft Item" },
  fields: {
    name: stringTypeModule.field({ cardinality: "one" }),
    details: {
      alias: stringTypeModule.field({ cardinality: "one?" }),
    },
    tags: stringTypeModule.field({ cardinality: "many" }),
  },
});

const draftItemTypeId = typeId(draftItemType);
const namePredicateId = edgeId(draftItemType.fields.name);
const tagsPredicateId = edgeId(draftItemType.fields.tags);
const typeById = new Map([
  [draftItemTypeId, draftItemType],
  [typeId(stringTypeModule.type), stringTypeModule.type],
]);

type SinglePredicate = {
  get(): unknown;
  set(value: unknown): void;
  subscribe(listener: () => void): () => void;
  validateSet(value: unknown): GraphMutationValidationResult;
};

type OptionalPredicate = SinglePredicate & {
  clear(): void;
  validateClear(): GraphMutationValidationResult;
};

type ManyPredicate = {
  add(value: unknown): void;
  clear(): void;
  get(): unknown;
  remove(value: unknown): void;
  replace(values: unknown[]): void;
  subscribe(listener: () => void): () => void;
  validateAdd(value: unknown): GraphMutationValidationResult;
};

function okValidation(input: Record<string, unknown>): GraphMutationValidationResult {
  return {
    changedPredicateKeys: [],
    event: "create",
    ok: true,
    phase: "local",
    value: input,
  };
}

function createController(
  validateCreate: (input: Record<string, unknown>) => GraphMutationValidationResult = okValidation,
  initialInput: Record<string, unknown> = {
    details: { alias: "Alias" },
    name: "Draft item",
    tags: ["alpha"],
  },
) {
  const entry: EntityCatalogEntry = {
    count: 0,
    create: () => "entity:test:draft-item",
    getRef: () => {
      throw new Error("Entity refs are not used in this fixture.");
    },
    id: draftItemTypeId,
    ids: [],
    key: draftItemType.values.key,
    name: draftItemType.values.name ?? draftItemType.values.key,
    typeDef: draftItemType,
    validateCreate,
  };

  return createDraftController({
    entry,
    entityEntryByIdRef: {
      current: new Map<string, EntityCatalogEntry>(),
    } as MutableRefObject<ReadonlyMap<string, EntityCatalogEntry>>,
    initialInput,
    store: {
      facts() {
        return [];
      },
    } as GraphStore,
    typeById,
  });
}

describe("explorer create draft controller", () => {
  it("backs predicate refs with the shared edit-session contracts", () => {
    const controller = createController();
    const name = controller.fields.name as SinglePredicate;
    const alias = (controller.fields.details as Record<string, unknown>).alias as OptionalPredicate;
    const tags = controller.fields.tags as ManyPredicate;
    const nameField = controller.session.getField(["name"]);

    expect(controller.session.defaultCommitPolicy).toEqual({ mode: "submit" });
    expect(nameField?.commitPolicy).toEqual({ mode: "submit" });

    let nameUpdates = 0;
    let sessionUpdates = 0;
    const unsubscribeName = name.subscribe(() => {
      nameUpdates += 1;
    });
    const unsubscribeSession = controller.session.subscribe(() => {
      sessionUpdates += 1;
    });

    name.set("Renamed item");
    alias.clear();
    tags.add("beta");

    expect(name.get()).toBe("Renamed item");
    expect(alias.get()).toBe(undefined);
    expect(tags.get()).toEqual(["alpha", "beta"]);
    expect(controller.getInput()).toEqual({
      details: {},
      name: "Renamed item",
      tags: ["alpha", "beta"],
    });
    expect(nameUpdates).toBe(1);
    expect(sessionUpdates).toBe(3);
    expect(nameField?.getSnapshot()).toMatchObject({
      committedValue: "Draft item",
      dirty: true,
      draftValue: "Renamed item",
      touched: false,
    });

    nameField?.setTouched(true);
    expect(nameField?.getSnapshot().touched).toBe(true);
    expect(controller.session.getSnapshot()).toMatchObject({
      dirty: true,
      touched: true,
    });

    expect(controller.session.commit()).toBe(true);
    expect(controller.session.getSnapshot()).toMatchObject({
      committedValue: {
        details: {},
        name: "Renamed item",
        tags: ["alpha", "beta"],
      },
      dirty: false,
      touched: true,
    });
    expect(nameField?.getSnapshot()).toMatchObject({
      committedValue: "Renamed item",
      dirty: false,
      draftValue: "Renamed item",
      touched: true,
    });

    unsubscribeName();
    unsubscribeSession();
  });

  it("supports whole-session replacement and revert through shared field paths", () => {
    const initialInput = {
      details: { alias: "Alias" },
      name: "Draft item",
      tags: ["alpha"],
    };
    const controller = createController(okValidation, initialInput);
    const name = controller.fields.name as SinglePredicate;
    const alias = (controller.fields.details as Record<string, unknown>).alias as OptionalPredicate;
    const tags = controller.fields.tags as ManyPredicate;
    const aliasField = controller.session.getField(["details", "alias"]);

    controller.session.setDraftValue({
      details: { alias: "Changed alias" },
      name: "Changed item",
      tags: ["gamma"],
    });

    expect(name.get()).toBe("Changed item");
    expect(alias.get()).toBe("Changed alias");
    expect(tags.get()).toEqual(["gamma"]);
    expect(aliasField?.getSnapshot()).toMatchObject({
      committedValue: "Alias",
      dirty: true,
      draftValue: "Changed alias",
    });

    expect(controller.session.revert()).toBe(true);
    expect(controller.getInput()).toEqual(initialInput);
    expect(aliasField?.getSnapshot()).toMatchObject({
      committedValue: "Alias",
      dirty: false,
      draftValue: "Alias",
    });
  });

  it("commits and reverts individual field controllers through shared paths", () => {
    const controller = createController();
    const name = controller.fields.name as SinglePredicate;
    const nameField = controller.session.getField(["name"]);

    if (!nameField) throw new Error("Expected name field controller.");

    nameField.setDraftValue("Renamed item");

    expect(name.get()).toBe("Renamed item");
    expect(nameField.getSnapshot()).toMatchObject({
      committedValue: "Draft item",
      dirty: true,
      draftValue: "Renamed item",
    });
    expect(controller.session.getSnapshot()).toMatchObject({
      dirty: true,
    });

    expect(nameField.commit()).toBe(true);
    expect(controller.session.getSnapshot()).toMatchObject({
      committedValue: {
        details: { alias: "Alias" },
        name: "Renamed item",
        tags: ["alpha"],
      },
      dirty: false,
      draftValue: {
        details: { alias: "Alias" },
        name: "Renamed item",
        tags: ["alpha"],
      },
    });

    nameField.setDraftValue("Temporary item");
    expect(nameField.revert()).toBe(true);
    expect(name.get()).toBe("Renamed item");
    expect(controller.getInput()).toEqual({
      details: { alias: "Alias" },
      name: "Renamed item",
      tags: ["alpha"],
    });
  });

  it("keeps validation filtering scoped to the active predicate path", () => {
    const controller = createController((input) => {
      const tags = input.tags;
      if (Array.isArray(tags) && tags.includes("blocked")) {
        return {
          changedPredicateKeys: [tagsPredicateId],
          event: "create",
          issues: [
            {
              code: "field.blocked",
              message: "Blocked tag",
              nodeId: draftItemTypeId,
              path: ["tags"],
              predicateKey: tagsPredicateId,
              source: "field",
            },
          ],
          ok: false,
          phase: "local",
          value: input,
        };
      }

      return {
        changedPredicateKeys: [namePredicateId],
        event: "create",
        issues: [
          {
            code: "field.required",
            message: "Name is required",
            nodeId: draftItemTypeId,
            path: ["name"],
            predicateKey: namePredicateId,
            source: "field",
          },
        ],
        ok: false,
        phase: "local",
        value: input,
      };
    });
    const name = controller.fields.name as SinglePredicate;
    const tags = controller.fields.tags as ManyPredicate;

    expect(name.validateSet("Renamed item")).toMatchObject({
      ok: false,
    });
    expect(tags.validateAdd("blocked")).toMatchObject({
      ok: false,
    });
    expect(tags.validateAdd("allowed")).toMatchObject({
      changedPredicateKeys: [namePredicateId],
      event: "create",
      ok: true,
      phase: "local",
      value: {
        details: { alias: "Alias" },
        name: "Draft item",
        tags: ["alpha", "allowed"],
      },
    });
  });
});
