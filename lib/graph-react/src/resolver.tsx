import type { PredicateRef } from "@io/graph-client";
import type { AnyTypeOutput, EdgeOutput } from "@io/graph-kernel";
import type { ComponentType, ReactNode } from "react";

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

export type PredicateFieldControlCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  kind: string;
  Component: ComponentType<PredicateFieldProps<T, Defs>>;
};

/** Compatibility alias while hosts migrate from `editor` to explicit `control` mode. */
export type PredicateFieldEditorCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = PredicateFieldControlCapability<T, Defs>;

export type PredicateFieldCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  kind: string;
  Component: ComponentType<PredicateFieldProps<T, Defs>>;
};

type AnyViewCapability = PredicateFieldViewCapability<any, any>;
type AnyControlCapability = PredicateFieldControlCapability<any, any>;
type AnyFieldCapability = PredicateFieldCapability<any, any>;
type AnyEditorCapability = PredicateFieldEditorCapability<any, any>;

export type GraphFieldRenderMode = "view" | "control" | "field";

export type UnsupportedFieldReason =
  | "missing-display-kind"
  | "missing-editor-kind"
  | "unsupported-display-kind"
  | "unsupported-editor-kind";

type GraphFieldCapabilityByMode<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  view: PredicateFieldViewCapability<T, Defs>;
  control: PredicateFieldControlCapability<T, Defs>;
  field: PredicateFieldCapability<T, Defs>;
};

type GraphFieldUnsupportedReasonByMode = {
  view: Extract<UnsupportedFieldReason, "missing-display-kind" | "unsupported-display-kind">;
  control: Extract<UnsupportedFieldReason, "missing-editor-kind" | "unsupported-editor-kind">;
  field: Extract<UnsupportedFieldReason, "missing-editor-kind" | "unsupported-editor-kind">;
};

export type GraphFieldModeResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Mode extends GraphFieldRenderMode,
> =
  | {
      status: "resolved";
      capability: GraphFieldCapabilityByMode<T, Defs>[Mode];
    }
  | {
      status: "unsupported";
      reason: GraphFieldUnsupportedReasonByMode[Mode];
      kind?: string;
    };

export type GraphFieldViewResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphFieldModeResolution<T, Defs, "view">;

export type GraphFieldControlResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphFieldModeResolution<T, Defs, "control">;

export type GraphFieldFieldResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphFieldModeResolution<T, Defs, "field">;

/** Compatibility alias while callers migrate from `editor` to explicit `control` mode. */
export type GraphFieldEditorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphFieldControlResolution<T, Defs>;

export type GraphFieldResolver = {
  resolveMode<
    Mode extends GraphFieldRenderMode,
    T extends EdgeOutput,
    Defs extends Record<string, AnyTypeOutput>,
  >(
    mode: Mode,
    predicate: PredicateRef<T, Defs>,
  ): GraphFieldModeResolution<T, Defs, Mode>;
  resolveView<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): GraphFieldViewResolution<T, Defs>;
  resolveControl<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): GraphFieldControlResolution<T, Defs>;
  resolveField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): GraphFieldFieldResolution<T, Defs>;
  resolveEditor<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): GraphFieldEditorResolution<T, Defs>;
};

export type GraphFieldResolverInput = {
  view?: readonly AnyViewCapability[];
  control?: readonly AnyControlCapability[];
  field?: readonly AnyFieldCapability[];
  /** Compatibility alias for `control`. */
  editor?: readonly AnyEditorCapability[];
};

export type UnsupportedFieldFallbackProps = {
  reason: UnsupportedFieldReason;
  kind?: string;
};

export type PredicateFieldViewProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = PredicateFieldProps<T, Defs> & {
  resolver?: GraphFieldResolver;
  fallback?: ComponentType<UnsupportedFieldFallbackProps>;
};

export type PredicateFieldEditorProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = PredicateFieldProps<T, Defs> & {
  resolver?: GraphFieldResolver;
  fallback?: ComponentType<UnsupportedFieldFallbackProps>;
};

function toCapabilityMap<T extends { kind: string }>(
  capabilities: readonly T[],
): ReadonlyMap<string, T> {
  return new Map(capabilities.map((capability) => [capability.kind, capability]));
}

/**
 * Builds a host-neutral field resolver from host-supplied render-mode
 * capabilities. `editor` remains as a compatibility alias for `control`.
 */
export function createGraphFieldResolver(input?: GraphFieldResolverInput): GraphFieldResolver {
  const viewByKind = toCapabilityMap(input?.view ?? []);
  const controlByKind = toCapabilityMap(input?.control ?? input?.editor ?? []);
  const fieldByKind = toCapabilityMap(input?.field ?? []);

  function resolveView<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): GraphFieldViewResolution<T, Defs> {
    const kind = getPredicateDisplayKind(predicate.field);
    if (!kind) return { status: "unsupported", reason: "missing-display-kind" };
    const capability = viewByKind.get(kind);
    if (!capability) return { status: "unsupported", reason: "unsupported-display-kind", kind };
    return {
      status: "resolved",
      capability: capability as PredicateFieldViewCapability<T, Defs>,
    };
  }

  function resolveControl<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): GraphFieldControlResolution<T, Defs> {
    const kind = getPredicateEditorKind(predicate.field);
    if (!kind) return { status: "unsupported", reason: "missing-editor-kind" };
    const capability = controlByKind.get(kind);
    if (!capability) return { status: "unsupported", reason: "unsupported-editor-kind", kind };
    return {
      status: "resolved",
      capability: capability as PredicateFieldControlCapability<T, Defs>,
    };
  }

  function resolveField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): GraphFieldFieldResolution<T, Defs> {
    const kind = getPredicateEditorKind(predicate.field);
    if (!kind) return { status: "unsupported", reason: "missing-editor-kind" };
    const capability = fieldByKind.get(kind);
    if (!capability) return { status: "unsupported", reason: "unsupported-editor-kind", kind };
    return {
      status: "resolved",
      capability: capability as PredicateFieldCapability<T, Defs>,
    };
  }

  function resolveMode<
    Mode extends GraphFieldRenderMode,
    T extends EdgeOutput,
    Defs extends Record<string, AnyTypeOutput>,
  >(mode: Mode, predicate: PredicateRef<T, Defs>): GraphFieldModeResolution<T, Defs, Mode> {
    switch (mode) {
      case "view":
        return resolveView(predicate) as GraphFieldModeResolution<T, Defs, Mode>;
      case "control":
        return resolveControl(predicate) as GraphFieldModeResolution<T, Defs, Mode>;
      case "field":
        return resolveField(predicate) as GraphFieldModeResolution<T, Defs, Mode>;
    }
  }

  return {
    resolveControl,
    resolveEditor: resolveControl,
    resolveField,
    resolveMode,
    resolveView,
  };
}

export const defaultGraphFieldResolver = createGraphFieldResolver();

function UnsupportedField({ kind, reason }: UnsupportedFieldFallbackProps): ReactNode {
  return kind ? `${reason}:${kind}` : reason;
}

export function PredicateFieldView<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>({ fallback, predicate, resolver = defaultGraphFieldResolver }: PredicateFieldViewProps<T, Defs>) {
  const resolution = resolver.resolveMode("view", predicate);
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
  resolver = defaultGraphFieldResolver,
}: PredicateFieldEditorProps<T, Defs>) {
  const resolution = resolver.resolveMode("control", predicate);
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
