import {
  FilterOperandEditor as GraphFilterOperandEditor,
  compileGraphFilterQuery,
  createGraphFilterResolver,
  defaultGraphFilterResolver as defaultHostNeutralGraphFilterResolver,
  lowerGraphFilterClause,
  lowerGraphFilterQuery,
  type ActiveGraphFilterClause,
  type FieldFilterOf,
  type FieldFilterOperatorKey,
  type FilterOperandEditorProps,
  type FilterOperandProps,
  type GraphFieldFilterResolution,
  type GraphFilterEnumOption,
  type GraphFilterOperandEditorCapability,
  type GraphFilterOperandEditorResolution,
  type GraphFilterOperandOf,
  type GraphFilterOperandResolution,
  type GraphFilterOperatorResolution,
  type GraphFilterResolver,
  type GraphFilterValueOf,
  type GraphRuntimeFilterClause,
  type GraphRuntimeFilterOperand,
  type GraphRuntimeFilterQuery,
  type UnsupportedFieldFilterReason,
  type UnsupportedFilterOperandFallbackProps,
  type UnsupportedFilterOperandReason,
} from "@io/graph-react";
import type { ReactNode } from "react";

import type { AnyTypeOutput, EdgeOutput } from "../../index.js";
import { genericWebFilterOperandEditorCapabilities } from "./filter-editors.js";

export const createWebFilterResolver = createGraphFilterResolver;
export type {
  FieldFilterOf,
  FieldFilterOperatorKey,
  FilterOperandEditorProps,
  FilterOperandProps,
  UnsupportedFieldFilterReason,
  UnsupportedFilterOperandFallbackProps,
  UnsupportedFilterOperandReason,
};
export type ActiveWebFilterClause<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = ActiveGraphFilterClause<T, Defs, Key>;
export type WebFieldFilterResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphFieldFilterResolution<T, Defs>;
export type WebFilterEnumOption = GraphFilterEnumOption;
export type WebFilterOperandEditorCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = GraphFilterOperandEditorCapability<T, Defs, Key>;
export type WebFilterOperandEditorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = GraphFilterOperandEditorResolution<T, Defs, Key>;
export type WebFilterOperandOf<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = GraphFilterOperandOf<T, Key>;
export type WebFilterOperandResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = GraphFilterOperandResolution<T, Defs, Key>;
export type WebFilterOperatorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = GraphFilterOperatorResolution<T, Defs, Key>;
export type WebFilterResolver = GraphFilterResolver;
export type WebFilterValueOf<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = GraphFilterValueOf<T, Key>;
export type WebRuntimeFilterClause<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = GraphRuntimeFilterClause<T, Key>;
export type WebRuntimeFilterOperand<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = GraphRuntimeFilterOperand<T, Key>;
export type WebRuntimeFilterQuery = GraphRuntimeFilterQuery;
export {
  compileGraphFilterQuery as compileWebFilterQuery,
  defaultHostNeutralGraphFilterResolver as defaultHostNeutralWebFilterResolver,
  GraphFilterOperandEditor as HostNeutralFilterOperandEditor,
  lowerGraphFilterClause as lowerWebFilterClause,
  lowerGraphFilterQuery as lowerWebFilterQuery,
};

export const defaultWebFilterResolver = createWebFilterResolver({
  operandEditors: genericWebFilterOperandEditorCapabilities,
});

function UnsupportedFilterOperand({
  kind,
  reason,
}: UnsupportedFilterOperandFallbackProps): ReactNode {
  return <span data-web-filter-status="unsupported">{kind ? `${reason}:${kind}` : reason}</span>;
}

export function FilterOperandEditor<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
>({ fallback, ...props }: FilterOperandEditorProps<T, Defs, Key>) {
  return <GraphFilterOperandEditor {...props} fallback={fallback ?? UnsupportedFilterOperand} />;
}
