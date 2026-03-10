import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

import config from "./index.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("@io/config re-exports the repo root config", () => {
  expect(config.install?.brews).toContain("ripgrep");
});

test("@io/config exposes the repo context bundle and routing defaults", () => {
  expect(config.context?.entrypoint).toBe("./io.md");
  expect(config.context?.docs).toEqual({
    "project.architecture": "./io/context/architecture.md",
    "project.overview": "./io/context/project-overview.md",
    "project.workflow-migration": "./io/context/workflow-migration.md",
  });
  expect(config.context?.profiles?.backlog?.include).toContain("project.workflow-migration");
  expect(config.issues).toEqual({
    defaultAgent: "execute",
    defaultProfile: "execute",
    routing: [
      {
        agent: "backlog",
        if: {
          labelsAny: ["backlog", "planning"],
        },
        profile: "backlog",
      },
    ],
  });

  for (const path of Object.values(config.context?.docs ?? {})) {
    expect(existsSync(resolve(repoRoot, path))).toBe(true);
  }
});
