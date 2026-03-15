import { describe, expect, it } from "bun:test";

import { core } from "../graph/index.js";
import {
  probeContractGraph,
  probeContractItem,
  probeContractObjectView,
  probeContractWorkflow,
  probeSaveContractItemCommand,
} from "../graph/contracts.probe.js";
import * as schemaExports from "./index.js";
import {
  envVar,
  envVarNameBlankMessage,
  envVarNameInvalidMessage,
  envVarNamePattern,
  envVarsSchema,
  secretRef,
} from "./app/env-vars/index.js";
import { block, outlinerSchema } from "./app/outliner/index.js";
import {
  saveWorkspaceIssueCommand,
  saveWorkspaceLabelCommand,
  saveWorkspaceProjectCommand,
  workspaceManagementWorkflow,
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceCommands,
  workspaceIssue,
  workspaceIssueObjectView,
  workspaceLabel,
  workspaceLabelObjectView,
  workspaceObjectViews,
  workspaceProject,
  workspaceProjectObjectView,
  workspaceSchema,
  workspaceWorkflows,
} from "./app/workspace/index.js";
import { dateTypeModule } from "./core/date/index.js";
import { emailTypeModule } from "./core/email/index.js";
import { stringTypeModule } from "./core/string/index.js";
import { urlTypeModule } from "./core/url/index.js";
import { cardinality } from "./core/cardinality/index.js";
import { enumType } from "./core/enum/index.js";
import { node } from "./core/node/index.js";
import { predicate } from "./core/predicate/index.js";
import { coreType } from "./core/type/index.js";
import { dateFilter as compatDateFilter } from "../type/date/filter.js";
import { dateTypeModule as compatDateTypeModule } from "../type/date/index.js";
import { parseDate as compatParseDate } from "../type/date/parse.js";
import { emailTypeModule as compatEmailTypeModule } from "../type/email/index.js";
import { urlMeta as compatUrlMeta } from "../type/url/meta.js";
import { urlTypeModule as compatUrlTypeModule } from "../type/url/index.js";
import { dateFilter } from "./core/date/filter.js";
import { parseDate } from "./core/date/parse.js";
import { urlMeta } from "./core/url/meta.js";

function resolvedTypeId(typeDef: { values: { key: string } }): string {
  const values = typeDef.values as { key: string; id?: string };
  return values.id ?? values.key;
}

const validationContext = {
  event: "create" as const,
  phase: "local" as const,
  nodeId: "env-var-1",
  now: new Date("2026-01-01T00:00:00.000Z"),
  path: [] as const,
  field: "name",
  predicateKey: envVar.fields.name.key,
  range: envVar.fields.name.range,
  cardinality: envVar.fields.name.cardinality,
  previous: undefined,
  changedPredicateKeys: new Set<string>([envVar.fields.name.key]),
};

