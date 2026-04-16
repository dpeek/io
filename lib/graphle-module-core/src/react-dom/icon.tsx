import { useOptionalMutationRuntime, usePredicateField } from "@dpeek/graphle-react";
import { cn } from "@dpeek/graphle-web-ui/utils";
import type { ReactNode } from "react";

import { sanitizeSvgMarkup } from "../core/svg-sanitization.js";

export type SvgMarkupProps = {
  className?: string;
  data?: Record<`data-${string}`, string>;
  fallback?: ReactNode;
  svg: string;
  title?: string;
};

function injectRootSvgClass(svg: string): string {
  return svg.replace(/^<svg(?=[\s>])/, '<svg class="block size-full shrink-0 overflow-visible"');
}

/** Renders sanitized SVG markup with the built-in DOM adapter's default chrome. */
export function SvgMarkup({ className, data, fallback, svg, title }: SvgMarkupProps) {
  const result = sanitizeSvgMarkup(svg);
  if (!result.ok) {
    return fallback ? <>{fallback}</> : null;
  }

  return (
    <span
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-visible p-px [&>svg]:block [&>svg]:size-full [&>svg]:shrink-0 [&>svg]:overflow-visible",
        className,
      )}
      {...data}
      data-graph-svg-state="ready"
      role={title ? "img" : undefined}
      dangerouslySetInnerHTML={{ __html: injectRootSvgClass(result.svg) }}
    />
  );
}

type GraphIconHandle = {
  fields: {
    name: unknown;
    svg: unknown;
  };
};

type GraphIconRuntime = {
  graph?: {
    icon?: {
      ref(id: string): GraphIconHandle;
    };
  };
};

export type GraphIconProps = {
  className?: string;
  fallback?: ReactNode;
  iconId?: string;
  title?: string;
};

/**
 * Resolves and renders the current built-in core icon entity shape through the
 * active graph mutation runtime. Callers with a different icon contract should
 * provide their own wrapper.
 */
export function GraphIcon({ className, fallback, iconId, title }: GraphIconProps) {
  const runtime = useOptionalMutationRuntime() as GraphIconRuntime | null;

  if (!iconId) {
    return fallback ? <>{fallback}</> : null;
  }

  const iconRef = runtime?.graph?.icon?.ref(iconId);
  if (!iconRef) {
    return fallback ? <>{fallback}</> : null;
  }

  const { value: svg } = usePredicateField(iconRef.fields.svg as never);
  const { value: name } = usePredicateField(iconRef.fields.name as never);
  if (typeof svg !== "string" || svg.length === 0) {
    return fallback ? <>{fallback}</> : null;
  }

  const resolvedTitle = title ?? (typeof name === "string" && name.length > 0 ? name : undefined);
  return (
    <SvgMarkup
      className={className}
      data={{ "data-graph-icon": iconId, "data-graph-icon-state": "ready" }}
      fallback={fallback}
      svg={svg}
      title={resolvedTitle}
    />
  );
}
