import { cn } from "@io/web/utils";
import { useState, type ReactNode } from "react";

import {
  GraphValidationError,
  sanitizeSvgMarkup,
  type GraphMutationValidationResult,
  type PredicateRef,
} from "../../index.js";
import {
  performValidatedMutation,
  usePersistedMutationCallbacks,
  type MutationCallbacks,
  type MutationValidation,
  type PredicateFieldProps,
} from "../../react/index.js";
import { SvgMarkup } from "../icon.js";
import { sourcePreviewPanelClassName } from "../source-preview-styles.js";

export type AnyPredicate = PredicateRef<any, any>;
export type AnyFieldProps = PredicateFieldProps<any, any>;

export const fieldActionClassName =
  "border-input bg-muted/30 text-foreground inline-flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted";
export const unsetSelectValue = "__io_unset_select_value__";

export type SourcePreviewMode = "source" | "preview";

export function useFieldMutationCallbacks({
  onMutationError,
  onMutationSuccess,
}: Pick<AnyFieldProps, "onMutationError" | "onMutationSuccess">): MutationCallbacks {
  return usePersistedMutationCallbacks({ onMutationError, onMutationSuccess });
}

export function setPredicateValue(predicate: AnyPredicate, value: unknown): boolean {
  if (typeof (predicate as { set?: unknown }).set !== "function") return false;
  (predicate as { set(nextValue: unknown): void }).set(value);
  return true;
}

export function clearPredicateValue(predicate: AnyPredicate): boolean {
  if (typeof (predicate as { clear?: unknown }).clear !== "function") return false;
  (predicate as { clear(): void }).clear();
  return true;
}

export function addPredicateItem(predicate: AnyPredicate, value: unknown): boolean {
  if (typeof (predicate as { add?: unknown }).add !== "function") return false;
  (predicate as { add(nextValue: unknown): void }).add(value);
  return true;
}

export function removePredicateItem(predicate: AnyPredicate, value: unknown): boolean {
  if (typeof (predicate as { remove?: unknown }).remove !== "function") return false;
  (predicate as { remove(nextValue: unknown): void }).remove(value);
  return true;
}

export function validatePredicateValue(
  predicate: AnyPredicate,
  value: unknown,
): MutationValidation {
  if (typeof (predicate as { validateSet?: unknown }).validateSet !== "function") return false;
  return (
    predicate as { validateSet(nextValue: unknown): GraphMutationValidationResult }
  ).validateSet(value);
}

export function validatePredicateClear(predicate: AnyPredicate): MutationValidation {
  if (typeof (predicate as { validateClear?: unknown }).validateClear !== "function") return false;
  return (predicate as { validateClear(): GraphMutationValidationResult }).validateClear();
}

export function validatePredicateAdd(predicate: AnyPredicate, value: unknown): MutationValidation {
  if (typeof (predicate as { validateAdd?: unknown }).validateAdd !== "function") return false;
  return (
    predicate as { validateAdd(nextValue: unknown): GraphMutationValidationResult }
  ).validateAdd(value);
}

export function validatePredicateRemove(
  predicate: AnyPredicate,
  value: unknown,
): MutationValidation {
  if (typeof (predicate as { validateRemove?: unknown }).validateRemove !== "function")
    return false;
  return (
    predicate as {
      validateRemove(nextValue: unknown): GraphMutationValidationResult;
    }
  ).validateRemove(value);
}

export function clearOrRejectRequiredValue(
  predicate: AnyPredicate,
  callbacks: MutationCallbacks,
): boolean {
  if (predicate.field.cardinality === "one?") {
    return performValidatedMutation(
      callbacks,
      () => validatePredicateClear(predicate),
      () => clearPredicateValue(predicate),
    );
  }

  const validation = validatePredicateValue(predicate, undefined);
  if (validation !== false && !validation.ok) {
    callbacks.onMutationError?.(new GraphValidationError(validation));
  }
  return false;
}

export function normalizeTextValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return String(value);
}

export function normalizeNumberValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (value === undefined) return "";
  return String(value);
}

export function normalizeUrlValue(value: unknown): string {
  if (value instanceof URL) return value.toString();
  if (value === undefined) return "";
  return String(value);
}

export function normalizeDateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return "";
  return String(value);
}

export function SourcePreviewFieldEditor({
  defaultMode = "source",
  kind,
  preview,
  source,
}: {
  defaultMode?: SourcePreviewMode;
  kind: string;
  preview: ReactNode;
  source: ReactNode;
}) {
  const [mode, setMode] = useState<SourcePreviewMode>(defaultMode);
  const isPreview = mode === "preview";

  return (
    <div className="space-y-3" data-web-field-kind={kind} data-web-source-preview-mode={mode}>
      <div className="relative" data-web-source-preview-panel={mode}>
        <button
          aria-label={isPreview ? "Hide preview" : "Show preview"}
          aria-pressed={isPreview}
          className={cn(
            "border-border/80 absolute top-3 right-3 z-10 inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition",
            isPreview
              ? "border-foreground/10 bg-foreground text-background"
              : "bg-background/90 text-foreground hover:bg-background",
          )}
          data-web-source-preview-toggle="preview"
          data-web-source-preview-toggle-state={isPreview ? "active" : "inactive"}
          onClick={() => setMode(isPreview ? "source" : "preview")}
          type="button"
        >
          Preview
        </button>

        {isPreview ? preview : source}
      </div>
    </div>
  );
}

export function EmptyPreview({ attribute, children }: { attribute: string; children: ReactNode }) {
  return (
    <p
      className={cn(sourcePreviewPanelClassName, "text-muted-foreground border-dashed text-sm")}
      data-web-source-preview-empty={attribute}
    >
      {children}
    </p>
  );
}

export function SvgPreview({ content }: { content: string }) {
  if (content.trim().length === 0) {
    return <EmptyPreview attribute="svg">Paste SVG markup to preview it.</EmptyPreview>;
  }

  const preview = sanitizeSvgMarkup(content);
  if (!preview.ok) {
    return (
      <EmptyPreview attribute="svg">
        {preview.issues[0]?.message ?? "SVG preview is unavailable because the markup is invalid."}
      </EmptyPreview>
    );
  }

  return (
    <div
      className={cn(sourcePreviewPanelClassName, "flex items-center justify-center")}
      data-web-svg-preview="ready"
    >
      <SvgMarkup
        className="text-foreground inline-flex max-w-full items-center justify-center [&>svg]:max-h-48 [&>svg]:max-w-full"
        svg={content}
      />
    </div>
  );
}

export function getNormalizedColorValue(
  parser: ((raw: string) => unknown) | undefined,
  ...candidates: string[]
): string {
  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    try {
      return String(parser ? parser(candidate) : candidate);
    } catch {
      continue;
    }
  }
  return "#2563eb";
}

export function getPredicateFieldLabel(predicate: AnyPredicate): string {
  return (
    (
      predicate.field as {
        meta?: {
          label?: string;
        };
      }
    ).meta?.label ?? "Reference"
  );
}
