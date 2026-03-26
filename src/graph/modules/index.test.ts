import { describe, expect, it } from "bun:test";

import {
  probeContractGraph,
  probeContractItem,
  probeContractObjectView,
  probeContractWorkflow,
  probeSaveContractItemCommand,
} from "../definition-contracts.probe.js";
import { core as canonicalCore } from "./core.js";
import { cardinality } from "./core/cardinality/index.js";
import { colorTypeModule } from "./core/color/index.js";
import { dateTypeModule } from "./core/date/index.js";
import { durationTypeModule } from "./core/duration/index.js";
import { emailTypeModule } from "./core/email/index.js";
import { enumType } from "./core/enum/index.js";
import {
  graphIconSeeds,
  icon,
  iconReferenceField,
  resolvePredicateDefinitionIconId,
  resolveTypeDefinitionIconId,
} from "./core/icon/index.js";
import {
  admissionBootstrapMode,
  admissionPolicy,
  admissionSignupPolicy,
  authSubjectProjection,
  authSubjectStatus,
  principal,
  principalKind,
  principalRoleBinding,
  principalRoleBindingStatus,
  principalStatus,
} from "./core/identity/index.js";
import { jsonTypeModule } from "./core/json/index.js";
import { markdownTypeModule } from "./core/markdown/index.js";
import { moneyTypeModule } from "./core/money/index.js";
import { node } from "./core/node/index.js";
import { percentTypeModule } from "./core/percent/index.js";
import { predicate } from "./core/predicate/index.js";
import { quantityTypeModule } from "./core/quantity/index.js";
import { rangeTypeModule } from "./core/range/index.js";
import { rateTypeModule } from "./core/rate/index.js";
import { secretHandle } from "./core/secret/index.js";
import { stringTypeModule } from "./core/string/index.js";
import { svgTypeModule } from "./core/svg/index.js";
import { tag } from "./core/tag/index.js";
import { coreType } from "./core/type/index.js";
import { urlTypeModule } from "./core/url/index.js";
import { core } from "./index.js";
import * as moduleExports from "./index.js";
import { ops as canonicalOps } from "./ops.js";
import {
  envVar,
  envVarNameBlankMessage,
  envVarNameInvalidMessage,
  envVarNamePattern,
  envVarSchema,
} from "./ops/env-var/schema.js";
import {
  agentSession,
  agentSessionEvent,
  contextBundle,
  contextBundleEntry,
  repositoryBranch,
  repositoryCommit,
  workflowMutationCommand,
  workflowArtifact,
  workflowBranch,
  workflowCommit,
  workflowDecision,
  workflowProject,
  workflowRepository,
  workflowSchema,
} from "./ops/workflow/schema.js";
import { pkm as canonicalPkm } from "./pkm.js";
import {
  document,
  documentBlock,
  documentBlockKind,
  documentPlacement,
  documentSchema,
} from "./pkm/document/schema.js";

function resolvedTypeId(typeDef: { values: { key: string } }): string {
  const values = typeDef.values as { key: string; id?: string };
  return values.id ?? values.key;
}

