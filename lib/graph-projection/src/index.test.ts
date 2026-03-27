import { describe, expect, it } from "bun:test";

import { createModuleSyncScope, graphSyncScope } from "@io/graph-sync";

import {
  type DependencyKey,
  createDependencyKey,
  createModuleReadScope,
  createModuleReadScopeRequest,
  createProjectionDependencyKey,
  createScopeDependencyKey,
  defineInvalidationEvent,
  defineModuleReadScopeDefinition,
  defineProjectionCatalog,
  defineProjectionSpec,
  findRetainedProjectionRecord,
  isDependencyKey,
  isInvalidationEventCompatibleWithTarget,
  isRetainedProjectionMetadataCompatible,
  matchesModuleReadScope,
  matchesModuleReadScopeRequest,
} from "./index.js";

describe("graph projection contracts", () => {
  it("builds and validates dependency keys from one shared helper", () => {
    expect(createDependencyKey("projection", "workflow:project-branch-board")).toBe(
      "projection:workflow:project-branch-board",
    );
    expect(createProjectionDependencyKey("projection:workflow:branch-commit-queue")).toBe(
      "projection:workflow:branch-commit-queue",
    );
    expect(createScopeDependencyKey("scope:workflow:review")).toBe("scope:workflow:review");
    expect(isDependencyKey("projection:workflow:project-branch-board")).toBe(true);
    expect(isDependencyKey("workflow-review")).toBe(false);
  });

  it("materializes stable requested and delivered module read scopes", () => {
    const definition = defineModuleReadScopeDefinition({
      kind: "module",
      moduleId: "workflow",
      scopeId: "scope:workflow:review",
      definitionHash: "scope-def:workflow:review:v1",
    });

    const requestedScope = createModuleReadScopeRequest(definition);
    const deliveredScope = createModuleReadScope(definition, "policy:0");

    expect(requestedScope).toEqual({
      kind: "module",
      moduleId: "workflow",
      scopeId: "scope:workflow:review",
    });
    expect(deliveredScope).toEqual({
      kind: "module",
      moduleId: "workflow",
      scopeId: "scope:workflow:review",
      definitionHash: "scope-def:workflow:review:v1",
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
          definitionHash: "scope-def:workflow:review:v2",
          policyFilterVersion: "policy:0",
        }),
        definition,
      ),
    ).toBe(false);
  });

  it("validates projection metadata and catalog uniqueness", () => {
    const invalidDependencyKeys = ["workflow-review"] as unknown as readonly DependencyKey[];
    const projectBranchBoard = defineProjectionSpec({
      projectionId: "workflow:project-branch-board",
      kind: "collection-index",
      definitionHash: "projection-def:workflow:project-branch-board:v1",
      sourceScopeKinds: ["module"],
      dependencyKeys: [
        createProjectionDependencyKey("workflow:project-branch-board"),
        createScopeDependencyKey("scope:workflow:review"),
      ],
      rebuildStrategy: "full",
      visibilityMode: "policy-filtered",
    });

    expect(defineProjectionCatalog([projectBranchBoard])).toEqual([projectBranchBoard]);

    expect(() =>
      defineProjectionSpec({
        ...projectBranchBoard,
        dependencyKeys: [
          createProjectionDependencyKey("workflow:project-branch-board"),
          createProjectionDependencyKey("workflow:project-branch-board"),
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
          definitionHash: "projection-def:workflow:project-branch-board:v2",
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
        createScopeDependencyKey("scope:workflow:review"),
        createProjectionDependencyKey("workflow:project-branch-board"),
      ],
      affectedProjectionIds: ["workflow:project-branch-board"],
      affectedScopeIds: ["scope:workflow:review"],
      delivery: { kind: "cursor-advanced" },
    });

    expect(
      isInvalidationEventCompatibleWithTarget(event, {
        dependencyKeys: [createProjectionDependencyKey("workflow:project-branch-board")],
      }),
    ).toBe(true);
    expect(
      isInvalidationEventCompatibleWithTarget(event, {
        scopeId: "scope:workflow:review",
        dependencyKeys: [createProjectionDependencyKey("workflow:branch-commit-queue")],
      }),
    ).toBe(true);
    expect(
      isInvalidationEventCompatibleWithTarget(event, {
        scopeId: "scope:workflow:backlog",
        dependencyKeys: [createProjectionDependencyKey("workflow:branch-commit-queue")],
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
        affectedScopeIds: ["scope:workflow:review"],
        delivery: {
          kind: "scoped-delta",
          scopeId: "scope:workflow:backlog",
          deltaToken: "delta:1",
        },
      }),
    ).toThrow(
      'affectedScopeIds must include delivery.scopeId when delivery.kind is "scoped-delta".',
    );
  });

  it("detects retained projection definitionHash compatibility explicitly", () => {
    const records = [
      {
        projectionId: "workflow:project-branch-board",
        definitionHash: "projection-def:workflow:project-branch-board:v1",
      },
      {
        projectionId: "workflow:branch-commit-queue",
        definitionHash: "projection-def:workflow:branch-commit-queue:v2",
      },
    ] as const;

    expect(
      isRetainedProjectionMetadataCompatible(records[0], {
        projectionId: "workflow:project-branch-board",
        definitionHash: "projection-def:workflow:project-branch-board:v1",
      }),
    ).toBe(true);

    expect(
      findRetainedProjectionRecord(records, {
        projectionId: "workflow:branch-commit-queue",
        definitionHash: "projection-def:workflow:branch-commit-queue:v1",
      }),
    ).toEqual({
      kind: "definition-hash-mismatch",
      projectionId: "workflow:branch-commit-queue",
      expectedDefinitionHash: "projection-def:workflow:branch-commit-queue:v1",
      actualDefinitionHashes: ["projection-def:workflow:branch-commit-queue:v2"],
    });

    expect(
      findRetainedProjectionRecord(records, {
        projectionId: "workflow:missing",
        definitionHash: "projection-def:workflow:missing:v1",
      }),
    ).toEqual({
      kind: "missing",
      projectionId: "workflow:missing",
      expectedDefinitionHash: "projection-def:workflow:missing:v1",
    });
  });
});
