import type { ComponentType, ReactNode } from "react";

import type { PredicateRef } from "../graph/client.js";
import type { AnyTypeOutput, EdgeOutput } from "../graph/schema.js";
import {
  genericWebFieldEditorCapabilities,
  genericWebFieldViewCapabilities,
} from "./generic-fields.js";
import { getPredicateDisplayKind, getPredicateEditorKind } from "./predicate.js";

export type PredicateFieldProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  predicate: PredicateRef<T, Defs>;
  onMutationError?: (error: unknown) => void;
  onMutationSuccess?: () => void;
};

export type PredicateFieldViewCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  kind: string;
  Component: ComponentType<PredicateFieldProps<T, Defs>>;
};

export type PredicateFieldEditorCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  kind: string;
  Component: ComponentType<PredicateFieldProps<T, Defs>>;
};

type AnyViewCapability = PredicateFieldViewCapability<any, any>;
type AnyEditorCapability = PredicateFieldEditorCapability<any, any>;

export type UnsupportedFieldReason =
  | "missing-display-kind"
  | "missing-editor-kind"
  | "unsupported-display-kind"
  | "unsupported-editor-kind";

export type WebFieldViewResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> =
  | {
      status: "resolved";
      capability: PredicateFieldViewCapability<T, Defs>;
    }
  | {
      status: "unsupported";
      reason: Extract<UnsupportedFieldReason, "missing-display-kind" | "unsupported-display-kind">;
      kind?: string;
    };

export type WebFieldEditorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> =
  | {
      status: "resolved";
      capability: PredicateFieldEditorCapability<T, Defs>;
    }
  | {
      status: "unsupported";
      reason: Extract<UnsupportedFieldReason, "missing-editor-kind" | "unsupported-editor-kind">;
      kind?: string;
    };

export type WebFieldResolver = {
  resolveView<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): WebFieldViewResolution<T, Defs>;
  resolveEditor<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): WebFieldEditorResolution<T, Defs>;
};

export type UnsupportedFieldFallbackProps = {
  reason: UnsupportedFieldReason;
  kind?: string;
};

export type PredicateFieldViewProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = PredicateFieldProps<T, Defs> & {
  resolver?: WebFieldResolver;
  fallback?: ComponentType<UnsupportedFieldFallbackProps>;
};

export type PredicateFieldEditorProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = PredicateFieldProps<T, Defs> & {
  resolver?: WebFieldResolver;
  fallback?: ComponentType<UnsupportedFieldFallbackProps>;
};

function toCapabilityMap<T extends { kind: string }>(capabilities: readonly T[]): ReadonlyMap<string, T> {
  return new Map(capabilities.map((capability) => [capability.kind, capability]));
}

export function createWebFieldResolver(input?: {
  view?: readonly AnyViewCapability[];
  editor?: readonly AnyEditorCapability[];
}): WebFieldResolver {
  const viewByKind = toCapabilityMap(input?.view ?? []);
  const editorByKind = toCapabilityMap(input?.editor ?? []);

  return {
    resolveView<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
      predicate: PredicateRef<T, Defs>,
    ): WebFieldViewResolution<T, Defs> {
      const kind = getPredicateDisplayKind(predicate.field);
      if (!kind) return { status: "unsupported", reason: "missing-display-kind" };
      const capability = viewByKind.get(kind);
      if (!capability) return { status: "unsupported", reason: "unsupported-display-kind", kind };
      return {
        status: "resolved",
        capability: capability as PredicateFieldViewCapability<T, Defs>,
      };
    },
    resolveEditor<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
      predicate: PredicateRef<T, Defs>,
    ): WebFieldEditorResolution<T, Defs> {
      const kind = getPredicateEditorKind(predicate.field);
      if (!kind) return { status: "unsupported", reason: "missing-editor-kind" };
      const capability = editorByKind.get(kind);
      if (!capability) return { status: "unsupported", reason: "unsupported-editor-kind", kind };
      return {
        status: "resolved",
        capability: capability as PredicateFieldEditorCapability<T, Defs>,
      };
    },
  };
}

export const defaultWebFieldResolver = createWebFieldResolver({
  view: genericWebFieldViewCapabilities,
  editor: genericWebFieldEditorCapabilities,
});

function UnsupportedField({
  kind,
  reason,
}: UnsupportedFieldFallbackProps): ReactNode {
  return (
    <span data-web-field-status="unsupported">
      {kind ? `${reason}:${kind}` : reason}
    </span>
  );
}

export function PredicateFieldView<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>({ fallback, predicate, resolver = defaultWebFieldResolver }: PredicateFieldViewProps<T, Defs>) {
  const resolution = resolver.resolveView(predicate);
  if (resolution.status === "unsupported") {
    const Fallback = fallback ?? UnsupportedField;
    return <Fallback kind={resolution.kind} reason={resolution.reason} />;
  }
  const Component = resolution.capability.Component;
  return <Component predicate={predicate} />;
}

export function PredicateFieldEditor<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>({
  fallback,
  onMutationError,
  onMutationSuccess,
  predicate,
  resolver = defaultWebFieldResolver,
}: PredicateFieldEditorProps<T, Defs>) {
  const resolution = resolver.resolveEditor(predicate);
  if (resolution.status === "unsupported") {
    const Fallback = fallback ?? UnsupportedField;
    return <Fallback kind={resolution.kind} reason={resolution.reason} />;
  }
  const Component = resolution.capability.Component;
  return (
    <Component
      onMutationError={onMutationError}
      onMutationSuccess={onMutationSuccess}
      predicate={predicate}
    />
  );
}
