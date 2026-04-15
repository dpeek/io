import { createBootstrappedSnapshot } from "@dpeek/graphle-bootstrap";
import { createGraphStore } from "@dpeek/graphle-kernel";
import { minimalCore } from "@dpeek/graphle-module-core";
import { site } from "@dpeek/graphle-module-site";
import {
  createGraphleSqlitePersistedAuthoritativeGraph,
  type GraphleSqliteHandle,
} from "@dpeek/graphle-sqlite";

export const graphleLocalSiteAuthorityId = "site";

const localSiteGraphDefinitions = { ...minimalCore, ...site } as const;

export type LocalSiteStartupDiagnostics = {
  readonly recovery: "none" | "repair" | "reset-baseline";
  readonly repairReasons: readonly string[];
  readonly resetReasons: readonly string[];
};

export type LocalSitePage = {
  readonly title: string;
  readonly path: string;
  readonly body: string;
  readonly status: string;
};

export interface LocalSiteAuthority {
  readonly startupDiagnostics: LocalSiteStartupDiagnostics;
  readonly graph: {
    readonly page: {
      list(): readonly LocalSitePage[];
    };
    readonly post: {
      list(): readonly unknown[];
    };
  };
}

export interface OpenLocalSiteAuthorityOptions {
  readonly sqlite: GraphleSqliteHandle;
  readonly now?: () => Date;
}

export interface LocalSiteHomePage {
  readonly title: string;
  readonly body: string;
}

function createLocalSiteStore() {
  return createGraphStore(
    createBootstrappedSnapshot(localSiteGraphDefinitions, {
      availableDefinitions: localSiteGraphDefinitions,
      coreSchema: minimalCore,
    }),
  );
}

export async function openLocalSiteAuthority({
  sqlite,
  now = () => new Date(),
}: OpenLocalSiteAuthorityOptions): Promise<LocalSiteAuthority> {
  return createGraphleSqlitePersistedAuthoritativeGraph(createLocalSiteStore(), site, {
    handle: sqlite,
    authorityId: graphleLocalSiteAuthorityId,
    definitions: localSiteGraphDefinitions,
    seed(graph) {
      const timestamp = now();
      const publishedStatus = site.status.values.published.id;

      graph.page.create({
        title: "Home",
        path: "/",
        body: "Welcome to your new Graphle site.",
        status: publishedStatus,
        updatedAt: timestamp,
      });
      graph.post.create({
        title: "Example post",
        slug: "example-post",
        body: "This is the first durable post in your local site graph.",
        excerpt: "A short example post seeded into the local graph.",
        publishedAt: timestamp,
        status: publishedStatus,
        updatedAt: timestamp,
      });
    },
  });
}

export function readLocalSiteHomePage(
  authority: LocalSiteAuthority | undefined,
): LocalSiteHomePage | undefined {
  if (!authority) return undefined;
  const publishedStatus = site.status.values.published.id;
  const home =
    authority.graph.page
      .list()
      .find((page) => page.path === "/" && page.status === publishedStatus) ??
    authority.graph.page.list().find((page) => page.path === "/");
  if (!home) return undefined;

  return {
    title: home.title,
    body: home.body,
  };
}

export function readLocalSiteAuthorityHealth(authority: LocalSiteAuthority | undefined) {
  if (!authority) {
    return {
      status: "unavailable" as const,
    };
  }

  return {
    status: "ok" as const,
    startupDiagnostics: authority.startupDiagnostics,
    records: {
      pages: authority.graph.page.list().length,
      posts: authority.graph.post.list().length,
    },
  };
}