function expectNamedExports(
  exportsObject: Record<string, unknown>,
  names: readonly string[],
): void {
  expect(Object.keys(exportsObject)).toEqual(expect.arrayContaining([...names]));
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

const replicatedServerCommandAuthority = {
  visibility: "replicated",
  write: "server-command",
} as const;

describe("module entry surfaces", () => {
  it("keeps built-in modules aligned with the canonical core contracts", () => {
    expect(node).toBe(core.node);
    expect(coreType).toBe(core.type);
    expect(cardinality).toBe(core.cardinality);
    expect(predicate).toBe(core.predicate);
    expect(enumType).toBe(core.enum);
    expect(stringTypeModule.type.values.key).toBe("core:string");
    expect(dateTypeModule.type).toBe(core.date);
    expect(urlTypeModule.type).toBe(core.url);
    expect(emailTypeModule.type).toBe(core.email);
    expect(colorTypeModule.type.values.key).toBe("core:color");
    expect(jsonTypeModule.type.values.key).toBe("core:json");
    expect(markdownTypeModule.type.values.key).toBe("core:markdown");
    expect(moneyTypeModule.type.values.key).toBe("core:money");
    expect(svgTypeModule.type.values.key).toBe("core:svg");
    expect(durationTypeModule.type.values.key).toBe("core:duration");
    expect(percentTypeModule.type.values.key).toBe("core:percent");
    expect(quantityTypeModule.type.values.key).toBe("core:quantity");
    expect(rangeTypeModule.type.values.key).toBe("core:range");
    expect(rateTypeModule.type.values.key).toBe("core:rate");
    expect(icon.values.key).toBe("core:icon");
    expect(tag.values.key).toBe("core:tag");
    expect(principalKind.values.key).toBe("core:principalKind");
    expect(principalStatus.values.key).toBe("core:principalStatus");
    expect(authSubjectStatus.values.key).toBe("core:authSubjectStatus");
    expect(principalRoleBindingStatus.values.key).toBe("core:principalRoleBindingStatus");
    expect(admissionBootstrapMode.values.key).toBe("core:admissionBootstrapMode");
    expect(admissionSignupPolicy.values.key).toBe("core:admissionSignupPolicy");
    expect(principal.values.key).toBe("core:principal");
    expect(authSubjectProjection.values.key).toBe("core:authSubjectProjection");
    expect(principalRoleBinding.values.key).toBe("core:principalRoleBinding");
    expect(admissionPolicy.values.key).toBe("core:admissionPolicy");
    expect(stringTypeModule.type.values.icon).toBe(graphIconSeeds.string);
    expect(resolveTypeDefinitionIconId(cardinality)).toBe(graphIconSeeds.tag.id);
    expect(resolvePredicateDefinitionIconId(node.fields.type, coreType)).toBe(
      graphIconSeeds.edge.id,
    );
  });

  it("defines canonical core, pkm, and ops namespaces from module entrypoints", () => {
    expect(canonicalCore.node.values.key).toBe(node.values.key);
    expect(canonicalCore.string.values.key).toBe(stringTypeModule.type.values.key);
    expect(canonicalCore.color.values.key).toBe(colorTypeModule.type.values.key);
    expect(canonicalCore.json.values.key).toBe(jsonTypeModule.type.values.key);
    expect(canonicalCore.markdown.values.key).toBe(markdownTypeModule.type.values.key);
    expect(canonicalCore.money.values.key).toBe(moneyTypeModule.type.values.key);
    expect(canonicalCore.svg.values.key).toBe(svgTypeModule.type.values.key);
    expect(canonicalCore.duration.values.key).toBe(durationTypeModule.type.values.key);
    expect(canonicalCore.percent.values.key).toBe(percentTypeModule.type.values.key);
    expect(canonicalCore.quantity.values.key).toBe(quantityTypeModule.type.values.key);
    expect(canonicalCore.range.values.key).toBe(rangeTypeModule.type.values.key);
    expect(canonicalCore.rate.values.key).toBe(rateTypeModule.type.values.key);
    expect(canonicalCore.icon.values.key).toBe(icon.values.key);
    expect(canonicalCore.tag.values.key).toBe(tag.values.key);
    expect(canonicalCore.secretHandle.values.key).toBe(secretHandle.values.key);
    expect(canonicalCore.principalKind.values.key).toBe(principalKind.values.key);
    expect(canonicalCore.principalStatus.values.key).toBe(principalStatus.values.key);
    expect(canonicalCore.authSubjectStatus.values.key).toBe(authSubjectStatus.values.key);
    expect(canonicalCore.principalRoleBindingStatus.values.key).toBe(
      principalRoleBindingStatus.values.key,
    );
    expect(canonicalCore.admissionBootstrapMode.values.key).toBe(admissionBootstrapMode.values.key);
    expect(canonicalCore.admissionSignupPolicy.values.key).toBe(admissionSignupPolicy.values.key);
    expect(canonicalCore.principal.values.key).toBe(principal.values.key);
    expect(canonicalCore.authSubjectProjection.values.key).toBe(authSubjectProjection.values.key);
    expect(canonicalCore.principalRoleBinding.values.key).toBe(principalRoleBinding.values.key);
    expect(canonicalCore.admissionPolicy.values.key).toBe(admissionPolicy.values.key);
    expect(String(canonicalCore.type.fields.icon.range)).toBe(resolvedTypeId(icon));
    expect(String(canonicalCore.predicate.fields.icon.range)).toBe(resolvedTypeId(icon));
    expect(String(canonicalCore.principal.fields.kind.range)).toBe(resolvedTypeId(principalKind));
    expect(String(canonicalCore.principal.fields.status.range)).toBe(
      resolvedTypeId(principalStatus),
    );
    expect(String(canonicalCore.authSubjectProjection.fields.principal.range)).toBe(
      resolvedTypeId(principal),
    );
    expect(String(canonicalCore.authSubjectProjection.fields.status.range)).toBe(
      resolvedTypeId(authSubjectStatus),
    );
    expect(String(canonicalCore.principalRoleBinding.fields.principal.range)).toBe(
      resolvedTypeId(principal),
    );
    expect(String(canonicalCore.principalRoleBinding.fields.status.range)).toBe(
      resolvedTypeId(principalRoleBindingStatus),
    );
    expect(String(canonicalCore.admissionPolicy.fields.bootstrapMode.range)).toBe(
      resolvedTypeId(admissionBootstrapMode),
    );
    expect(String(canonicalCore.admissionPolicy.fields.signupPolicy.range)).toBe(
      resolvedTypeId(admissionSignupPolicy),
    );
    expect(canonicalPkm.document.values.key).toBe(document.values.key);
    expect(canonicalPkm.documentBlock.values.key).toBe(documentBlock.values.key);
    expect(canonicalPkm.documentBlockKind.values.key).toBe(documentBlockKind.values.key);
    expect(canonicalPkm.documentPlacement.values.key).toBe(documentPlacement.values.key);
    expect(canonicalOps.envVar.values.key).toBe(envVar.values.key);
    expect(canonicalOps.workflowProject.values.key).toBe(workflowProject.values.key);
    expect(canonicalOps.workflowRepository.values.key).toBe(workflowRepository.values.key);
    expect(canonicalOps.workflowBranch.values.key).toBe(workflowBranch.values.key);
    expect(canonicalOps.workflowCommit.values.key).toBe(workflowCommit.values.key);
    expect(canonicalOps.repositoryBranch.values.key).toBe(repositoryBranch.values.key);
    expect(canonicalOps.repositoryCommit.values.key).toBe(repositoryCommit.values.key);
    expect(canonicalOps.agentSession.values.key).toBe(agentSession.values.key);
    expect(canonicalOps.agentSessionEvent.values.key).toBe(agentSessionEvent.values.key);
    expect(canonicalOps.workflowArtifact.values.key).toBe(workflowArtifact.values.key);
    expect(canonicalOps.workflowDecision.values.key).toBe(workflowDecision.values.key);
    expect(canonicalOps.contextBundle.values.key).toBe(contextBundle.values.key);
    expect(canonicalOps.contextBundleEntry.values.key).toBe(contextBundleEntry.values.key);
  });

  it("freezes the shared secret-handle contract on the canonical core namespace", () => {
    expect(canonicalCore.secretHandle.values).toMatchObject({
      key: "core:secretHandle",
      name: "Secret Handle",
      icon: graphIconSeeds.secret,
    });
    expect(String(canonicalCore.secretHandle.fields.version.range)).toBe(
      resolvedTypeId(core.number),
    );
    expect(String(canonicalCore.secretHandle.fields.lastRotatedAt.range)).toBe(
      resolvedTypeId(core.date),
    );
    expect(canonicalCore.secretHandle.fields.name.authority).toEqual(
      replicatedServerCommandAuthority,
    );
    expect(canonicalCore.secretHandle.fields.createdAt.authority).toEqual(
      replicatedServerCommandAuthority,
    );
    expect(canonicalCore.secretHandle.fields.updatedAt.authority).toEqual(
      replicatedServerCommandAuthority,
    );
    expect(canonicalCore.secretHandle.fields.version.authority).toEqual(
      replicatedServerCommandAuthority,
    );
    expect(canonicalCore.secretHandle.fields.lastRotatedAt.authority).toEqual(
      replicatedServerCommandAuthority,
    );
  });

  it("exports the env-var slice from the canonical ops module tree", () => {
    expect(envVarSchema).toEqual({
      envVar,
    });
    expect(String(envVar.fields.secret.range)).toBe(resolvedTypeId(secretHandle));
    expect(envVar.fields.secret.authority).toEqual({
      visibility: "replicated",
      write: "server-command",
      secret: {
        kind: "sealed-handle",
        metadataVisibility: "replicated",
        revealCapability: "secret:reveal",
        rotateCapability: "secret:rotate",
      },
    });
    expect(secretHandle.fields.version.authority).toEqual(replicatedServerCommandAuthority);
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

  it("exports the document slice from the canonical pkm module tree", () => {
    expect(documentSchema).toEqual({
      document,
      documentBlockKind,
      documentBlock,
      documentPlacement,
    });
    expect(String(document.fields.tags.range)).toBe(resolvedTypeId(core.tag));
    expect(String(documentBlock.fields.document.range)).toBe(resolvedTypeId(document));
    expect(String(documentBlock.fields.kind.range)).toBe(resolvedTypeId(documentBlockKind));
    expect(String(documentBlock.fields.entity.range)).toBe(resolvedTypeId(core.node));
    expect(String(documentPlacement.fields.document.range)).toBe(resolvedTypeId(document));
    expect(String(documentPlacement.fields.parentPlacement.range)).toBe(
      resolvedTypeId(documentPlacement),
    );
    expect(documentPlacement.fields.parentPlacement.meta.reference).toEqual({
      selection: "existing-only",
      create: false,
      excludeSubject: true,
    });
  });

  it("exports the workflow slice from the canonical ops module tree", () => {
    expect(workflowSchema).toEqual({
      workflowProject,
      workflowRepository,
      workflowBranchState: canonicalOps.workflowBranchState,
      workflowBranch,
      workflowCommitState: canonicalOps.workflowCommitState,
      workflowCommit,
      repositoryCommitState: canonicalOps.repositoryCommitState,
      repositoryCommitLeaseState: canonicalOps.repositoryCommitLeaseState,
      repositoryBranch,
      repositoryCommit,
      agentSessionSubjectKind: canonicalOps.agentSessionSubjectKind,
      agentSessionKind: canonicalOps.agentSessionKind,
      agentSessionRuntimeState: canonicalOps.agentSessionRuntimeState,
      agentSession,
      agentSessionEventType: canonicalOps.agentSessionEventType,
      agentSessionEventPhase: canonicalOps.agentSessionEventPhase,
      agentSessionStatusCode: canonicalOps.agentSessionStatusCode,
      agentSessionStatusFormat: canonicalOps.agentSessionStatusFormat,
      agentSessionStream: canonicalOps.agentSessionStream,
      agentSessionRawLineEncoding: canonicalOps.agentSessionRawLineEncoding,
      agentSessionEvent,
      workflowArtifactKind: canonicalOps.workflowArtifactKind,
      workflowArtifact,
      workflowDecisionKind: canonicalOps.workflowDecisionKind,
      workflowDecision,
      contextBundle,
      contextBundleEntrySource: canonicalOps.contextBundleEntrySource,
      contextBundleEntry,
    });
    expect(String(workflowRepository.fields.project.range)).toBe(resolvedTypeId(workflowProject));
    expect(String(workflowBranch.fields.project.range)).toBe(resolvedTypeId(workflowProject));
    expect(String(workflowCommit.fields.branch.range)).toBe(resolvedTypeId(workflowBranch));
    expect(String(repositoryBranch.fields.repository.range)).toBe(
      resolvedTypeId(workflowRepository),
    );
    expect(String(repositoryCommit.fields.workflowCommit.range)).toBe(
      resolvedTypeId(workflowCommit),
    );
    expect(String(agentSession.fields.branch.range)).toBe(resolvedTypeId(workflowBranch));
    expect(String(agentSession.fields.contextBundle.range)).toBe(resolvedTypeId(contextBundle));
    expect(String(agentSessionEvent.fields.session.range)).toBe(resolvedTypeId(agentSession));
    expect(String(workflowArtifact.fields.session.range)).toBe(resolvedTypeId(agentSession));
    expect(String(workflowDecision.fields.session.range)).toBe(resolvedTypeId(agentSession));
    expect(String(contextBundleEntry.fields.bundle.range)).toBe(resolvedTypeId(contextBundle));
    expect(workflowMutationCommand).toMatchObject({
      key: "ops:workflow:mutation",
      execution: "serverOnly",
    });
  });

  it("exposes canonical namespaces and representative built-ins from the module root", () => {
    expectNamedExports(moduleExports, [
      "core",
      "ops",
      "pkm",
      "document",
      "documentBlock",
      "documentBlockKind",
      "documentPlacement",
      "node",
      "icon",
      "iconReferenceField",
      "envVar",
      "workflowProject",
      "workflowRepository",
      "workflowBranch",
      "workflowCommit",
      "repositoryBranch",
      "repositoryCommit",
      "agentSession",
      "agentSessionEvent",
      "workflowArtifact",
      "workflowDecision",
      "contextBundle",
      "contextBundleEntry",
      "workflowMutationCommand",
      "secretHandle",
      "principal",
      "authSubjectProjection",
      "principalRoleBinding",
      "jsonTypeModule",
      "markdownTypeModule",
      "svgTypeModule",
    ]);

    expect(moduleExports.core).toBe(canonicalCore);
    expect(moduleExports.ops).toBe(canonicalOps);
    expect(moduleExports.pkm).toBe(canonicalPkm);
    expect(canonicalCore.node.values.key).toBe(node.values.key);
    expect(canonicalCore.icon.values.key).toBe(icon.values.key);
    expect(canonicalCore.tag.values.key).toBe(tag.values.key);
    expect(canonicalCore.secretHandle.values.key).toBe(secretHandle.values.key);
    expect(canonicalCore.principal.values.key).toBe(principal.values.key);
    expect(canonicalCore.authSubjectProjection.values.key).toBe(authSubjectProjection.values.key);
    expect(canonicalCore.principalRoleBinding.values.key).toBe(principalRoleBinding.values.key);
    expect(canonicalOps.envVar.values.key).toBe(envVar.values.key);
    expect(canonicalOps.workflowProject.values.key).toBe(workflowProject.values.key);
    expect(canonicalOps.workflowRepository.values.key).toBe(workflowRepository.values.key);
    expect(canonicalOps.workflowBranch.values.key).toBe(workflowBranch.values.key);
    expect(canonicalOps.workflowCommit.values.key).toBe(workflowCommit.values.key);
    expect(canonicalOps.repositoryBranch.values.key).toBe(repositoryBranch.values.key);
    expect(canonicalOps.repositoryCommit.values.key).toBe(repositoryCommit.values.key);
    expect(canonicalOps.agentSession.values.key).toBe(agentSession.values.key);
    expect(canonicalOps.agentSessionEvent.values.key).toBe(agentSessionEvent.values.key);
    expect(canonicalOps.workflowArtifact.values.key).toBe(workflowArtifact.values.key);
    expect(canonicalOps.workflowDecision.values.key).toBe(workflowDecision.values.key);
    expect(canonicalOps.contextBundle.values.key).toBe(contextBundle.values.key);
    expect(canonicalOps.contextBundleEntry.values.key).toBe(contextBundleEntry.values.key);
    expect(moduleExports.workflowMutationCommand).toBe(workflowMutationCommand);
    expect(canonicalPkm.document.values.key).toBe(document.values.key);
    expect(canonicalPkm.documentBlock.values.key).toBe(documentBlock.values.key);
    expect(canonicalPkm.documentBlockKind.values.key).toBe(documentBlockKind.values.key);
    expect(canonicalPkm.documentPlacement.values.key).toBe(documentPlacement.values.key);
    expect(String(canonicalCore.type.fields.icon.range)).toBe(resolvedTypeId(icon));
    expect(String(canonicalCore.predicate.fields.icon.range)).toBe(resolvedTypeId(icon));
    expect(typeof moduleExports.core.node.values.id).toBe("string");
    expect(typeof moduleExports.core.principal.values.id).toBe("string");
    expect(typeof moduleExports.ops.envVar.values.id).toBe("string");
    expect(typeof moduleExports.ops.workflowProject.values.id).toBe("string");
    expect(typeof moduleExports.ops.agentSession.values.id).toBe("string");
    expect(typeof moduleExports.pkm.document.values.id).toBe("string");
    expect(moduleExports.node.values.key).toBe(canonicalCore.node.values.key);
    expect(moduleExports.icon.values.key).toBe(canonicalCore.icon.values.key);
    expect(moduleExports.iconReferenceField).toBe(iconReferenceField);
    expect(moduleExports.envVar.values.key).toBe(canonicalOps.envVar.values.key);
    expect(moduleExports.workflowProject.values.key).toBe(canonicalOps.workflowProject.values.key);
    expect(moduleExports.workflowRepository.values.key).toBe(
      canonicalOps.workflowRepository.values.key,
    );
    expect(moduleExports.workflowBranch.values.key).toBe(canonicalOps.workflowBranch.values.key);
    expect(moduleExports.workflowCommit.values.key).toBe(canonicalOps.workflowCommit.values.key);
    expect(moduleExports.repositoryBranch.values.key).toBe(
      canonicalOps.repositoryBranch.values.key,
    );
    expect(moduleExports.repositoryCommit.values.key).toBe(
      canonicalOps.repositoryCommit.values.key,
    );
    expect(moduleExports.secretHandle.values.key).toBe(canonicalCore.secretHandle.values.key);
    expect(moduleExports.principal.values.key).toBe(canonicalCore.principal.values.key);
    expect(moduleExports.authSubjectProjection.values.key).toBe(
      canonicalCore.authSubjectProjection.values.key,
    );
    expect(moduleExports.principalRoleBinding.values.key).toBe(
      canonicalCore.principalRoleBinding.values.key,
    );
    expect(moduleExports.document.values.key).toBe(canonicalPkm.document.values.key);
    expect(moduleExports.documentBlock.values.key).toBe(canonicalPkm.documentBlock.values.key);
    expect(moduleExports.documentBlockKind.values.key).toBe(
      canonicalPkm.documentBlockKind.values.key,
    );
    expect(moduleExports.documentPlacement.values.key).toBe(
      canonicalPkm.documentPlacement.values.key,
    );
    expect(moduleExports.jsonTypeModule).toBe(jsonTypeModule);
    expect(moduleExports.markdownTypeModule).toBe(markdownTypeModule);
    expect(moduleExports.moneyTypeModule).toBe(moneyTypeModule);
    expect(moduleExports.quantityTypeModule).toBe(quantityTypeModule);
    expect(moduleExports.rangeTypeModule).toBe(rangeTypeModule);
    expect(moduleExports.rateTypeModule).toBe(rateTypeModule);
    expect(moduleExports.svgTypeModule).toBe(svgTypeModule);
  });

  it("keeps contract probes root-safe without polluting the canonical module tree", () => {
    expect(probeContractGraph.contractItem.values.key).toBe(probeContractItem.values.key);
    expect(typeof probeContractGraph.contractItem.values.id).toBe("string");
    expect(String(probeContractItem.fields.parent.range)).toBe(resolvedTypeId(probeContractItem));
    expect(String(probeContractItem.fields.relatedItems.range)).toBe(
      resolvedTypeId(probeContractItem),
    );
    expect(probeContractObjectView).toMatchObject({
      entity: probeContractGraph.contractItem.values.key,
      commands: [probeSaveContractItemCommand.key],
    });
    expect(probeContractWorkflow).toMatchObject({
      subjects: [probeContractGraph.contractItem.values.key],
      commands: [probeSaveContractItemCommand.key],
    });
    expect("probeContractItem" in moduleExports).toBe(false);
    expect("probeContractObjectView" in moduleExports).toBe(false);
    expect("probeContractWorkflow" in moduleExports).toBe(false);
  });

  it("keeps migrated built-ins aligned with the canonical core namespace", () => {
    expect(dateTypeModule.type).toBe(core.date);
    expect(durationTypeModule.type).toBe(core.duration);
    expect(urlTypeModule.type).toBe(core.url);
    expect(emailTypeModule.type).toBe(core.email);
    expect(colorTypeModule.type).toBe(core.color);
    expect(jsonTypeModule.type).toBe(core.json);
    expect(markdownTypeModule.type).toBe(core.markdown);
    expect(moneyTypeModule.type).toBe(core.money);
    expect(svgTypeModule.type).toBe(core.svg);
    expect(percentTypeModule.type).toBe(core.percent);
    expect(quantityTypeModule.type).toBe(core.quantity);
    expect(rangeTypeModule.type).toBe(core.range);
    expect(rateTypeModule.type).toBe(core.rate);
    expect(tag).toBe(core.tag);
  });
});
