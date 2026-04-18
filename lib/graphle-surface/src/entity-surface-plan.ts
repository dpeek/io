import { isFieldGroupRef, type EntityRef, type PredicateRef } from "@dpeek/graphle-client";
import { edgeId } from "@dpeek/graphle-kernel";
import type { RecordSurfaceFieldSpec, RecordSurfaceSpec } from "@dpeek/graphle-module";
import { core } from "@dpeek/graphle-module-core";

export type AnyEntitySurfaceEntityRef = EntityRef<any, any>;
export type AnyEntitySurfacePredicateRef = PredicateRef<any, any>;
export type EntitySurfaceMode = "view" | "edit";
export type EntitySurfaceModeValue<T> = T | Partial<Record<EntitySurfaceMode, T>>;
export type EntitySurfaceRowRole = "title" | "body" | "meta" | "hidden";
export type EntitySurfaceLabelVisibilityPolicy = "show" | "hide" | "auto";
export type EntitySurfaceDescriptionVisibilityPolicy = "show" | "hide" | "auto";
export type EntitySurfaceValidationPlacementPolicy = "inline" | "summary-only" | "auto";

export type EntitySurfaceRowChrome = {
  readonly descriptionVisibility: EntitySurfaceDescriptionVisibilityPolicy;
  readonly labelVisibility: EntitySurfaceLabelVisibilityPolicy;
  readonly validationPlacement: EntitySurfaceValidationPlacementPolicy;
};

export type EntitySurfaceSectionMetadata = {
  readonly description?: string;
  readonly key: string;
  readonly title: string;
};

export type EntitySurfaceValueRowPlan = {
  readonly chrome: EntitySurfaceRowChrome;
  readonly description?: string;
  readonly kind: "value";
  readonly pathLabel: string;
  readonly role: EntitySurfaceRowRole;
  readonly section?: EntitySurfaceSectionMetadata;
  readonly title?: string;
};

export type EntitySurfacePredicateRowPlan<P = unknown> = {
  readonly chrome: EntitySurfaceRowChrome;
  readonly description?: string;
  readonly kind: "predicate";
  readonly pathLabel: string;
  readonly predicate: P;
  readonly predicateId: string;
  readonly role: EntitySurfaceRowRole;
  readonly section?: EntitySurfaceSectionMetadata;
  readonly title?: string;
};

export type EntitySurfaceRowPlan<P = unknown> =
  | EntitySurfacePredicateRowPlan<P>
  | EntitySurfaceValueRowPlan;

export type EntitySurfaceSectionPlan<P = unknown> = EntitySurfaceSectionMetadata & {
  readonly rows: readonly EntitySurfaceRowPlan<P>[];
};

export type EntitySurfacePlan<P = unknown> = {
  readonly mode: EntitySurfaceMode;
  readonly rows: readonly EntitySurfaceRowPlan<P>[];
  readonly sections: readonly EntitySurfaceSectionPlan<P>[];
};

export type PredicateFieldEntry<P = AnyEntitySurfacePredicateRef> = {
  readonly pathLabel: string;
  readonly predicate: P;
};

type EntitySurfaceRowCandidate<P = unknown> =
  | {
      readonly description?: string;
      readonly kind: "predicate";
      readonly pathLabel: string;
      readonly predicate: P;
      readonly predicateId: string;
      readonly section?: EntitySurfaceSectionMetadata;
      readonly title?: string;
    }
  | {
      readonly description?: string;
      readonly kind: "value";
      readonly pathLabel: string;
      readonly section?: EntitySurfaceSectionMetadata;
      readonly title?: string;
    };

type BuildEntitySurfacePlanOptions = {
  readonly mode?: EntitySurfaceMode;
  readonly surface?: RecordSurfaceSpec;
};

const fallbackSection: EntitySurfaceSectionMetadata = {
  key: "fields",
  title: "Fields",
};

export const defaultEntitySurfaceCorePredicateIds = {
  createdAt: edgeId(core.node.fields.createdAt),
  name: edgeId(core.node.fields.name),
  type: edgeId(core.node.fields.type),
  updatedAt: edgeId(core.node.fields.updatedAt),
} as const;

const roleSortOrder: Record<EntitySurfaceRowRole, number> = {
  title: 0,
  body: 1,
  meta: 2,
  hidden: 3,
};

function getDefaultChrome(role: EntitySurfaceRowRole): EntitySurfaceRowChrome {
  if (role === "title") {
    return {
      descriptionVisibility: "hide",
      labelVisibility: "hide",
      validationPlacement: "summary-only",
    };
  }

  if (role === "meta") {
    return {
      descriptionVisibility: "hide",
      labelVisibility: "show",
      validationPlacement: "summary-only",
    };
  }

  if (role === "hidden") {
    return {
      descriptionVisibility: "hide",
      labelVisibility: "hide",
      validationPlacement: "summary-only",
    };
  }

  return {
    descriptionVisibility: "auto",
    labelVisibility: "auto",
    validationPlacement: "inline",
  };
}

