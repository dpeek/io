import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "bun:test";

import { createBootstrappedSnapshot } from "@dpeek/graphle-bootstrap";
import { createGraphClient } from "@dpeek/graphle-client";
import { createGraphStore, createGraphWriteTransactionFromSnapshots } from "@dpeek/graphle-kernel";
import { minimalCore } from "@dpeek/graphle-module-core";
import { site } from "@dpeek/graphle-module-site";

import {
  createGraphleSqlitePersistedAuthoritativeGraph,
  graphleSqliteSchemaVersion,
  openGraphleSqlite,
  type GraphleSqliteHandle,
} from "./index.js";

const siteDefinitions = { ...minimalCore, ...site } as const;

async function withTempDir<T>(run: (path: string) => Promise<T>): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), "graphle-sqlite-"));
  try {
    return await run(path);
  } finally {
    await rm(path, { force: true, recursive: true });
  }
}

function createSiteStore() {
  return createGraphStore(
    createBootstrappedSnapshot(siteDefinitions, {
      availableDefinitions: siteDefinitions,
      coreSchema: minimalCore,
    }),
  );
}

async function openSiteAuthority(handle: GraphleSqliteHandle, seedCalls?: string[]) {
  return createGraphleSqlitePersistedAuthoritativeGraph(createSiteStore(), site, {
    handle,
    authorityId: "site",
    definitions: siteDefinitions,
    seed(graph) {
      seedCalls?.push("seed");
      graph.page.create({
        title: "Home",
        path: "/",
        body: "# Home",
        status: site.status.values.published.id,
      });
    },
  });
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

  it("persists seeded authority state across reopen without reseeding", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "graphle.sqlite");
      const seedCalls: string[] = [];
      const firstHandle = await openGraphleSqlite({ path });
      const first = await openSiteAuthority(firstHandle, seedCalls);

      expect(seedCalls).toEqual(["seed"]);
      expect(first.graph.page.list()).toHaveLength(1);
      firstHandle.close();

      const secondHandle = await openGraphleSqlite({ path });
      const second = await openSiteAuthority(secondHandle, seedCalls);
      try {
        expect(seedCalls).toEqual(["seed"]);
        expect(second.graph.page.list()).toEqual([
          expect.objectContaining({
            title: "Home",
            path: "/",
            body: "# Home",
          }),
        ]);
        expect(second.startupDiagnostics).toEqual({
          recovery: "none",
          repairReasons: [],
          resetReasons: [],
        });
      } finally {
        secondHandle.close();
      }
    });
  });

  it("commits accepted transactions and reloads the retained write history", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "graphle.sqlite");
      const firstHandle = await openGraphleSqlite({ path });
      const first = await openSiteAuthority(firstHandle);
      const before = first.store.snapshot();
      const draftStore = createGraphStore(before);
      const draftGraph = createGraphClient(draftStore, site, siteDefinitions);

      draftGraph.page.create({
        title: "Work",
        path: "/work",
        body: "# Work",
        status: site.status.values.published.id,
      });

      await first.applyTransaction(
        createGraphWriteTransactionFromSnapshots(
          before,
          draftStore.snapshot(),
          "tx:create-work-page",
        ),
      );
      firstHandle.close();

      const secondHandle = await openGraphleSqlite({ path });
      const second = await openSiteAuthority(secondHandle);
      try {
        expect(
          second.graph.page
            .list()
            .map((page) => page.path)
            .sort(),
        ).toEqual(["/", "/work"]);
        expect(second.getChangesAfter().changes).toHaveLength(1);
      } finally {
        secondHandle.close();
      }
    });
  });

  it("persists direct typed graph writes through an explicit baseline rewrite", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "graphle.sqlite");
      const firstHandle = await openGraphleSqlite({ path });
      const first = await openSiteAuthority(firstHandle);

      first.graph.post.create({
        title: "Example post",
        slug: "example-post",
        body: "# Example",
        excerpt: "A short example post.",
        publishedAt: new Date("2026-04-15T00:00:00.000Z"),
        status: site.status.values.published.id,
      });
      await first.persist();
      firstHandle.close();

      const secondHandle = await openGraphleSqlite({ path });
      const second = await openSiteAuthority(secondHandle);
      try {
        expect(second.graph.post.list()).toEqual([
          expect.objectContaining({
            title: "Example post",
            slug: "example-post",
            excerpt: "A short example post.",
          }),
        ]);
      } finally {
        secondHandle.close();
      }
    });
  });
});
