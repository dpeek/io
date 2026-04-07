import { describe, expect, it } from "bun:test";

import { createStore, typeId } from "@io/app/graph";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityTypeBrowserSurface } from "./entity-type-browser.js";
import { GraphRuntimeProvider, type GraphRuntime } from "./graph-runtime-bootstrap.js";

const productGraph = { ...core, ...workflow } as const;

function createWorkflowPageRuntime() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, workflow, coreGraphBootstrapOptions);

  const graph = createGraphClient(store, productGraph);
  const projectId = graph.project.create({
    inferred: true,
    name: "IO",
    projectKey: "project:io",
  });

  graph.branch.create({
    branchKey: "branch:workflow-shell",
    name: "Workflow shell",
    project: projectId,
    queueRank: 1,
    state: workflow.branchState.values.active.id,
  });
  graph.branch.create({
    branchKey: "branch:workflow-backlog",
    name: "Workflow backlog",
    project: projectId,
    queueRank: 2,
    state: workflow.branchState.values.ready.id,
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
          typeId={typeId(workflow.branch)}
        />
      </GraphRuntimeProvider>,
    );

    expect(html).toContain("Create Branch");
    expect(html).toContain("Branches");
    expect(html).toContain("Workflow shell");
    expect(html).toContain("Workflow backlog");
    expect(html).toContain("Branch");
    expect(html).toContain("Branch key");
    expect(html).toContain('data-entity-surface="entity"');
    expect(html).toContain('data-entity-surface-mode="edit"');
    expect(html).toContain('data-entity-surface-mode-toggle="true"');
    expect(html).toContain('data-entity-type-list-scroll="');
    expect(html).toContain("-mx-4");
    expect(html).toContain("rounded-none");
    expect(html).not.toContain("The branch list is live against the synced graph runtime.");
    expect(html).not.toContain("1 branches");
  });
});
