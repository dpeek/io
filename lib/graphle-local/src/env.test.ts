import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { ensureLocalProjectEnv, graphleAuthSecretEnvKey, graphleProjectIdEnvKey } from "./env.js";

async function withTempDir<T>(run: (path: string) => Promise<T>): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), "graphle-local-env-"));
  try {
    return await run(path);
  } finally {
    await rm(path, { force: true, recursive: true });
  }
}

describe("local project env", () => {
  it("creates .env with generated auth and project values", async () => {
    await withTempDir(async (cwd) => {
      const result = await ensureLocalProjectEnv({
        cwd,
        generateAuthSecret: () => "secret-1",
        generateProjectId: () => "project-1",
      });

      expect(result.createdFile).toBe(true);
      expect(result.createdKeys).toEqual([graphleAuthSecretEnvKey, graphleProjectIdEnvKey]);
      expect(result.reusedKeys).toEqual([]);
      expect(result.values).toEqual({
        authSecret: "secret-1",
        projectId: "project-1",
      });
      expect(await readFile(join(cwd, ".env"), "utf8")).toBe(
        "GRAPHLE_AUTH_SECRET=secret-1\nGRAPHLE_PROJECT_ID=project-1\n",
      );
    });
  });

  it("reuses existing values and does not duplicate keys", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, ".env"),
        "EXISTING=1\nGRAPHLE_AUTH_SECRET=kept-secret\nGRAPHLE_PROJECT_ID=kept-project\n",
        "utf8",
      );

      const first = await ensureLocalProjectEnv({
        cwd,
        generateAuthSecret: () => "new-secret",
        generateProjectId: () => "new-project",
      });
      const second = await ensureLocalProjectEnv({
        cwd,
        generateAuthSecret: () => "new-secret-2",
        generateProjectId: () => "new-project-2",
      });
      const content = await readFile(join(cwd, ".env"), "utf8");

      expect(first.createdFile).toBe(false);
      expect(first.createdKeys).toEqual([]);
      expect(first.reusedKeys).toEqual([graphleAuthSecretEnvKey, graphleProjectIdEnvKey]);
      expect(second.createdKeys).toEqual([]);
      expect(second.values).toEqual({
        authSecret: "kept-secret",
        projectId: "kept-project",
      });
      expect(content.match(/GRAPHLE_AUTH_SECRET/g)?.length).toBe(1);
      expect(content.match(/GRAPHLE_PROJECT_ID/g)?.length).toBe(1);
    });
  });

  it("appends only missing graphle keys", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(join(cwd, ".env"), "GRAPHLE_AUTH_SECRET=kept-secret", "utf8");

      const result = await ensureLocalProjectEnv({
        cwd,
        generateAuthSecret: () => "new-secret",
        generateProjectId: () => "project-2",
      });

      expect(result.createdKeys).toEqual([graphleProjectIdEnvKey]);
      expect(result.reusedKeys).toEqual([graphleAuthSecretEnvKey]);
      expect(await readFile(join(cwd, ".env"), "utf8")).toBe(
        "GRAPHLE_AUTH_SECRET=kept-secret\nGRAPHLE_PROJECT_ID=project-2\n",
      );
    });
  });
});
