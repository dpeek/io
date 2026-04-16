import { useCallback, useEffect, useState } from "react";
import { GraphleShell, type GraphleShellHostStatus } from "@dpeek/graphle-web-shell";

import { createGraphleSiteFeature, type GraphleSiteStatusState } from "./site-feature.js";
import {
  createGraphleSitePage,
  createGraphleSitePost,
  loadGraphleSiteStatus,
  updateGraphleSitePage,
  updateGraphleSitePost,
  type GraphleSitePageInput,
  type GraphleSitePostInput,
} from "./status.js";

export interface GraphleSiteShellProps {
  readonly path?: string;
  readonly status: GraphleSiteStatusState;
  readonly onRefresh?: () => void;
  readonly onCreatePage?: (input: GraphleSitePageInput) => Promise<void>;
  readonly onUpdatePage?: (id: string, input: GraphleSitePageInput) => Promise<void>;
  readonly onCreatePost?: (input: GraphleSitePostInput) => Promise<void>;
  readonly onUpdatePost?: (id: string, input: GraphleSitePostInput) => Promise<void>;
}

function createShellStatus(status: GraphleSiteStatusState): Partial<GraphleShellHostStatus> {
  if (status.state === "loading") {
    return {
      auth: { label: "Auth loading", state: "loading" },
      graph: { label: "Graph loading", state: "loading" },
      runtime: { label: "Runtime loading", state: "loading" },
    };
  }

  if (status.state === "error") {
    return {
      auth: { label: "Auth unavailable", state: "error", detail: status.message },
      graph: { label: "Graph unavailable", state: "error", detail: status.message },
      runtime: { label: "Runtime error", state: "error", detail: status.message },
    };
  }

  const { health, session } = status.snapshot;
  const graphStatus = health.graph?.status ?? "unknown";

  return {
    auth: {
      label: session.authenticated ? "Admin active" : "Visitor preview",
      state: session.authenticated ? "ready" : "unknown",
    },
    graph: {
      label: graphStatus === "ok" ? "Graph ready" : `Graph ${graphStatus}`,
      state: graphStatus === "ok" ? "ready" : "unknown",
    },
    runtime: {
      label: health.service?.status === "ok" ? "Runtime ready" : "Runtime unknown",
      state: health.service?.status === "ok" ? "ready" : "unknown",
      detail: health.service?.startedAt,
    },
  };
}

export function GraphleSiteShell({
  path = "/",
  status,
  onRefresh,
  onCreatePage,
  onUpdatePage,
  onCreatePost,
  onUpdatePost,
}: GraphleSiteShellProps) {
  const feature = createGraphleSiteFeature({
    status,
    onRefresh,
    onCreatePage,
    onUpdatePage,
    onCreatePost,
    onUpdatePost,
  });

  return (
    <GraphleShell
      title="Graphle site"
      path={path}
      features={[feature]}
      status={createShellStatus(status)}
    />
  );
}

export function GraphleSiteApp() {
  const [status, setStatus] = useState<GraphleSiteStatusState>({ state: "loading" });
  const [path, setPath] = useState("/");

  const refresh = useCallback(() => {
    const nextPath = window.location.pathname || "/";
    setPath(nextPath);
    setStatus({ state: "loading" });
    void loadGraphleSiteStatus({ path: nextPath })
      .then((snapshot) => {
        setStatus({ state: "ready", snapshot });
      })
      .catch((error) => {
        setStatus({
          state: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);

  const mutate = useCallback(
    async (write: () => Promise<unknown>) => {
      await write();
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <GraphleSiteShell
      path={path}
      status={status}
      onRefresh={refresh}
      onCreatePage={(input) => mutate(() => createGraphleSitePage(input))}
      onUpdatePage={(id, input) => mutate(() => updateGraphleSitePage(id, input))}
      onCreatePost={(input) => mutate(() => createGraphleSitePost(input))}
      onUpdatePost={(id, input) => mutate(() => updateGraphleSitePost(id, input))}
    />
  );
}
