import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "bun:test";

import { graphleSqliteSchemaVersion, openGraphleSqlite } from "./index.js";

async function withTempDir<T>(run: (path: string) => Promise<T>): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), "graphle-sqlite-"));
  try {
    return await run(path);
  } finally {
    await rm(path, { force: true, recursive: true });
  }
}

describe("graphle sqlite", () => {
  it("opens a database file and initializes graphle_meta", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "graphle.sqlite");
      const handle = await openGraphleSqlite({ path });
      try {
        expect(existsSync(path)).toBe(true);
        expect(handle.health()).toEqual({
          path,
          opened: true,
          metaTableReady: true,
          schemaVersion: graphleSqliteSchemaVersion,
        });
      } finally {
        handle.close();
      }
    });
  });

  it("requires an absolute database path", async () => {
    await expect(openGraphleSqlite({ path: "graphle.sqlite" })).rejects.toThrow(
      "Graphle SQLite path must be absolute",
    );
  });
});
