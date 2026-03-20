import type { ReactNode } from "react";

import type { AnyTypeOutput, EdgeOutput } from "../../index.js";
import {
  FilterOperandEditor as GraphFilterOperandEditor,
  createWebFilterResolver,
  type FieldFilterOperatorKey,
  type FilterOperandEditorProps,
  type UnsupportedFilterOperandFallbackProps,
} from "../../runtime/react/index.js";
import { genericWebFilterOperandEditorCapabilities } from "./filter-editors.js";

export { createWebFilterResolver } from "../../runtime/react/index.js";
export type {
  ActiveWebFilterClause,
  FieldFilterOf,
  FieldFilterOperatorKey,
  FilterOperandEditorProps,
  FilterOperandProps,
  UnsupportedFieldFilterReason,
  UnsupportedFilterOperandFallbackProps,
  UnsupportedFilterOperandReason,
  WebFieldFilterResolution,
  WebFilterEnumOption,
  WebFilterOperandEditorCapability,
  WebFilterOperandEditorResolution,
  WebFilterOperandOf,
  WebFilterOperandResolution,
  WebFilterOperatorResolution,
  WebFilterResolver,
  WebFilterValueOf,
  WebRuntimeFilterClause,
  WebRuntimeFilterOperand,
  WebRuntimeFilterQuery,
} from "../../runtime/react/index.js";
export {
  compileWebFilterQuery,
  defaultWebFilterResolver as defaultHostNeutralWebFilterResolver,
  FilterOperandEditor as HostNeutralFilterOperandEditor,
  lowerWebFilterClause,
  lowerWebFilterQuery,
} from "../../runtime/react/index.js";

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
