import { expect, test } from "bun:test";

import type { Workflow } from "../agent/types.js";
import { resolveWorkflowTuiStartupContract } from "./startup.js";

function createWorkflow(
  overrides: Partial<Workflow["tui"]> = {},
): Pick<Workflow, "entrypoint" | "tui" | "workspace"> {
  const graph = {
    kind: "http" as const,
    ...overrides.graph,
  };
  const initialScope = {
    ...overrides.initialScope,
  };

  return {
    entrypoint: {
      configPath: "/workspace/io.ts",
      kind: "io",
      promptPath: "/workspace/io.md",
    },
    tui: {
      ...overrides,
      graph,
      initialScope,
    },
    workspace: {
      root: "/workspace/tmp",
    },
  };
}

test("resolveWorkflowTuiStartupContract keeps the first startup defaults small", () => {
  const contract = resolveWorkflowTuiStartupContract(createWorkflow());

  expect(contract).toMatchObject({
    entrypointPath: "/workspace/io.ts",
    graph: {
      kind: "http",
      url: "http://io.localhost:1355/",
      requestedScope: {
        kind: "module",
        moduleId: "workflow",
        scopeId: "scope:workflow:review",
      },
    },
    initialScope: {
      branch: {
        kind: "first-branch-board-row",
      },
      project: {
        kind: "infer-singleton",
      },
    },
    workspaceRoot: "/workspace/tmp",
  });
});

test("resolveWorkflowTuiStartupContract prefers CLI overrides over workflow config", () => {
  const contract = resolveWorkflowTuiStartupContract(
    createWorkflow({
      graph: {
        kind: "http",
        url: "https://config.example/root",
      },
      initialScope: {
        branch: "branch:config",
        project: "project:config",
      },
    }),
    {
      branchId: "branch:cli",
      graphUrl: "https://cli.example/bootstrap",
      projectId: "project:cli",
    },
  );

  expect(contract.graph.url).toBe("https://cli.example/bootstrap");
  expect(contract.initialScope.project).toEqual({
    kind: "configured",
    projectId: "project:cli",
  });
  expect(contract.initialScope.branch).toEqual({
    branchId: "branch:cli",
    kind: "configured",
  });
});

test("resolveWorkflowTuiStartupContract validates graph URLs", () => {
  expect(() =>
    resolveWorkflowTuiStartupContract(createWorkflow(), {
      graphUrl: "not-a-url",
    }),
  ).toThrow('Invalid graph URL "not-a-url"');
});
