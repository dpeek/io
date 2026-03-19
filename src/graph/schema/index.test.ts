import { describe, expect, it } from "bun:test";

import {
  probeContractGraph,
  probeContractItem,
  probeContractObjectView,
  probeContractWorkflow,
  probeSaveContractItemCommand,
} from "../graph/contracts.probe.js";
import { core } from "../graph/index.js";
import { app as canonicalApp } from "./app.js";
import {
  envVar,
  envVarNameBlankMessage,
  envVarNameInvalidMessage,
  envVarNamePattern,
  envVarsSchema,
} from "./app/env-vars/index.js";
import { topic, topicKind, topicSchema } from "./app/topic/index.js";
import { core as canonicalCore } from "./core.js";
import { cardinality } from "./core/cardinality/index.js";
import { colorTypeModule } from "./core/color/index.js";
import { dateTypeModule } from "./core/date/index.js";
import { emailTypeModule } from "./core/email/index.js";
import { enumType } from "./core/enum/index.js";
import {
  graphIconSeeds,
  icon,
  iconReferenceField,
  resolvePredicateDefinitionIconId,
  resolveTypeDefinitionIconId,
} from "./core/icon/index.js";
import { jsonTypeModule } from "./core/json/index.js";
import { markdownTypeModule } from "./core/markdown/index.js";
import { node } from "./core/node/index.js";
import { predicate } from "./core/predicate/index.js";
import { secretHandle } from "./core/secret/index.js";
import { stringTypeModule } from "./core/string/index.js";
import { svgTypeModule } from "./core/svg/index.js";
import { tag } from "./core/tag/index.js";
import { coreType } from "./core/type/index.js";
import { urlTypeModule } from "./core/url/index.js";
import * as schemaExports from "./index.js";

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
    expect(colorTypeModule.type.values.key).toBe("core:color");
    expect(jsonTypeModule.type.values.key).toBe("core:json");
    expect(markdownTypeModule.type.values.key).toBe("core:markdown");
    expect(svgTypeModule.type.values.key).toBe("core:svg");
    expect(icon.values.key).toBe("core:icon");
    expect(tag.values.key).toBe("core:tag");
    expect(stringTypeModule.type.values.icon).toBe(graphIconSeeds.string);
    expect(resolveTypeDefinitionIconId(cardinality)).toBe(graphIconSeeds.tag.id);
    expect(resolvePredicateDefinitionIconId(node.fields.type, coreType)).toBe(
      graphIconSeeds.edge.id,
    );
  });

  it("defines canonical core and app namespaces from schema entrypoints", () => {
    expect(canonicalCore.node.values.key).toBe(node.values.key);
    expect(canonicalCore.string.values.key).toBe(stringTypeModule.type.values.key);
    expect(canonicalCore.color.values.key).toBe(colorTypeModule.type.values.key);
    expect(canonicalCore.json.values.key).toBe(jsonTypeModule.type.values.key);
    expect(canonicalCore.markdown.values.key).toBe(markdownTypeModule.type.values.key);
    expect(canonicalCore.svg.values.key).toBe(svgTypeModule.type.values.key);
    expect(canonicalCore.icon.values.key).toBe(icon.values.key);
    expect(canonicalCore.tag.values.key).toBe(tag.values.key);
    expect(canonicalCore.secretHandle.values.key).toBe(secretHandle.values.key);
    expect(String(canonicalCore.type.fields.icon.range)).toBe(resolvedTypeId(icon));
    expect(String(canonicalCore.predicate.fields.icon.range)).toBe(resolvedTypeId(icon));
    expect(canonicalApp.envVar.values.key).toBe(envVar.values.key);
    expect(canonicalApp.topic.values.key).toBe(topic.values.key);
    expect(canonicalApp.topicKind.values.key).toBe(topicKind.values.key);
  });

  it("exports the env-var slice from the canonical app schema tree", () => {
    expect(envVarsSchema).toEqual({
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
    expect(secretHandle.fields.version.authority).toEqual({
      visibility: "replicated",
      write: "server-command",
    });
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

  it("exports the topic slice from the canonical app schema tree", () => {
    expect(topicSchema).toEqual({
      topic,
      topicKind,
    });
    expect(String(topic.fields.kind.range)).toBe(resolvedTypeId(topicKind));
    expect(String(topic.fields.content.range)).toBe(resolvedTypeId(core.markdown));
    expect(String(topic.fields.tags.range)).toBe(resolvedTypeId(core.tag));
    expect(String(topic.fields.parent.range)).toBe(resolvedTypeId(topic));
    expect(topic.fields.parent.meta.reference).toEqual({
      selection: "existing-only",
      create: false,
      excludeSubject: true,
    });
    expect(String(topic.fields.references.range)).toBe(resolvedTypeId(topic));
  });

  it("keeps the schema root index wired to the new tree", () => {
    expect(schemaExports.node).toBe(node);
    expect(schemaExports.icon).toBe(icon);
    expect(schemaExports.iconReferenceField).toBe(iconReferenceField);
    expect(schemaExports.envVar).toBe(envVar);
    expect(schemaExports.secretHandle).toBe(secretHandle);
    expect(schemaExports.topic).toBe(topic);
    expect(schemaExports.topicKind).toBe(topicKind);
    expect(schemaExports.jsonTypeModule).toBe(jsonTypeModule);
    expect(schemaExports.markdownTypeModule).toBe(markdownTypeModule);
    expect(schemaExports.svgTypeModule).toBe(svgTypeModule);
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

  it("keeps migrated built-ins aligned with the canonical core namespace", () => {
    expect(dateTypeModule.type).toBe(core.date);
    expect(urlTypeModule.type).toBe(core.url);
    expect(emailTypeModule.type).toBe(core.email);
    expect(colorTypeModule.type).toBe(core.color);
    expect(jsonTypeModule.type).toBe(core.json);
    expect(markdownTypeModule.type).toBe(core.markdown);
    expect(svgTypeModule.type).toBe(core.svg);
    expect(tag).toBe(core.tag);
  });
});
