import { describe, expect, it } from "bun:test";

import { core as canonicalCore } from "./core.js";
import { cardinality } from "./core/cardinality.js";
import { colorTypeModule } from "./core/color.js";
import { dateTypeModule } from "./core/date.js";
import { durationTypeModule } from "./core/duration.js";
import { emailTypeModule } from "./core/email.js";
import { enumType } from "./core/enum.js";
import { icon, iconReferenceField } from "./core/icon.js";
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
} from "./core/identity.js";
import { jsonTypeModule } from "./core/json.js";
import { markdownTypeModule } from "./core/markdown.js";
import { moneyTypeModule } from "./core/money.js";
import { node } from "./core/node.js";
import { percentTypeModule } from "./core/percent.js";
import { predicate } from "./core/predicate.js";
import { quantityTypeModule } from "./core/quantity.js";
import { rangeTypeModule } from "./core/range.js";
import { rateTypeModule } from "./core/rate.js";
import {
  createSavedQueryDefinition,
  createSavedViewDefinition,
  readSavedQueryDefinition,
  savedQuery,
  savedQueryParameter,
  savedView,
} from "./core/saved-query.js";
import { secretHandle } from "./core/secret.js";
import { stringTypeModule } from "./core/string.js";
import { svgTypeModule } from "./core/svg.js";
import { tag } from "./core/tag.js";
import { coreType } from "./core/type.js";
import { urlTypeModule } from "./core/url.js";
import {
  coreBuiltInQuerySurfaceIds,
  coreBuiltInQuerySurfaces,
  coreCatalogModuleReadScope,
  coreModuleId,
  coreQuerySurfaceCatalog,
} from "./query.js";
import {
  resolveDefinitionIconId,
  resolvePredicateDefinitionIconId,
  resolveTypeDefinitionIconId,
} from "./icon/resolve.js";
import { unknownIconSeed } from "./icon/seed.js";
import * as moduleExports from "./index.js";

const requiredExports = [
  "address",
  "authSubjectProjection",
  "core",
  "coreGraphBootstrapOptions",
  "country",
  "currency",
  "defaultMoneyCurrencyKey",
  "coreBuiltInQuerySurfaceIds",
  "coreBuiltInQuerySurfaces",
  "coreCatalogModuleReadScope",
  "coreModuleId",
  "coreQuerySurfaceCatalog",
  "iconReferenceField",
  "moneyTypeModule",
  "normalizeMoneyInput",
  "principal",
  "readSavedQueryDefinition",
  "rangeTypeModule",
  "rateTypeModule",
  "resolveDefinitionIconId",
  "resolvePredicateDefinitionIconId",
  "resolveTypeDefinitionIconId",
  "savedQuery",
  "savedQueryParameter",
  "savedView",
  "secretHandle",
  "sanitizeSvgMarkup",
  "stringTypeModule",
  "structuredValueKindOptions",
  "structuredValueKinds",
  "tag",
  "unknownIconSeed",
] as const;

const forbiddenExports = [
  "FilterOperandEditor",
  "GraphIcon",
  "GraphRuntimeProvider",
  "graphIconSeedList",
  "graphIconSeeds",
  "OptionComboboxEditor",
  "PredicateFieldEditor",
  "PredicateFieldView",
  "SvgMarkup",
  "SvgPreview",
  "workflow",
] as const;

const replicatedServerCommandAuthority = {
  visibility: "replicated",
  write: "server-command",
} as const;

function resolvedTypeId(typeDef: { values: { key: string } }): string {
  const values = typeDef.values as { key: string; id?: string };
  return values.id ?? values.key;
}

function expectNamedExports(
  exportsObject: Record<string, unknown>,
  names: readonly string[],
): void {
  const exportNames = Object.keys(exportsObject);
  for (const name of names) {
    expect(exportNames).toContain(name);
  }
}