function isPredicateRef(value: unknown): value is AnyEntitySurfacePredicateRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AnyEntitySurfacePredicateRef>;
  return typeof candidate.predicateId === "string" && typeof candidate.get === "function";
}

export function flattenPredicateRefs<P = AnyEntitySurfacePredicateRef>(
  node: Record<string, unknown>,
  path: string[] = [],
  out: PredicateFieldEntry<P>[] = [],
): PredicateFieldEntry<P>[] {
  for (const [fieldName, value] of Object.entries(node)) {
    if (isPredicateRef(value)) {
      out.push({
        pathLabel: [...path, fieldName].join("."),
        predicate: value as P,
      });
      continue;
    }

    if (!isFieldGroupRef(value)) continue;
    flattenPredicateRefs(value as Record<string, unknown>, [...path, fieldName], out);
  }

  return out;
}

function sectionMetadataFromSurface(
  surface: RecordSurfaceSpec,
): Map<string, EntitySurfaceSectionMetadata> {
  return new Map(
    surface.sections.map((section) => [
      section.key,
      {
        ...(section.description ? { description: section.description } : {}),
        key: section.key,
        title: section.title,
      },
    ]),
  );
}

function metadataFromFieldSpec(field: RecordSurfaceFieldSpec): {
  readonly description?: string;
  readonly title?: string;
} {
  return {
    ...(field.description ? { description: field.description } : {}),
    ...(field.label ? { title: field.label } : {}),
  };
}

function buildAuthoredCandidates<P>(
  candidates: readonly EntitySurfaceRowCandidate<P>[],
  surface: RecordSurfaceSpec | undefined,
): EntitySurfaceRowCandidate<P>[] {
  if (!surface) return [...candidates];

  const predicateByPath = new Map(candidates.map((candidate) => [candidate.pathLabel, candidate]));
  const sectionByKey = sectionMetadataFromSurface(surface);
  const seen = new Set<string>();
  const ordered: EntitySurfaceRowCandidate<P>[] = [];

  for (const section of surface.sections) {
    const sectionMetadata = sectionByKey.get(section.key) ?? {
      key: section.key,
      title: section.title,
    };
    for (const field of section.fields) {
      const candidate = predicateByPath.get(field.path);
      if (!candidate) continue;
      seen.add(field.path);
      ordered.push({
        ...candidate,
        ...metadataFromFieldSpec(field),
        section: sectionMetadata,
      });
    }
  }

  for (const fieldPath of [surface.titleField, surface.subtitleField]) {
    if (!fieldPath || seen.has(fieldPath)) continue;
    const candidate = predicateByPath.get(fieldPath);
    if (!candidate) continue;
    seen.add(fieldPath);
    ordered.push({
      ...candidate,
      section: fallbackSection,
    });
  }

  const hiddenSystemCandidates = candidates.filter((candidate) => {
    if (seen.has(candidate.pathLabel)) return false;
    if (candidate.kind === "value") return true;
    return (
      candidate.predicateId === defaultEntitySurfaceCorePredicateIds.type ||
      candidate.predicateId === defaultEntitySurfaceCorePredicateIds.createdAt ||
      candidate.predicateId === defaultEntitySurfaceCorePredicateIds.updatedAt
    );
  });

  return [...ordered, ...hiddenSystemCandidates];
}

function resolveLiveEntityRowRole(
  candidate: EntitySurfaceRowCandidate,
  mode: EntitySurfaceMode,
  surface?: RecordSurfaceSpec,
): EntitySurfaceRowRole {
  if (candidate.kind === "value") return "hidden";

  if (
    candidate.predicateId === defaultEntitySurfaceCorePredicateIds.type ||
    candidate.predicateId === defaultEntitySurfaceCorePredicateIds.createdAt
  ) {
    return "hidden";
  }

  if (candidate.predicateId === defaultEntitySurfaceCorePredicateIds.updatedAt) {
    return "meta";
  }

  if (surface?.titleField === candidate.pathLabel) {
    return mode === "view" ? "title" : "body";
  }

  if (surface?.subtitleField === candidate.pathLabel) {
    return "meta";
  }

  if (candidate.predicateId === defaultEntitySurfaceCorePredicateIds.name) {
    return mode === "view" ? "title" : "body";
  }

  return "body";
}

function resolveDraftEntityRowRole(
  candidate: EntitySurfaceRowCandidate,
  mode: EntitySurfaceMode,
  surface?: RecordSurfaceSpec,
): EntitySurfaceRowRole {
  if (candidate.kind === "value") return "hidden";

  if (surface?.titleField === candidate.pathLabel) {
    return mode === "view" ? "title" : "body";
  }

  if (surface?.subtitleField === candidate.pathLabel) {
    return "meta";
  }

  if (candidate.predicateId === defaultEntitySurfaceCorePredicateIds.name) {
    return mode === "view" ? "title" : "body";
  }

  return "body";
}

