import {
  PredicateFieldEditor as GraphPredicateFieldEditor,
  PredicateFieldView as GraphPredicateFieldView,
  createGraphFieldResolver,
  type GraphFieldEditorResolution,
  type GraphFieldResolver,
  type GraphFieldViewResolution,
  type PredicateFieldEditorCapability,
  type PredicateFieldEditorProps,
  type PredicateFieldProps,
  type PredicateFieldViewCapability,
  type PredicateFieldViewProps,
  type UnsupportedFieldFallbackProps,
  type UnsupportedFieldReason,
} from "@io/graph-react";
import type { ReactNode } from "react";

import type { AnyTypeOutput, EdgeOutput } from "../../index.js";
import {
  genericWebFieldEditorCapabilities,
  genericWebFieldViewCapabilities,
} from "./field-registry.js";

export const createWebFieldResolver = createGraphFieldResolver;
export type {
  PredicateFieldEditorCapability,
  PredicateFieldProps,
  PredicateFieldViewCapability,
  UnsupportedFieldReason,
};
export type WebFieldEditorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphFieldEditorResolution<T, Defs>;
export type WebFieldResolver = GraphFieldResolver;
export type WebFieldViewResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphFieldViewResolution<T, Defs>;

export const defaultWebFieldResolver = createWebFieldResolver({
  view: genericWebFieldViewCapabilities,
  editor: genericWebFieldEditorCapabilities,
});

function UnsupportedField({ kind, reason }: UnsupportedFieldFallbackProps): ReactNode {
  return <span data-web-field-status="unsupported">{kind ? `${reason}:${kind}` : reason}</span>;
}

export function PredicateFieldView<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>({ fallback, resolver = defaultWebFieldResolver, ...props }: PredicateFieldViewProps<T, Defs>) {
  return (
    <GraphPredicateFieldView
      {...props}
      fallback={fallback ?? UnsupportedField}
      resolver={resolver}
    />
  );
}

export function PredicateFieldEditor<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>({ fallback, resolver = defaultWebFieldResolver, ...props }: PredicateFieldEditorProps<T, Defs>) {
  return (
    <GraphPredicateFieldEditor
      {...props}
      fallback={fallback ?? UnsupportedField}
      resolver={resolver}
    />
  );
}
