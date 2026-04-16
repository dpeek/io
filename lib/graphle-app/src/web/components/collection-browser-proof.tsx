"use client";

import { createStore, typeId } from "@dpeek/graphle-app/graph";
import { bootstrap } from "@dpeek/graphle-bootstrap";
import { createGraphClient, serializedQueryVersion } from "@dpeek/graphle-client";
import type { CollectionSurfaceSpec, GraphCommandSurfaceSpec } from "@dpeek/graphle-module";
import { core, coreGraphBootstrapOptions } from "@dpeek/graphle-module-core";
import { workflow } from "@dpeek/graphle-module-workflow";
import type { QueryContainerPageExecutor, SavedQueryRecord } from "@dpeek/graphle-query";
import type {
  CollectionCommandBinding,
  CollectionSurfaceRecordLookup,
} from "@dpeek/graphle-surface";
import { Badge } from "@dpeek/graphle-web-ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@dpeek/graphle-web-ui/card";
import { useState } from "react";

import type { ExplorerRuntime } from "./explorer/model.js";
import { typePredicateId } from "./explorer/model.js";
import { type GraphRuntime } from "./graph-runtime-bootstrap.js";
import { CollectionBrowserSurface } from "./collection-browser-surface.js";

const proofGraph = { ...core, ...workflow } as const;

const branchStateLabelById = new Map<string, string>([
  [workflow.branchState.values.backlog.id, "Backlog"],
  [workflow.branchState.values.ready.id, "Ready"],
  [workflow.branchState.values.active.id, "Active"],
  [workflow.branchState.values.blocked.id, "Blocked"],
  [workflow.branchState.values.done.id, "Done"],
  [workflow.branchState.values.archived.id, "Archived"],
]);

const branchBoardSavedQuery = {
  catalogId: "workflow:query-surfaces",
  catalogVersion: "query-catalog:workflow:v1",
  id: "saved-query:views:workflow-branch-board",
  name: "Views workflow branch board",
  parameterDefinitions: [],
  request: {
    version: serializedQueryVersion,
    query: {
      kind: "collection",
      indexId: "workflow:project-branch-board",
      window: {
        limit: 25,
      },
    },
  },
  surfaceId: "workflow:project-branch-board",
  surfaceVersion: "query-surface:workflow:project-branch-board:v1",
  updatedAt: "2026-04-01T00:00:00.000Z",
} as const satisfies SavedQueryRecord;

const branchBoardCollection = {
  key: "views:workflow-branch-board",
  presentation: {
    kind: "table",
  },
  source: {
    kind: "query",
    query: branchBoardSavedQuery.id,
  },
  title: "Workflow Branch Board",
  description:
    "Authored collection proof with shared table selection, command-driven row or selection actions, shared entity detail, and the existing generic branch create flow.",
  commandSurfaces: [
    "views:workflow-branch-board:mark-blocked",
    "views:workflow-branch-board:archive-selection",
  ],
} as const satisfies CollectionSurfaceSpec;

const markBlockedCommandSurface = {
  key: "views:workflow-branch-board:mark-blocked",
  command: "workflow:branch:set-state",
  label: "Mark blocked",
  subject: {
    kind: "entity",
    entity: workflow.branch.values.key,
  },
  inputPresentation: {
    kind: "inline",
  },
  submitBehavior: {
    kind: "blocking",
  },
  postSuccess: [{ kind: "refresh" }],
} as const satisfies GraphCommandSurfaceSpec;

const archiveSelectionCommandSurface = {
  key: "views:workflow-branch-board:archive-selection",
  command: "workflow:branch:set-state",
  label: "Archive selected",
  subject: {
    kind: "selection",
    entity: workflow.branch.values.key,
  },
  inputPresentation: {
    kind: "dialog",
  },
  submitBehavior: {
    kind: "confirm",
    title: "Archive selected branches",
    message: "Set the selected branches to Archived and refresh the proving-ground table.",
    confirmLabel: "Archive branches",
  },
  postSuccess: [{ kind: "refresh" }],
} as const satisfies GraphCommandSurfaceSpec;

