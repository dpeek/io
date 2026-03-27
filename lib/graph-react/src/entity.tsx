import {
  isFieldGroupRef,
  type EntityRef,
  type PredicateRangeTypeOf,
  type PredicateRef,
  type PredicateValueOf,
} from "@io/graph-client";
import {
  isEntityType,
  type AnyTypeOutput,
  type EdgeOutput,
  type TypeOutput,
} from "@io/graph-kernel";
import { Fragment, useMemo, type ReactNode } from "react";

import { usePredicateValue } from "./predicate.js";

type StringKeys<T> = Extract<keyof T, string>;

type PredicateRefsInTree<Tree, Defs extends Record<string, AnyTypeOutput>> =
  Tree extends PredicateRef<infer Field, Defs>
    ? PredicateRef<Field, Defs>
    : Tree extends object
      ? {
          [Key in StringKeys<Tree>]: PredicateRefsInTree<Tree[Key], Defs>;
        }[StringKeys<Tree>]
      : never;

type EntityRangeType<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>> = Extract<
  NonNullable<PredicateRangeTypeOf<T, Defs>>,
  TypeOutput
>;

export type EntityPredicateRef<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = PredicateRefsInTree<EntityRef<T, Defs>["fields"], Defs>;

export type EntityPredicateEntry<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  path: readonly string[];
  pathLabel: string;
  predicate: EntityPredicateRef<T, Defs>;
};

export type EntityRangePredicateRef<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = [EntityRangeType<T, Defs>] extends [never] ? never : PredicateRef<T, Defs>;

export type PredicateRelatedEntityRef<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = [EntityRangeType<T, Defs>] extends [never] ? never : EntityRef<EntityRangeType<T, Defs>, Defs>;

export type PredicateRelatedEntityEntry<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  entity: PredicateRelatedEntityRef<T, Defs>;
  id: string;
};

export type EntityPredicatesProps<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  children: (entry: EntityPredicateEntry<T, Defs>, index: number) => ReactNode;
  entity: EntityRef<T, Defs>;
  filter?: (entry: EntityPredicateEntry<T, Defs>, index: number) => boolean;
};

export type PredicateRelatedEntitiesProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  children: (entry: PredicateRelatedEntityEntry<T, Defs>, index: number) => ReactNode;
  filter?: (entry: PredicateRelatedEntityEntry<T, Defs>, index: number) => boolean;
  predicate: EntityRangePredicateRef<T, Defs>;
};

function isPredicateRef<Defs extends Record<string, AnyTypeOutput>>(
  value: unknown,
): value is PredicateRef<EdgeOutput, Defs> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PredicateRef<EdgeOutput, Defs>>;
  return typeof candidate.predicateId === "string" && typeof candidate.get === "function";
}

function appendEntityPredicateEntries<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(
  node: Record<string, unknown>,
  path: string[],
  out: EntityPredicateEntry<T, Defs>[],
): EntityPredicateEntry<T, Defs>[] {
  for (const [fieldName, value] of Object.entries(node)) {
    const nextPath = [...path, fieldName];

    if (isPredicateRef<Defs>(value)) {
      out.push({
        path: nextPath,
        pathLabel: nextPath.join("."),
        predicate: value as EntityPredicateEntry<T, Defs>["predicate"],
      });
      continue;
    }

    if (!isFieldGroupRef(value)) continue;
    appendEntityPredicateEntries<T, Defs>(value as Record<string, unknown>, nextPath, out);
  }

  return out;
}

function selectedEntityIds<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
  value: PredicateValueOf<T, Defs>,
): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return typeof value === "string" ? [value] : [];
}

export function useEntityPredicateEntries<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(entity: EntityRef<T, Defs>): readonly EntityPredicateEntry<T, Defs>[] {
  return useMemo(
    () => appendEntityPredicateEntries<T, Defs>(entity.fields as Record<string, unknown>, [], []),
    [entity],
  );
}

export function EntityPredicates<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>>({
  children,
  entity,
  filter,
}: EntityPredicatesProps<T, Defs>) {
  const entries = useEntityPredicateEntries(entity);

  return (
    <>
      {entries.map((entry, index) =>
        filter && !filter(entry, index) ? null : (
          <Fragment key={entry.pathLabel}>{children(entry, index)}</Fragment>
        ),
      )}
    </>
  );
}

export function usePredicateRelatedEntities<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(predicate: EntityRangePredicateRef<T, Defs>): readonly PredicateRelatedEntityEntry<T, Defs>[] {
  const value = usePredicateValue(predicate);

  return useMemo(() => {
    if (!predicate.rangeType || !isEntityType(predicate.rangeType)) return [];

    return selectedEntityIds<T, Defs>(value).flatMap((id) => {
      const entity = predicate.resolveEntity(id);
      if (!entity) return [];
      return [{ entity: entity as PredicateRelatedEntityRef<T, Defs>, id }];
    });
  }, [predicate, value]);
}

export function PredicateRelatedEntities<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>({ children, filter, predicate }: PredicateRelatedEntitiesProps<T, Defs>) {
  const entries = usePredicateRelatedEntities(predicate);

  return (
    <>
      {entries.map((entry, index) =>
        filter && !filter(entry, index) ? null : (
          <Fragment key={`${entry.id}:${index}`}>{children(entry, index)}</Fragment>
        ),
      )}
    </>
  );
}
