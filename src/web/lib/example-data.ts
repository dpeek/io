import { core, type NamespaceClient } from "@io/core/graph";
import { app } from "@io/core/graph/schema/app";
import { topicKind } from "@io/core/graph/schema/app/topic";

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? value.key;
}

export type ExampleGraphIds = {
  readonly docsTag: string;
  readonly graphExplorer: string;
  readonly graphTag: string;
  readonly runtimeSync: string;
  readonly secretRotation: string;
};

export function seedExampleGraph(
  graph: NamespaceClient<typeof app & Pick<typeof core, "tag">>,
): ExampleGraphIds {
  const graphTag = graph.tag.create({
    color: "#0ea5e9",
    key: "graph",
    name: "Graph",
  });
  const docsTag = graph.tag.create({
    color: "#f59e0b",
    key: "docs",
    name: "Docs",
  });

  const graphExplorer = graph.topic.create({
    content: "Shared explorer surface for the canonical app graph.",
    kind: resolvedEnumValue(topicKind.values.module),
    name: "Graph Explorer",
    isArchived: false,
    order: 1,
    slug: "graph-explorer",
    tags: [graphTag, docsTag],
  });
  const runtimeSync = graph.topic.create({
    content: "Total snapshots bootstrap clients before ordered incremental updates.",
    kind: resolvedEnumValue(topicKind.values.workflow),
    name: "Runtime Sync",
    isArchived: false,
    order: 2,
    parent: graphExplorer,
    references: [graphExplorer],
    tags: [graphTag],
  });
  const secretRotation = graph.topic.create({
    content: "Rotate env-var secrets through authority-only commands.",
    kind: resolvedEnumValue(topicKind.values.runbook),
    name: "Secret Rotation",
    isArchived: false,
    order: 3,
    parent: graphExplorer,
    references: [runtimeSync],
    tags: [docsTag],
  });

  return {
    docsTag,
    graphExplorer,
    graphTag,
    runtimeSync,
    secretRotation,
  };
}
