import type { EntityRef, GraphMutationValidationResult, PredicateRef } from "@io/graph-client";
import { defineEnum, defineType, type AnyTypeOutput } from "@io/graph-kernel";
import { existingEntityReferenceFieldMeta } from "@io/graph-module";
import type { QueryLiteral } from "@io/graph-client";
import type { QuerySurfaceFieldKind } from "@io/graph-projection";
import { useRef } from "react";

import { PredicateFieldEditor } from "./resolver.js";
import {
  decodeQueryEditorFieldValueForEditor,
  encodeQueryEditorFieldValueFromEditor,
  getQueryEditorFieldModuleForKind,
  isQueryEditorFieldKindSupported,
} from "./query-editor-value-semantics.js";

type QueryEditorOption = {
  readonly label: string;
  readonly value: string;
};

type QueryEditorPredicateFieldProps = {
  readonly kind: QuerySurfaceFieldKind;
  readonly label: string;
  readonly options?: readonly QueryEditorOption[];
  readonly optional?: boolean;
  readonly path: string;
  readonly rawValue: QueryLiteral | undefined;
  readonly onChange: (value: QueryLiteral | undefined) => void;
};

type MutablePredicateState = {
  field: {
    cardinality: "one" | "one?";
    key: string;
    meta?: Record<string, unknown>;
    range: string;
  };
  kind: QuerySurfaceFieldKind;
  onChange: (value: QueryLiteral | undefined) => void;
  rangeType: AnyTypeOutput | undefined;
  rawValue: QueryLiteral | undefined;
  entities: readonly EntityRef<any, any>[];
  entityById: ReadonlyMap<string, EntityRef<any, any>>;
  optional: boolean;
};

function createValidationSuccess(): GraphMutationValidationResult {
  return {
    changedPredicateKeys: [],
    event: "update",
    ok: true,
    phase: "local",
    value: {},
  };
}

function createDeleteValidationSuccess() {
  return {
    changedPredicateKeys: [],
    event: "delete",
    ok: true,
    phase: "local",
    value: "",
  } as const;
}

function createValidationFailure(path: string, message: string): GraphMutationValidationResult {
  return {
    changedPredicateKeys: [],
    event: "update",
    issues: [
      {
        code: "query-editor.invalid-value",
        message,
        nodeId: `query-editor:${path}`,
        path: [path],
        predicateKey: path,
        source: "field",
      },
    ],
    ok: false,
    phase: "local",
    value: {},
  };
}

const fallbackEntityType = defineType({
  fields: {},
  values: {
    key: "query:entity",
    name: "Query Entity",
  },
});

function createFallbackEntityRef(
  id: string,
  rangeType: AnyTypeOutput | undefined,
): EntityRef<any, any> {
  return {
    batch<TResult>(fn: () => TResult) {
      return fn();
    },
    delete() {},
    fields: {} as never,
    get() {
      return {
        id,
        name: id,
        ...(rangeType ? { type: [rangeType.values.key] } : {}),
      };
    },
    id,
    type: (rangeType ?? fallbackEntityType) as never,
    update() {
      return {
        id,
        name: id,
        ...(rangeType ? { type: [rangeType.values.key] } : {}),
      };
    },
    validateDelete() {
      return createDeleteValidationSuccess();
    },
    validateUpdate() {
      return createValidationSuccess();
    },
  } as unknown as EntityRef<any, any>;
}

function createEntityOptionRef(
  option: QueryEditorOption,
  rangeType: AnyTypeOutput,
): EntityRef<any, any> {
  return {
    batch<TResult>(fn: () => TResult) {
      return fn();
    },
    delete() {},
    fields: {} as never,
    get() {
      return {
        id: option.value,
        name: option.label,
        type: [rangeType.values.key],
      };
    },
    id: option.value,
    type: rangeType as never,
    update() {
      return {
        id: option.value,
        name: option.label,
        type: [rangeType.values.key],
      };
    },
    validateDelete() {
      return createDeleteValidationSuccess();
    },
    validateUpdate() {
      return createValidationSuccess();
    },
  } as unknown as EntityRef<any, any>;
}