describe("@io/graph-module-core", () => {
  it("keeps the package surface focused on the built-in core namespace", async () => {
    const packageExports = await import("@io/graph-module-core");

    expectNamedExports(packageExports, requiredExports);
    for (const name of forbiddenExports) {
      expect(Object.keys(packageExports)).not.toContain(name);
    }
  });

  it("keeps built-in modules aligned with the canonical core contracts", () => {
    expect(node).toBe(canonicalCore.node);
    expect(coreType).toBe(canonicalCore.type);
    expect(cardinality).toBe(canonicalCore.cardinality);
    expect(predicate).toBe(canonicalCore.predicate);
    expect(enumType).toBe(canonicalCore.enum);
    expect(stringTypeModule.type.values.key).toBe("core:string");
    expect(dateTypeModule.type).toBe(canonicalCore.date);
    expect(urlTypeModule.type).toBe(canonicalCore.url);
    expect(emailTypeModule.type).toBe(canonicalCore.email);
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
    expect(savedQuery.values.key).toBe("core:savedQuery");
    expect(savedQueryParameter.values.key).toBe("core:savedQueryParameter");
    expect(savedView.values.key).toBe("core:savedView");
    expect(resolveDefinitionIconId(stringTypeModule.type.values.icon)).toBe("seed:icon:string");
    expect(resolveTypeDefinitionIconId(cardinality)).toBe(resolveDefinitionIconId(tag.values.icon));
    expect(resolvePredicateDefinitionIconId(node.fields.type, coreType)).toBe(
      resolveDefinitionIconId(predicate.values.icon),
    );
    expect(resolveTypeDefinitionIconId(coreType)).toBe(unknownIconSeed.id);
  });

  it("defines the canonical core namespace from package entrypoints", () => {
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
    expect(canonicalCore.savedQuery.values.key).toBe(savedQuery.values.key);
    expect(canonicalCore.savedQueryParameter.values.key).toBe(savedQueryParameter.values.key);
    expect(canonicalCore.savedView.values.key).toBe(savedView.values.key);
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
  });

  it("publishes one bounded core-owned query surface for shared serialized-query dispatch", () => {
    expect(coreModuleId).toBe("core");
    expect(coreCatalogModuleReadScope).toEqual({
      kind: "module",
      moduleId: "core",
      scopeId: "scope:core:catalog",
      definitionHash: "scope-def:core:catalog:v1",
    });
    expect(coreQuerySurfaceCatalog).toMatchObject({
      catalogId: "core:query-surfaces",
      catalogVersion: "query-catalog:core:v1",
      moduleId: "core",
      surfaces: expect.any(Array),
    });
    expect(coreBuiltInQuerySurfaces).toEqual({
      catalogScope: {
        surfaceId: coreCatalogModuleReadScope.scopeId,
        surfaceVersion: "query-surface:core:catalog-scope:v1",
        queryKind: "scope",
        source: {
          kind: "scope",
          scopeId: coreCatalogModuleReadScope.scopeId,
        },
        label: "Core Catalog Scope",
        description: expect.any(String),
        renderers: {
          compatibleRendererIds: ["core:list", "core:table"],
          itemEntityIds: "required",
          resultKind: "scope",
          sourceKinds: ["saved", "inline"],
        },
      },
    });
    expect(coreBuiltInQuerySurfaceIds).toEqual({
      catalogScope: coreCatalogModuleReadScope.scopeId,
    });
  });

  it("freezes the shared secret-handle contract on the canonical core namespace", () => {
    expect(canonicalCore.secretHandle.values).toMatchObject({
      key: "core:secretHandle",
      name: "Secret Handle",
    });
    expect(resolveDefinitionIconId(canonicalCore.secretHandle.values.icon)).toBe(
      "seed:icon:secret",
    );
    expect(String(canonicalCore.secretHandle.fields.version.range)).toBe(
      resolvedTypeId(canonicalCore.number),
    );
    expect(String(canonicalCore.secretHandle.fields.lastRotatedAt.range)).toBe(
      resolvedTypeId(canonicalCore.date),
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

  it("exposes canonical namespaces and representative built-ins from the package root", () => {
    expectNamedExports(moduleExports, [
      "core",
      "coreBuiltInQuerySurfaceIds",
      "coreBuiltInQuerySurfaces",
      "coreCatalogModuleReadScope",
      "coreModuleId",
      "coreQuerySurfaceCatalog",
      "node",
      "icon",
      "iconReferenceField",
      "secretHandle",
      "principal",
      "authSubjectProjection",
      "principalRoleBinding",
      "jsonTypeModule",
      "markdownTypeModule",
      "moneyTypeModule",
      "quantityTypeModule",
      "rangeTypeModule",
      "rateTypeModule",
      "svgTypeModule",
    ]);

    expect(moduleExports.core).toBe(canonicalCore);
    expect(moduleExports.coreModuleId).toBe(coreModuleId);
    expect(moduleExports.coreCatalogModuleReadScope).toBe(coreCatalogModuleReadScope);
    expect(moduleExports.coreQuerySurfaceCatalog).toBe(coreQuerySurfaceCatalog);
    expect(moduleExports.coreBuiltInQuerySurfaces).toBe(coreBuiltInQuerySurfaces);
    expect(moduleExports.coreBuiltInQuerySurfaceIds).toBe(coreBuiltInQuerySurfaceIds);
    expect(moduleExports.node.values.key).toBe(canonicalCore.node.values.key);
    expect(moduleExports.icon.values.key).toBe(canonicalCore.icon.values.key);
    expect(moduleExports.iconReferenceField).toBe(iconReferenceField);
    expect(moduleExports.secretHandle.values.key).toBe(canonicalCore.secretHandle.values.key);
    expect(moduleExports.savedQuery.values.key).toBe(canonicalCore.savedQuery.values.key);
    expect(moduleExports.savedQueryParameter.values.key).toBe(
      canonicalCore.savedQueryParameter.values.key,
    );
    expect(moduleExports.savedView.values.key).toBe(canonicalCore.savedView.values.key);
    expect(moduleExports.createSavedQueryDefinition).toBe(createSavedQueryDefinition);
    expect(moduleExports.createSavedViewDefinition).toBe(createSavedViewDefinition);
    expect(moduleExports.readSavedQueryDefinition).toBe(readSavedQueryDefinition);
    expect(moduleExports.principal.values.key).toBe(canonicalCore.principal.values.key);
    expect(moduleExports.authSubjectProjection.values.key).toBe(
      canonicalCore.authSubjectProjection.values.key,
    );
    expect(moduleExports.principalRoleBinding.values.key).toBe(
      canonicalCore.principalRoleBinding.values.key,
    );
    expect(moduleExports.jsonTypeModule).toBe(jsonTypeModule);
    expect(moduleExports.markdownTypeModule).toBe(markdownTypeModule);
    expect(moduleExports.moneyTypeModule).toBe(moneyTypeModule);
    expect(moduleExports.quantityTypeModule).toBe(quantityTypeModule);
    expect(moduleExports.rangeTypeModule).toBe(rangeTypeModule);
    expect(moduleExports.rateTypeModule).toBe(rateTypeModule);
    expect(moduleExports.svgTypeModule).toBe(svgTypeModule);
    expect(typeof moduleExports.core.node.values.id).toBe("string");
    expect(typeof moduleExports.core.principal.values.id).toBe("string");
    expect("defineDefaultEnumTypeModule" in moduleExports).toBe(false);
    expect("defineValidatedStringTypeModule" in moduleExports).toBe(false);
  });

  it("keeps migrated built-ins aligned with the canonical core namespace", () => {
    expect(dateTypeModule.type).toBe(moduleExports.core.date);
    expect(durationTypeModule.type).toBe(moduleExports.core.duration);
    expect(urlTypeModule.type).toBe(moduleExports.core.url);
    expect(emailTypeModule.type).toBe(moduleExports.core.email);
    expect(colorTypeModule.type).toBe(moduleExports.core.color);
    expect(jsonTypeModule.type).toBe(moduleExports.core.json);
    expect(markdownTypeModule.type).toBe(moduleExports.core.markdown);
    expect(moneyTypeModule.type).toBe(moduleExports.core.money);
    expect(svgTypeModule.type).toBe(moduleExports.core.svg);
    expect(percentTypeModule.type).toBe(moduleExports.core.percent);
    expect(quantityTypeModule.type).toBe(moduleExports.core.quantity);
    expect(rangeTypeModule.type).toBe(moduleExports.core.range);
    expect(rateTypeModule.type).toBe(moduleExports.core.rate);
    expect(tag).toBe(moduleExports.core.tag);
  });
});
