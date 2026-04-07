import { edgeId } from "@io/app/graph";
import { core } from "@io/graph-module-core";

import { flattenPredicateRefs } from "./explorer/catalog.js";
import {
  createdAtPredicateId,
  type AnyEntityRef,
  type AnyPredicateRef,
  typePredicateId,
  updatedAtPredicateId,
} from "./explorer/model.js";

export type EntitySurfaceMode = "view" | "edit";
export type EntitySurfaceModeValue<T> = T | Partial<Record<EntitySurfaceMode, T>>;
export type EntitySurfaceRowRole = "title" | "body" | "meta" | "hidden";
export type EntitySurfaceLabelVisibilityPolicy = "show" | "hide" | "auto";
export type EntitySurfaceDescriptionVisibilityPolicy = "show" | "hide" | "auto";
export type EntitySurfaceValidationPlacementPolicy = "inline" | "summary-only" | "auto";

export type EntitySurfaceRowChrome = {
  descriptionVisibility: EntitySurfaceDescriptionVisibilityPolicy;
  labelVisibility: EntitySurfaceLabelVisibilityPolicy;
  validationPlacement: EntitySurfaceValidationPlacementPolicy;
};

export type EntitySurfaceValueRowPlan = {
  chrome: EntitySurfaceRowChrome;
  kind: "value";
  pathLabel: string;
  role: EntitySurfaceRowRole;
};

export type EntitySurfacePredicateRowPlan<P = unknown> = {
  chrome: EntitySurfaceRowChrome;
  kind: "predicate";
  pathLabel: string;
  predicate: P;
  predicateId: string;
  role: EntitySurfaceRowRole;
};

export type EntitySurfaceRowPlan<P = unknown> =
  | EntitySurfacePredicateRowPlan<P>
  | EntitySurfaceValueRowPlan;

export type EntitySurfacePlan<P = unknown> = {
  mode: EntitySurfaceMode;
  rows: readonly EntitySurfaceRowPlan<P>[];
};

type EntitySurfaceRowCandidate<P = unknown> =
  | {
      kind: "predicate";
      pathLabel: string;
      predicate: P;
      predicateId: string;
    }
  | {
      kind: "value";
      pathLabel: string;
    };

const namePredicateId = edgeId(core.node.fields.name);
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

function resolveLiveEntityRowRole(
  candidate: EntitySurfaceRowCandidate,
  mode: EntitySurfaceMode,
): EntitySurfaceRowRole {
  if (candidate.kind === "value") return "hidden";

  if (candidate.predicateId === typePredicateId || candidate.predicateId === createdAtPredicateId) {
    return "hidden";
  }

  if (candidate.predicateId === updatedAtPredicateId) {
    return "meta";
  }

  if (candidate.predicateId === namePredicateId) {
    return mode === "view" ? "title" : "body";
  }

  return "body";
}

function resolveDraftEntityRowRole(
  candidate: EntitySurfaceRowCandidate,
  mode: EntitySurfaceMode,
): EntitySurfaceRowRole {
  if (candidate.kind === "value") return "hidden";
  if (candidate.predicateId === namePredicateId) {
    return mode === "view" ? "title" : "body";
  }
  return "body";
}

function planEntitySurfaceRow<P>(
  candidate: EntitySurfaceRowCandidate<P>,
  mode: EntitySurfaceMode,
  resolveRole: (
    candidate: EntitySurfaceRowCandidate<P>,
    mode: EntitySurfaceMode,
  ) => EntitySurfaceRowRole,
): EntitySurfaceRowPlan<P> {
  const role = resolveRole(candidate, mode);
  const base = {
    chrome: getDefaultChrome(role),
    pathLabel: candidate.pathLabel,
    role,
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

function buildEntitySurfacePlan<P>(
  candidates: readonly EntitySurfaceRowCandidate<P>[],
  options: {
    mode?: EntitySurfaceMode;
  } = {},
  resolveRole: (
    candidate: EntitySurfaceRowCandidate<P>,
    mode: EntitySurfaceMode,
  ) => EntitySurfaceRowRole,
): EntitySurfacePlan<P> {
  const mode = options.mode ?? "view";
  const rows = candidates
    .map((candidate, index) => ({
      index,
      row: planEntitySurfaceRow(candidate, mode, resolveRole),
    }))
    .sort(
      (left, right) =>
        roleSortOrder[left.row.role] - roleSortOrder[right.row.role] || left.index - right.index,
    )
    .map(({ row }) => row);

  return {
    mode,
    rows,
  };
}

export function buildLiveEntitySurfacePlan(
  entity: AnyEntityRef,
  options: {
    mode?: EntitySurfaceMode;
  } = {},
): EntitySurfacePlan<AnyPredicateRef> {
  const candidates: EntitySurfaceRowCandidate<AnyPredicateRef>[] = [
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
  options: {
    mode?: EntitySurfaceMode;
  } = {},
): EntitySurfacePlan<AnyPredicateRef> {
  const predicateByPath = new Map(
    flattenPredicateRefs(fields).map((row) => [row.pathLabel, row.predicate]),
  );
  const candidates = visiblePathLabels.flatMap((pathLabel) => {
    const predicate = predicateByPath.get(pathLabel);
    return predicate
      ? [
          {
            kind: "predicate" as const,
            pathLabel,
            predicate,
            predicateId: predicate.predicateId,
          },
        ]
      : [];
  });

  return buildEntitySurfacePlan(candidates, options, resolveDraftEntityRowRole);
}
