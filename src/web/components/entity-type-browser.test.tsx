import { describe, expect, it } from "bun:test";

import { bootstrap, createStore, typeId } from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import { pkm } from "@io/core/graph/modules/pkm";
import { createGraphClient } from "@io/graph-client";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityTypeBrowserSurface } from "./entity-type-browser.js";
import { GraphRuntimeProvider, type GraphRuntime } from "./graph-runtime-bootstrap.js";

const productGraph = { ...core, ...pkm, ...ops } as const;

function createWorkflowPageRuntime() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, pkm);
  bootstrap(store, ops);

  const graph = createGraphClient(store, productGraph);
  const projectId = graph.workflowProject.create({
    inferred: true,
    name: "IO",
    projectKey: "project:io",
  });

  graph.workflowBranch.create({
    branchKey: "branch:workflow-shell",
    name: "Workflow shell",
    project: projectId,
    queueRank: 1,
    state: ops.workflowBranchState.values.active.id,
  });
  graph.workflowBranch.create({
    branchKey: "branch:workflow-backlog",
    name: "Workflow backlog",
    project: projectId,
    queueRank: 2,
    state: ops.workflowBranchState.values.ready.id,
  });

  const sync = {
    apply: () => undefined,
    applyWriteResult: () => undefined,
    flush: async () => undefined,
    getPendingTransactions: () => [],
    getState: () => ({}) as ReturnType<GraphRuntime["sync"]["getState"]>,
    subscribe: () => () => undefined,
    sync: async () => undefined,
  } as unknown as GraphRuntime["sync"];

  return {
    graph,
    store,
    sync,
  };
}

describe("entity type browser", () => {
  it("renders the selected type list and default entity inspector without list help chrome", () => {
    const runtime = createWorkflowPageRuntime();
    const html = renderToStaticMarkup(
      <GraphRuntimeProvider runtime={runtime}>
        <EntityTypeBrowserSurface
          runtime={runtime}
          title="Branches"
          typeId={typeId(ops.workflowBranch)}
        />
      </GraphRuntimeProvider>,
    );

    expect(html).toContain("Create Workflow Branch");
    expect(html).toContain("Branches");
    expect(html).toContain("Workflow shell");
    expect(html).toContain("Workflow backlog");
    expect(html).toContain("Workflow Branch");
    expect(html).toContain("Branch key");
    expect(html).toContain('data-entity-type-list-scroll="');
    expect(html).toContain("-mx-4");
    expect(html).toContain("rounded-none");
    expect(html).not.toContain("The branch list is live against the synced graph runtime.");
    expect(html).not.toContain("1 branches");
  });
});
