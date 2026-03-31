import type { PredicateRef } from "@io/graph-client";
import type { AnyTypeOutput, EdgeOutput } from "@io/graph-kernel";
import {
  createGraphFieldResolver,
  type EditSessionFieldController,
  type GraphFieldResolver,
  type GraphFieldViewResolution,
  type PredicateFieldProps as GraphPredicateFieldProps,
  type PredicateFieldCapability as GraphPredicateFieldCapability,
  type PredicateFieldControlCapability as GraphPredicateFieldControlCapability,
  type PredicateFieldEditorCapability,
  type PredicateFieldViewCapability,
  type UnsupportedFieldFallbackProps as GraphUnsupportedFieldFallbackProps,
  type UnsupportedFieldReason,
} from "@io/graph-react";
import type { ComponentType, ReactNode } from "react";

import type { FieldRenderIssues } from "./fields/shared.js";
import {
  createDefaultWebFieldCapability,
  genericWebFieldCapabilities,
  genericWebFieldControlCapabilities,
  genericWebFieldViewCapabilities,
} from "./field-registry.js";

type AnyControlCapability = PredicateFieldControlCapability<any, any>;
type AnyFieldCapability = PredicateFieldCapability<any, any>;

/**
 * Creates a browser field resolver by layering DOM capabilities over the
 * host-neutral `@io/graph-react` resolver contracts.
 */
export type WebFieldMode = "view" | "control" | "field";
export type WebFieldRenderContextProps = {
  controller?: EditSessionFieldController<unknown>;
  issues?: FieldRenderIssues;
  mode?: Exclude<WebFieldMode, "view">;
};
export type PredicateFieldControlCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  kind: string;
  Component: ComponentType<GraphPredicateFieldProps<T, Defs> & WebFieldRenderContextProps>;
};
export type PredicateFieldCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  kind: string;
  Component: ComponentType<GraphPredicateFieldProps<T, Defs> & WebFieldRenderContextProps>;
};
export type UnsupportedFieldFallbackProps = GraphUnsupportedFieldFallbackProps & {
  mode?: WebFieldMode;
};
export type {
  PredicateFieldEditorCapability,
  PredicateFieldViewCapability,
  UnsupportedFieldReason,
};
export type PredicateFieldProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphPredicateFieldProps<T, Defs> &
  WebFieldRenderContextProps & {
    resolver?: WebFieldResolver;
    fallback?: ComponentType<UnsupportedFieldFallbackProps>;
  };
export type PredicateFieldControlProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphPredicateFieldProps<T, Defs> &
  WebFieldRenderContextProps & {
    resolver?: WebFieldResolver;
    fallback?: ComponentType<UnsupportedFieldFallbackProps>;
  };
export type PredicateFieldViewProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphPredicateFieldProps<T, Defs> & {
  resolver?: WebFieldResolver;
  fallback?: ComponentType<UnsupportedFieldFallbackProps>;
};
export type WebFieldEditorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> =
  | {
      status: "resolved";
      capability: PredicateFieldControlCapability<T, Defs>;
    }
  | {
      status: "unsupported";
      reason: Extract<UnsupportedFieldReason, "missing-editor-kind" | "unsupported-editor-kind">;
      kind?: string;
    };
export type WebFieldControlResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = WebFieldEditorResolution<T, Defs>;
export type WebFieldResolution<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>> =
  | {
      status: "resolved";
      capability: PredicateFieldCapability<T, Defs>;
    }
  | {
      status: "unsupported";
      reason: Extract<UnsupportedFieldReason, "missing-editor-kind" | "unsupported-editor-kind">;
      kind?: string;
    };
export type WebFieldModeResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Mode extends WebFieldMode,
> = Mode extends "view"
  ? WebFieldViewResolution<T, Defs>
  : Mode extends "control"
    ? WebFieldControlResolution<T, Defs>
    : WebFieldResolution<T, Defs>;
export type WebFieldResolver = Omit<
  GraphFieldResolver,
  "resolveControl" | "resolveEditor" | "resolveField" | "resolveMode"
> & {
  resolveMode<
    Mode extends WebFieldMode,
    T extends EdgeOutput,
    Defs extends Record<string, AnyTypeOutput>,
  >(
    mode: Mode,
    predicate: PredicateRef<T, Defs>,
  ): WebFieldModeResolution<T, Defs, Mode>;
  resolveControl<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): WebFieldControlResolution<T, Defs>;
  resolveEditor<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): WebFieldEditorResolution<T, Defs>;
  resolveField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): WebFieldResolution<T, Defs>;
};
export type WebFieldViewResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = GraphFieldViewResolution<T, Defs>;

/**
 * Creates a browser field resolver over view, bare control, and full field-row
 * capabilities. `editor` remains as a compatibility alias for `control`.
 */