function planEntitySurfaceRow<P>(
  candidate: EntitySurfaceRowCandidate<P>,
  mode: EntitySurfaceMode,
  surface: RecordSurfaceSpec | undefined,
  resolveRole: (
    candidate: EntitySurfaceRowCandidate<P>,
    mode: EntitySurfaceMode,
    surface?: RecordSurfaceSpec,
  ) => EntitySurfaceRowRole,
): EntitySurfaceRowPlan<P> {
  const role = resolveRole(candidate, mode, surface);
  const base = {
    chrome: getDefaultChrome(role),
    ...(candidate.description ? { description: candidate.description } : {}),
    pathLabel: candidate.pathLabel,
    role,
    ...(candidate.section ? { section: candidate.section } : {}),
    ...(candidate.title ? { title: candidate.title } : {}),
  } as const;

  if (candidate.kind === "value") {
    return {
      ...base,
      kind: "value",
    };
  }

  return {
    ...base,
    kind: "predicate",
    predicate: candidate.predicate,
    predicateId: candidate.predicateId,
  };
}

function createPlanSections<P>(
  rows: readonly EntitySurfaceRowPlan<P>[],
  surface?: RecordSurfaceSpec,
): EntitySurfaceSectionPlan<P>[] {
  const sectionOrder =
    surface && surface.sections.length > 0
      ? surface.sections.map((section) => ({
          ...(section.description ? { description: section.description } : {}),
          key: section.key,
          title: section.title,
        }))
      : [fallbackSection];
  const sections = new Map<string, EntitySurfaceSectionPlan<P>>();

  for (const section of sectionOrder) {
    sections.set(section.key, {
      ...section,
      rows: [],
    });
  }

  for (const row of rows) {
    const section = row.section ?? fallbackSection;
    const current =
      sections.get(section.key) ??
      ({
        ...section,
        rows: [],
      } satisfies EntitySurfaceSectionPlan<P>);
    sections.set(section.key, {
      ...current,
      rows: [...current.rows, row],
    });
  }

  return [...sections.values()].filter((section) =>
    section.rows.some((row) => row.role !== "hidden"),
  );
}

function buildEntitySurfacePlan<P>(
  candidates: readonly EntitySurfaceRowCandidate<P>[],
  options: BuildEntitySurfacePlanOptions,
  resolveRole: (
    candidate: EntitySurfaceRowCandidate<P>,
    mode: EntitySurfaceMode,
    surface?: RecordSurfaceSpec,
  ) => EntitySurfaceRowRole,
): EntitySurfacePlan<P> {
  const mode = options.mode ?? "view";
  const orderedCandidates = buildAuthoredCandidates(candidates, options.surface);
  const rows = orderedCandidates
    .map((candidate, index) => ({
      index,
      row: planEntitySurfaceRow(candidate, mode, options.surface, resolveRole),
    }))
    .sort(
      (left, right) =>
        roleSortOrder[left.row.role] - roleSortOrder[right.row.role] || left.index - right.index,
    )
    .map(({ row }) => row);

  return {
    mode,
    rows,
    sections: createPlanSections(rows, options.surface),
  };
}

export function buildLiveEntitySurfacePlan(
  entity: AnyEntitySurfaceEntityRef,
  options: BuildEntitySurfacePlanOptions = {},
): EntitySurfacePlan<AnyEntitySurfacePredicateRef> {
  const candidates: EntitySurfaceRowCandidate<AnyEntitySurfacePredicateRef>[] = [
    { kind: "value", pathLabel: "id" },
    ...flattenPredicateRefs(entity.fields as Record<string, unknown>).map((row) => ({
      kind: "predicate" as const,
      pathLabel: row.pathLabel,
      predicate: row.predicate,
      predicateId: row.predicate.predicateId,
    })),
  ];

  return buildEntitySurfacePlan(candidates, options, resolveLiveEntityRowRole);
}

export function buildDraftEntitySurfacePlan(
  fields: Record<string, unknown>,
  visiblePathLabels: readonly string[],
  options: BuildEntitySurfacePlanOptions = {},
): EntitySurfacePlan<AnyEntitySurfacePredicateRef> {
  const visiblePaths = new Set(visiblePathLabels);
  const candidates = flattenPredicateRefs(fields)
    .filter((row) => visiblePaths.has(row.pathLabel))
    .map((row) => ({
      kind: "predicate" as const,
      pathLabel: row.pathLabel,
      predicate: row.predicate,
      predicateId: row.predicate.predicateId,
    }));

  return buildEntitySurfacePlan(candidates, options, resolveDraftEntityRowRole);
}