describe("schema entry surfaces", () => {
  it("keeps core wrappers aligned with the existing graph and type modules", () => {
    expect(node).toBe(core.node);
    expect(coreType).toBe(core.type);
    expect(cardinality).toBe(core.cardinality);
    expect(predicate).toBe(core.predicate);
    expect(enumType).toBe(core.enum);
    expect(stringTypeModule.type.values.key).toBe("core:string");
  });

  it("exports the env-var slice from the canonical app schema tree", () => {
    expect(envVarsSchema).toEqual({
      envVar,
      secretRef,
    });
    expect(String(envVar.fields.secret.range)).toBe(resolvedTypeId(secretRef));
    expect(envVarNamePattern.test("OPENAI_API_KEY")).toBe(true);
    expect(
      envVar.fields.name.validate?.({
        ...validationContext,
        value: " ",
      }),
    ).toEqual({
      code: "string.blank",
      message: envVarNameBlankMessage,
    });
    expect(
      envVar.fields.name.validate?.({
        ...validationContext,
        value: "openai_api_key",
      }),
    ).toEqual({
      code: "envVar.name.invalid",
      message: envVarNameInvalidMessage,
    });
  });

  it("exports the outliner and workspace slices from the canonical app schema tree", () => {
    expect(outlinerSchema).toEqual({
      block,
    });
    expect(String(block.fields.parent.range)).toBe(resolvedTypeId(block));

    expect(workspaceSchema).toEqual({
      workflowStatus,
      workflowStatusCategory,
      workspace,
      workspaceIssue,
      workspaceLabel,
      workspaceProject,
    });
    expect(String(workspace.fields.statuses.range)).toBe(resolvedTypeId(workflowStatus));
    expect(String(workspace.fields.issues.range)).toBe(resolvedTypeId(workspaceIssue));
    expect(String(workspaceIssue.fields.project.range)).toBe(resolvedTypeId(workspaceProject));
    expect(String(workspaceIssue.fields.status.range)).toBe(resolvedTypeId(workflowStatus));
    expect(String(workspaceIssue.fields.labels.range)).toBe(resolvedTypeId(workspaceLabel));
    expect(String(workspaceIssue.fields.parent.range)).toBe(resolvedTypeId(workspaceIssue));
  });

  it("keeps the schema root index wired to the new tree", () => {
    expect(schemaExports.node).toBe(node);
    expect(schemaExports.envVar).toBe(envVar);
    expect(schemaExports.block).toBe(block);
    expect(schemaExports.workspace).toBe(workspace);
    expect(schemaExports.workspaceIssueObjectView).toBe(workspaceIssueObjectView);
    expect(schemaExports.workspaceProjectObjectView).toBe(workspaceProjectObjectView);
    expect(schemaExports.workspaceLabelObjectView).toBe(workspaceLabelObjectView);
    expect(schemaExports.saveWorkspaceIssueCommand).toBe(saveWorkspaceIssueCommand);
    expect(schemaExports.saveWorkspaceProjectCommand).toBe(saveWorkspaceProjectCommand);
    expect(schemaExports.saveWorkspaceLabelCommand).toBe(saveWorkspaceLabelCommand);
    expect(schemaExports.workspaceObjectViews).toBe(workspaceObjectViews);
    expect(schemaExports.workspaceCommands).toBe(workspaceCommands);
    expect(schemaExports.workspaceManagementWorkflow).toBe(workspaceManagementWorkflow);
    expect(schemaExports.workspaceWorkflows).toBe(workspaceWorkflows);
  });

  it("keeps contract probes root-safe without polluting the canonical schema tree", () => {
    expect(probeContractGraph.contractItem.values.key).toBe(probeContractItem.values.key);
    expect(typeof probeContractGraph.contractItem.values.id).toBe("string");
    expect(String(probeContractItem.fields.parent.range)).toBe(resolvedTypeId(probeContractItem));
    expect(String(probeContractItem.fields.relatedItems.range)).toBe(
      resolvedTypeId(probeContractItem),
    );
    expect(probeContractObjectView.entity).toBe(probeContractGraph.contractItem.values.key);
    expect(probeContractWorkflow.subjects).toEqual([probeContractGraph.contractItem.values.key]);
    expect(probeContractWorkflow.commands).toEqual([probeSaveContractItemCommand.key]);
    expect("probeContractItem" in schemaExports).toBe(false);
    expect("probeContractObjectView" in schemaExports).toBe(false);
    expect("probeContractWorkflow" in schemaExports).toBe(false);
  });

  it("keeps migrated built-ins aligned with legacy compatibility paths", () => {
    expect(dateTypeModule).toBe(compatDateTypeModule);
    expect(dateFilter).toBe(compatDateFilter);
    expect(parseDate).toBe(compatParseDate);
    expect(urlTypeModule).toBe(compatUrlTypeModule);
    expect(urlMeta).toBe(compatUrlMeta);
    expect(emailTypeModule).toBe(compatEmailTypeModule);

    expect(dateTypeModule.type).toBe(core.date);
    expect(urlTypeModule.type).toBe(core.url);
    expect(emailTypeModule.type).toBe(core.email);
  });
});
