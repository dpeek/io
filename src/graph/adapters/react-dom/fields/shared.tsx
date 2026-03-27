import {
  GraphValidationError,
  type GraphMutationValidationResult,
  type PredicateRef,
} from "@io/graph-client";
import {
  formatPredicateValue,
  performValidatedMutation,
  usePersistedMutationCallbacks,
  usePredicateField,
  type MutationCallbacks,
  type MutationValidation,
  type PredicateFieldProps,
  type PredicateFieldViewCapability,
} from "@io/graph-react";

export type AnyPredicate = PredicateRef<any, any>;
export type AnyFieldProps = PredicateFieldProps<any, any>;

export const fieldActionClassName =
  "border-input bg-muted/30 text-foreground inline-flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted";
export const unsetSelectValue = "__io_unset_select_value__";

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

export function createFormattedFieldViewCapability(
  kind: string,
): PredicateFieldViewCapability<any, any> {
  function FormattedFieldView({ predicate }: AnyFieldProps) {
    const { value } = usePredicateField(predicate);
    return <span data-web-field-kind={kind}>{formatPredicateValue(predicate, value)}</span>;
  }

  return { kind, Component: FormattedFieldView };
}
