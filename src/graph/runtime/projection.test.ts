import { describe, expect, it } from "bun:test";

import {
  type DependencyKey,
  createDependencyKey,
  createModuleReadScope,
  createModuleReadScopeRequest,
  createProjectionDependencyKey,
  createScopeDependencyKey,
  defineModuleReadScopeDefinition,
  defineInvalidationEvent,
  defineProjectionCatalog,
  defineProjectionSpec,
  isDependencyKey,
  isInvalidationEventCompatibleWithTarget,
  matchesModuleReadScope,
  matchesModuleReadScopeRequest,
} from "./projection.js";
import { createModuleSyncScope, graphSyncScope } from "./sync/index.js";

describe("projection runtime contracts", () => {
  it("builds and validates dependency keys from one shared helper", () => {
    expect(createDependencyKey("projection", "ops/workflow:project-branch-board")).toBe(
      "projection:ops/workflow:project-branch-board",
    );
    expect(createProjectionDependencyKey("projection:ops/workflow:branch-commit-queue")).toBe(
      "projection:ops/workflow:branch-commit-queue",
    );
    expect(createScopeDependencyKey("scope:ops/workflow:review")).toBe("scope:ops/workflow:review");
    expect(isDependencyKey("projection:ops/workflow:project-branch-board")).toBe(true);
    expect(isDependencyKey("workflow-review")).toBe(false);
  });

  it("materializes stable requested and delivered module read scopes", () => {
    const definition = defineModuleReadScopeDefinition({
      kind: "module",
      moduleId: "ops/workflow",
      scopeId: "scope:ops/workflow:review",
      definitionHash: "scope-def:ops/workflow:review:v1",
    });

    const requestedScope = createModuleReadScopeRequest(definition);
    const deliveredScope = createModuleReadScope(definition, "policy:0");

    expect(requestedScope).toEqual({
      kind: "module",
      moduleId: "ops/workflow",
      scopeId: "scope:ops/workflow:review",
    });
    expect(deliveredScope).toEqual({
      kind: "module",
      moduleId: "ops/workflow",
      scopeId: "scope:ops/workflow:review",
      definitionHash: "scope-def:ops/workflow:review:v1",
      policyFilterVersion: "policy:0",
    });
    expect(matchesModuleReadScopeRequest(requestedScope, definition)).toBe(true);
    expect(matchesModuleReadScopeRequest(deliveredScope, definition)).toBe(true);
    expect(matchesModuleReadScopeRequest(graphSyncScope, definition)).toBe(false);
    expect(matchesModuleReadScope(deliveredScope, definition)).toBe(true);
    expect(
      matchesModuleReadScope(
        createModuleSyncScope({
          moduleId: definition.moduleId,
          scopeId: definition.scopeId,
          definitionHash: "scope-def:ops/workflow:review:v2",
          policyFilterVersion: "policy:0",
        }),
        definition,
      ),
    ).toBe(false);
  });

  it("validates projection metadata and catalog uniqueness", () => {
    const invalidDependencyKeys = ["workflow-review"] as unknown as readonly DependencyKey[];
    const projectBranchBoard = defineProjectionSpec({
      projectionId: "ops/workflow:project-branch-board",
      kind: "collection-index",
      definitionHash: "projection-def:ops/workflow:project-branch-board:v1",
      sourceScopeKinds: ["module"],
      dependencyKeys: [
        createProjectionDependencyKey("ops/workflow:project-branch-board"),
        createScopeDependencyKey("scope:ops/workflow:review"),
      ],
      rebuildStrategy: "full",
      visibilityMode: "policy-filtered",
    });

    expect(defineProjectionCatalog([projectBranchBoard])).toEqual([projectBranchBoard]);

    expect(() =>
      defineProjectionSpec({
        ...projectBranchBoard,
        dependencyKeys: [
          createProjectionDependencyKey("ops/workflow:project-branch-board"),
          createProjectionDependencyKey("ops/workflow:project-branch-board"),
        ],
      }),
    ).toThrow("dependencyKeys must not contain duplicate values.");

    expect(() =>
      defineProjectionSpec({
        ...projectBranchBoard,
        dependencyKeys: invalidDependencyKeys,
      }),
    ).toThrow(
      "dependencyKeys must use a supported dependency key prefix followed by a non-empty value.",
    );

    expect(() =>
      defineProjectionCatalog([
        projectBranchBoard,
        defineProjectionSpec({
          ...projectBranchBoard,
          definitionHash: "projection-def:ops/workflow:project-branch-board:v2",
        }),
      ]),
    ).toThrow("projectionId must not contain duplicate values.");
  });

  it("defines invalidation events and matches them against router targets", () => {
    const invalidDependencyKeys = ["workflow-review"] as unknown as readonly DependencyKey[];
    const event = defineInvalidationEvent({
      eventId: "evt:workflow-1",
      graphId: "graph:global",
      sourceCursor: "cursor:1",
      dependencyKeys: [
        createScopeDependencyKey("scope:ops/workflow:review"),
        createProjectionDependencyKey("ops/workflow:project-branch-board"),
      ],
      affectedProjectionIds: ["ops/workflow:project-branch-board"],
      affectedScopeIds: ["scope:ops/workflow:review"],
      delivery: { kind: "cursor-advanced" },
    });

    expect(
      isInvalidationEventCompatibleWithTarget(event, {
        dependencyKeys: [createProjectionDependencyKey("ops/workflow:project-branch-board")],
      }),
    ).toBe(true);
    expect(
      isInvalidationEventCompatibleWithTarget(event, {
        scopeId: "scope:ops/workflow:review",
        dependencyKeys: [createProjectionDependencyKey("ops/workflow:branch-commit-queue")],
      }),
    ).toBe(true);
    expect(
      isInvalidationEventCompatibleWithTarget(event, {
        scopeId: "scope:ops/workflow:backlog",
        dependencyKeys: [createProjectionDependencyKey("ops/workflow:branch-commit-queue")],
      }),
    ).toBe(false);

    expect(() =>
      defineInvalidationEvent({
        ...event,
        dependencyKeys: invalidDependencyKeys,
      }),
    ).toThrow(
      "dependencyKeys must use a supported dependency key prefix followed by a non-empty value.",
    );

    expect(() =>
      defineInvalidationEvent({
        ...event,
        affectedScopeIds: ["scope:ops/workflow:review"],
        delivery: {
          kind: "scoped-delta",
          scopeId: "scope:ops/workflow:backlog",
          deltaToken: "delta:1",
        },
      }),
    ).toThrow(
      'affectedScopeIds must include delivery.scopeId when delivery.kind is "scoped-delta".',
    );
  });
});
