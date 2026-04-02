import { defineGraphModuleManifest } from "@io/graph-module";
import { applyGraphIdMap, type ResolvedGraphNamespace } from "@io/graph-kernel";

export * from "./schema.js";
export * from "./env-var.js";
export * from "./document.js";
export * from "./projection.js";
export * from "./query-executors.js";

import { documentSchema } from "./document.js";
import { envVarSchema } from "./env-var.js";
import { artifactWriteCommand } from "./artifact-write.js";
import { decisionWriteCommand } from "./decision-write.js";
import {
  branchCommitQueueProjection,
  projectBranchBoardProjection,
  workflowModuleId,
  workflowQuerySurfaceCatalog,
  workflowReviewModuleReadScope,
} from "./projection.js";
import { agentSessionAppendCommand } from "./session-append.js";
import { workflowSchema, type WorkflowSchema } from "./schema.js";
import { workflowMutationCommand } from "./command.js";
import ids from "./workflow.json";

type WorkflowNamespaceInput = typeof documentSchema & typeof envVarSchema & WorkflowSchema;

export type WorkflowNamespace = ResolvedGraphNamespace<WorkflowNamespaceInput>;

export const workflow: WorkflowNamespace = applyGraphIdMap(ids, {
  ...documentSchema,
  ...envVarSchema,
  ...workflowSchema,
});

export const workflowManifest = defineGraphModuleManifest({
  moduleId: workflowModuleId,
  version: "0.0.1",
  source: {
    kind: "built-in",
    specifier: "@io/graph-module-workflow",
    exportName: "workflowManifest",
  },
  compatibility: {
    graph: "graph-schema:v1",
    runtime: "graph-runtime:v1",
  },
  runtime: {
    schemas: [
      {
        key: "workflow",
        namespace: workflow,
      },
    ],
    querySurfaceCatalogs: [workflowQuerySurfaceCatalog],
    commands: [
      workflowMutationCommand,
      agentSessionAppendCommand,
      artifactWriteCommand,
      decisionWriteCommand,
    ],
    readScopes: [workflowReviewModuleReadScope],
    projections: [projectBranchBoardProjection, branchCommitQueueProjection],
  },
});