type CollectionBrowserProofFixture = {
  readonly collection: CollectionSurfaceSpec;
  readonly commandBindings: Readonly<Record<string, CollectionCommandBinding>>;
  readonly executePage: QueryContainerPageExecutor;
  readonly lookup: CollectionSurfaceRecordLookup;
  readonly runtime: ExplorerRuntime;
  readonly typeId: string;
};

function createLocalProofSync(): GraphRuntime["sync"] {
  let revision = 0;
  const listeners = new Set<() => void>();

  function notify(): void {
    revision += 1;
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    apply: () => undefined,
    applyWriteResult: () => undefined,
    flush: async () => {
      notify();
    },
    getPendingTransactions: () =>
      [{}] as unknown as ReturnType<GraphRuntime["sync"]["getPendingTransactions"]>,
    getState: () =>
      ({
        cursor: `views:workflow-branch-board:${revision}`,
        diagnostics: undefined,
        recentActivities: [],
        status: "ready",
      }) as unknown as ReturnType<GraphRuntime["sync"]["getState"]>,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync: async () => undefined,
  } as unknown as GraphRuntime["sync"];
}

function createCollectionBrowserProofFixture(): CollectionBrowserProofFixture {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, workflow, coreGraphBootstrapOptions);

  const graph = createGraphClient(store, proofGraph);
  const projectId = graph.project.create({
    inferred: true,
    name: "Graphle",
    projectKey: "project:graphle",
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

  const runtime = {
    graph,
    store,
    sync: createLocalProofSync(),
  } satisfies ExplorerRuntime;

  const commandBindings = {
    [archiveSelectionCommandSurface.key]: {
      surface: archiveSelectionCommandSurface,
      execute(subject) {
        if (subject.kind !== "selection") {
          return;
        }
        for (const entityId of subject.entityIds) {
          graph.branch.update(entityId, {
            state: workflow.branchState.values.archived.id,
          });
        }
      },
    },
    [markBlockedCommandSurface.key]: {
      surface: markBlockedCommandSurface,
      execute(subject) {
        if (subject.kind !== "entity") {
          return;
        }
        graph.branch.update(subject.entityId, {
          state: workflow.branchState.values.blocked.id,
        });
      },
    },
  } as const satisfies Readonly<Record<string, CollectionCommandBinding>>;

  return {
    collection: branchBoardCollection,
    commandBindings,
    executePage: async () => {
      const items = store
        .facts(undefined, typePredicateId, typeId(workflow.branch))
        .map((edge) => graph.branch.ref(edge.s))
        .sort((left, right) => {
          const leftRank = left.fields.queueRank.get() ?? Number.MAX_SAFE_INTEGER;
          const rightRank = right.fields.queueRank.get() ?? Number.MAX_SAFE_INTEGER;
          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }
          return (left.fields.name.get() ?? left.id).localeCompare(
            right.fields.name.get() ?? right.id,
          );
        })
        .map((branch) => ({
          entityId: branch.id,
          key: `row:${branch.id}`,
          payload: {
            queueRank: branch.fields.queueRank.get() ?? "—",
            state:
              branchStateLabelById.get(branch.fields.state.get() ?? "") ??
              branch.fields.state.get() ??
              "Unset",
            title: branch.fields.name.get() ?? "Untitled branch",
          },
        }));

      return {
        freshness: {
          completeness: "complete",
          freshness: "current",
        },
        items,
        kind: "collection",
      };
    },
    lookup: {
      getSavedQuery: (id) => (id === branchBoardSavedQuery.id ? branchBoardSavedQuery : undefined),
    },
    runtime,
    typeId: typeId(workflow.branch),
  };
}

export function CollectionBrowserProof() {
  const [fixture] = useState(createCollectionBrowserProofFixture);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generic Collection Browser Proof</CardTitle>
          <CardDescription>
            Proves the authored collection mount can drive record detail selection and launch the
            existing generic create-edit flow from one browser surface.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">collection surface</Badge>
          <Badge variant="outline">command surfaces</Badge>
          <Badge variant="outline">record detail</Badge>
          <Badge variant="outline">generic create</Badge>
        </CardContent>
      </Card>

      <CollectionBrowserSurface
        collection={fixture.collection}
        commandBindings={fixture.commandBindings}
        executePage={fixture.executePage}
        lookup={fixture.lookup}
        runtime={fixture.runtime}
        typeId={fixture.typeId}
      />
    </div>
  );
}
