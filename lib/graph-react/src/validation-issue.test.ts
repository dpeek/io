import { describe, expect, it } from "bun:test";

import {
  aggregateValidationIssues,
  cloneValidationIssue,
  collectValidationIssuesForPath,
  collectValidationIssuesForScope,
  createPathValidationIssue,
  createScopedValidationIssue,
  normalizeGraphValidationIssue,
  normalizeGraphValidationIssues,
} from "./index.js";

describe("validation issue helpers", () => {
  it("normalizes graph validation issues into the shared path issue shape", () => {
    const path = ["settings", "name"];
    const normalized = normalizeGraphValidationIssue({
      code: "field.required",
      message: "Name is required",
      path,
      source: "field",
    });
    const normalizedMany = normalizeGraphValidationIssues([
      {
        code: "field.required",
        message: "Name is required",
        path,
        source: "field",
      },
    ]);

    expect(normalized).toEqual({
      code: "field.required",
      kind: "path",
      message: "Name is required",
      path: ["settings", "name"],
      source: "field",
    });
    expect(normalizedMany).toEqual([normalized]);

    const cloned = cloneValidationIssue(normalized);
    path[0] = "changed";

    expect(cloned).toEqual({
      code: "field.required",
      kind: "path",
      message: "Name is required",
      path: ["settings", "name"],
      source: "field",
    });
  });

  it("filters combined validation issues by exact path and scope", () => {
    const issues = [
      createPathValidationIssue({
        code: "field.required",
        message: "Name is required",
        path: ["name"] as const,
        source: "field",
      }),
      createPathValidationIssue({
        message: "Nested form value is invalid",
        path: ["details", "name"] as const,
        source: "command",
      }),
      createScopedValidationIssue({
        code: "form.invalid",
        message: "Form is incomplete",
        scope: "form",
        source: "form",
      }),
      createScopedValidationIssue({
        message: "Command is blocked",
        scope: "command",
        source: "authority",
      }),
    ] as const;

    expect(collectValidationIssuesForPath(issues, ["name"])).toEqual([
      {
        code: "field.required",
        kind: "path",
        message: "Name is required",
        path: ["name"],
        source: "field",
      },
    ]);
    expect(collectValidationIssuesForPath(issues, ["details"])).toEqual([]);
    expect(collectValidationIssuesForScope(issues, "form")).toEqual([
      {
        code: "form.invalid",
        kind: "scope",
        message: "Form is incomplete",
        scope: "form",
        source: "form",
      },
    ]);
  });

  it("aggregates combined issues for field and form surfaces", () => {
    const path = ["title"];
    const aggregate = aggregateValidationIssues([
      createPathValidationIssue({
        code: "field.required",
        message: "Title is required",
        path,
        source: "field",
      }),
      createScopedValidationIssue({
        message: "Please resolve all field errors before submit",
        scope: "form",
        source: "form",
      }),
      createPathValidationIssue({
        message: "Title must be unique",
        path,
        source: "authority",
      }),
    ]);

    path[0] = "changed";

    expect(aggregate.issues).toHaveLength(3);
    expect(aggregate.pathIssues).toHaveLength(2);
    expect(aggregate.scopedIssues).toHaveLength(1);
    expect(Object.isFrozen(aggregate.issues)).toBe(true);
    expect(Object.isFrozen(aggregate.getPathIssues(["title"]))).toBe(true);
    expect(aggregate.getPathIssues(["title"])).toEqual([
      {
        code: "field.required",
        kind: "path",
        message: "Title is required",
        path: ["title"],
        source: "field",
      },
      {
        kind: "path",
        message: "Title must be unique",
        path: ["title"],
        source: "authority",
      },
    ]);
    expect(aggregate.getScopedIssues("form")).toEqual([
      {
        kind: "scope",
        message: "Please resolve all field errors before submit",
        scope: "form",
        source: "form",
      },
    ]);
    expect(aggregate.getPathIssues(["changed"])).toEqual([]);
  });
});