export function createWebFieldResolver(input?: {
  view?: readonly PredicateFieldViewCapability<any, any>[];
  control?: readonly AnyControlCapability[];
  field?: readonly AnyFieldCapability[];
  editor?: readonly AnyControlCapability[];
}): WebFieldResolver {
  const controlCapabilities = input?.control ?? input?.editor ?? [];
  const graphResolver = createGraphFieldResolver({
    view: input?.view,
    control: controlCapabilities as readonly GraphPredicateFieldControlCapability<any, any>[],
    field: (input?.field ??
      controlCapabilities.map((capability) =>
        createDefaultWebFieldCapability(capability),
      )) as readonly GraphPredicateFieldCapability<any, any>[],
  });

  function resolveControl<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): WebFieldControlResolution<T, Defs> {
    const resolution = graphResolver.resolveControl(predicate);
    if (resolution.status === "unsupported") return resolution;
    return {
      status: "resolved",
      capability: resolution.capability as unknown as PredicateFieldControlCapability<T, Defs>,
    };
  }

  function resolveEditor<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): WebFieldEditorResolution<T, Defs> {
    const resolution = graphResolver.resolveEditor(predicate);
    if (resolution.status === "unsupported") return resolution;
    return {
      status: "resolved",
      capability: resolution.capability as unknown as PredicateFieldControlCapability<T, Defs>,
    };
  }

  function resolveField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): WebFieldResolution<T, Defs> {
    const resolution = graphResolver.resolveField(predicate);
    if (resolution.status === "unsupported") return resolution;
    return {
      status: "resolved",
      capability: resolution.capability as unknown as PredicateFieldCapability<T, Defs>,
    };
  }

  function resolveMode<
    Mode extends WebFieldMode,
    T extends EdgeOutput,
    Defs extends Record<string, AnyTypeOutput>,
  >(mode: Mode, predicate: PredicateRef<T, Defs>): WebFieldModeResolution<T, Defs, Mode> {
    switch (mode) {
      case "view":
        return graphResolver.resolveMode(mode, predicate) as WebFieldModeResolution<T, Defs, Mode>;
      case "control":
        return resolveControl(predicate) as WebFieldModeResolution<T, Defs, Mode>;
      case "field":
        return resolveField(predicate) as WebFieldModeResolution<T, Defs, Mode>;
    }
  }

  return {
    ...graphResolver,
    resolveControl,
    resolveEditor,
    resolveField,
    resolveMode,
  };
}

/** Default browser resolver for the built-in DOM field capabilities. */
export const defaultWebFieldResolver = createWebFieldResolver({
  control: genericWebFieldControlCapabilities,
  field: genericWebFieldCapabilities,
  view: genericWebFieldViewCapabilities,
});

function UnsupportedField({ kind, mode, reason }: UnsupportedFieldFallbackProps): ReactNode {
  return (
    <span data-web-field-mode={mode} data-web-field-status="unsupported">
      {kind ? `${reason}:${kind}` : reason}
    </span>
  );
}

function renderUnsupportedField(
  fallback: ComponentType<UnsupportedFieldFallbackProps> | undefined,
  mode: WebFieldMode,
  reason: UnsupportedFieldReason,
  kind?: string,
): ReactNode {
  const Fallback = fallback ?? UnsupportedField;
  return <Fallback kind={kind} mode={mode} reason={reason} />;
}

/** Browser fallback wrapper over the resolved read-only field view. */
export function PredicateFieldView<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>({ fallback, predicate, resolver = defaultWebFieldResolver }: PredicateFieldViewProps<T, Defs>) {
  const resolution = resolver.resolveMode("view", predicate);
  if (resolution.status === "unsupported") {
    return renderUnsupportedField(fallback, "view", resolution.reason, resolution.kind);
  }
  const Component = resolution.capability.Component;
  return <Component predicate={predicate} />;
}

/** Browser fallback wrapper over the resolved bare field control. */
export function PredicateFieldControl<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>({
  controller,
  fallback,
  issues,
  onMutationError,
  onMutationSuccess,
  predicate,
  resolver = defaultWebFieldResolver,
}: PredicateFieldControlProps<T, Defs>) {
  const resolution = resolver.resolveMode("control", predicate);
  if (resolution.status === "unsupported") {
    return renderUnsupportedField(fallback, "control", resolution.reason, resolution.kind);
  }
  const Component = resolution.capability.Component;
  return (
    <Component
      controller={controller}
      issues={issues}
      mode="control"
      onMutationError={onMutationError}
      onMutationSuccess={onMutationSuccess}
      predicate={predicate}
    />
  );
}

/** Browser fallback wrapper over the resolved full field row. */
export function PredicateField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>({
  controller,
  fallback,
  issues,
  onMutationError,
  onMutationSuccess,
  predicate,
  resolver = defaultWebFieldResolver,
}: PredicateFieldProps<T, Defs>) {
  const resolution = resolver.resolveMode("field", predicate);
  if (resolution.status === "unsupported") {
    return renderUnsupportedField(fallback, "field", resolution.reason, resolution.kind);
  }
  const Component = resolution.capability.Component;
  return (
    <Component
      controller={controller}
      issues={issues}
      mode="field"
      onMutationError={onMutationError}
      onMutationSuccess={onMutationSuccess}
      predicate={predicate}
    />
  );
}

/** Compatibility alias while callers migrate to the explicit `control` name. */
export function PredicateFieldEditor<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(props: PredicateFieldControlProps<T, Defs>) {
  return <PredicateFieldControl {...props} />;
}