function getDynamicRangeState({
  kind,
  label,
  options,
  path,
  rawValue,
}: Pick<QueryEditorPredicateFieldProps, "kind" | "label" | "options" | "path" | "rawValue">): {
  entities: readonly EntityRef<any, any>[];
  entityById: ReadonlyMap<string, EntityRef<any, any>>;
  fieldMeta?: Record<string, unknown>;
  rangeType: AnyTypeOutput | undefined;
} {
  if (kind === "enum") {
    const selectedValue = typeof rawValue === "string" ? rawValue.trim() : "";
    const optionEntries = [...(options ?? [])];
    if (
      selectedValue.length > 0 &&
      !optionEntries.some((option) => option.value === selectedValue)
    ) {
      optionEntries.push({ label: selectedValue, value: selectedValue });
    }

    const enumType = defineEnum({
      options: Object.fromEntries(
        optionEntries.map((option, index) => [
          `option${index + 1}`,
          { key: option.value, name: option.label },
        ]),
      ),
      values: {
        key: `query-editor:${path}:enum`,
        name: label,
      },
    });

    return {
      entities: [],
      entityById: new Map(),
      fieldMeta: {
        label,
        editor: {
          kind: "select",
        },
      },
      rangeType: enumType,
    };
  }

  if (kind === "entity-ref") {
    const rangeType = defineType({
      fields: {},
      values: {
        key: `query-editor:${path}:entity`,
        name: label,
      },
    });
    const entities = (options ?? []).map((option) => createEntityOptionRef(option, rangeType));
    return {
      entities,
      entityById: new Map(entities.map((entity) => [entity.id, entity])),
      fieldMeta: existingEntityReferenceFieldMeta({ create: false, label }),
      rangeType,
    };
  }

  const fieldModule = getQueryEditorFieldModuleForKind(kind);
  return {
    entities: [],
    entityById: new Map(),
    fieldMeta: fieldModule ? { ...fieldModule.meta, label } : undefined,
    rangeType: fieldModule?.type,
  };
}

function useQueryEditorPredicateField({
  kind,
  label,
  onChange,
  options,
  optional = false,
  path,
  rawValue,
}: QueryEditorPredicateFieldProps): PredicateRef<any, any> {
  const stateRef = useRef<MutablePredicateState>({
    entities: [],
    entityById: new Map(),
    field: {
      cardinality: optional ? "one?" : "one",
      key: path,
      meta: undefined,
      range: `query-editor:${path}`,
    },
    kind,
    onChange,
    optional,
    rangeType: undefined,
    rawValue,
  });
  const predicateRef = useRef<PredicateRef<any, any> | undefined>(undefined);

  const dynamicState = getDynamicRangeState({ kind, label, options, path, rawValue });
  stateRef.current = {
    entities: dynamicState.entities,
    entityById: dynamicState.entityById,
    field: {
      cardinality: optional ? "one?" : "one",
      key: path,
      ...(dynamicState.fieldMeta ? { meta: dynamicState.fieldMeta } : {}),
      range: dynamicState.rangeType?.values.key ?? `query-editor:${path}`,
    },
    kind,
    onChange,
    optional,
    rangeType: dynamicState.rangeType,
    rawValue,
  };

  if (!predicateRef.current) {
    const predicate = {
      batch<TResult>(fn: () => TResult) {
        return fn();
      },
      get() {
        return decodeQueryEditorFieldValueForEditor(
          stateRef.current.kind,
          stateRef.current.rawValue,
        );
      },
      listEntities() {
        return stateRef.current.entities;
      },
      predicateId: `query-editor:${path}`,
      resolveEntity(id: string) {
        return (
          stateRef.current.entityById.get(id) ??
          createFallbackEntityRef(id, stateRef.current.rangeType)
        );
      },
      set(nextValue: unknown) {
        stateRef.current.onChange(
          encodeQueryEditorFieldValueFromEditor(stateRef.current.kind, nextValue),
        );
      },
      subjectId: `query-editor:${path}`,
      subscribe(_listener: () => void) {
        return () => undefined;
      },
      validateSet(nextValue: unknown) {
        try {
          encodeQueryEditorFieldValueFromEditor(stateRef.current.kind, nextValue);
          return createValidationSuccess();
        } catch (error) {
          return createValidationFailure(
            path,
            error instanceof Error ? error.message : "Value is invalid.",
          );
        }
      },
    } as unknown as PredicateRef<any, any>;

    Object.defineProperty(predicate, "field", {
      enumerable: true,
      get() {
        return stateRef.current.field;
      },
    });
    Object.defineProperty(predicate, "rangeType", {
      enumerable: true,
      get() {
        return stateRef.current.rangeType;
      },
    });

    if (optional) {
      Object.assign(predicate, {
        clear() {
          stateRef.current.onChange(undefined);
        },
        validateClear() {
          return createValidationSuccess();
        },
      });
    }

    predicateRef.current = predicate;
  }

  return predicateRef.current;
}

export function canUseQueryEditorPredicateFieldEditor(
  kind: QuerySurfaceFieldKind,
  options?: readonly QueryEditorOption[],
): boolean {
  if (!isQueryEditorFieldKindSupported(kind)) {
    return false;
  }
  if (kind === "enum" || kind === "entity-ref") {
    return Boolean(options && options.length > 0);
  }
  return getQueryEditorFieldModuleForKind(kind) !== undefined;
}

export function QueryEditorPredicateField({
  kind,
  label,
  onChange,
  options,
  optional,
  path,
  rawValue,
}: QueryEditorPredicateFieldProps) {
  const predicate = useQueryEditorPredicateField({
    kind,
    label,
    onChange,
    options,
    optional,
    path,
    rawValue,
  });

  return (
    <div data-query-editor-control={kind}>
      <PredicateFieldEditor predicate={predicate} />
    </div>
  );
}
