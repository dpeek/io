import {
  collectValidationIssuesForPath,
  getPredicateFieldMeta,
  type EditSessionFieldController,
  formatPredicateValue,
  performValidatedMutation,
  usePersistedMutationCallbacks,
  usePredicateField,
  type MutationCallbacks,
  type MutationValidation,
  type PredicateFieldProps,
  type PredicateFieldViewCapability,
  type ValidationIssue,
  type ValidationIssueAggregate,
} from "@dpeek/graphle-react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldTitle,
} from "@dpeek/graphle-web-ui/field";
import type { ReactNode } from "react";

export type AnyFieldProps = PredicateFieldProps<any, any>;
export type AnyPredicate = AnyFieldProps["predicate"];
export type FieldRenderMode = "control" | "field";
export type FieldRenderIssues = readonly ValidationIssue[] | ValidationIssueAggregate;
export type AnyRenderableFieldProps = AnyFieldProps & {
  controller?: EditSessionFieldController<unknown>;
  issues?: FieldRenderIssues;
  mode?: FieldRenderMode;
};
type FieldIssueMessage = { message?: string };
type AnyFieldState = {
  controller?: EditSessionFieldController<unknown>;
  description?: string;
  invalid: boolean;
  issues: readonly FieldIssueMessage[];
  label: string;
};
const emptyFieldIssues = Object.freeze([]) as readonly ValidationIssue[];

function isValidationIssueAggregate(issues: FieldRenderIssues): issues is ValidationIssueAggregate {
  return !Array.isArray(issues);
}

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
  return (predicate as { validateSet(nextValue: unknown): MutationValidation }).validateSet(value);
}

export function validatePredicateClear(predicate: AnyPredicate): MutationValidation {
  if (typeof (predicate as { validateClear?: unknown }).validateClear !== "function") return false;
  return (predicate as { validateClear(): MutationValidation }).validateClear();
}

export function validatePredicateAdd(predicate: AnyPredicate, value: unknown): MutationValidation {
  if (typeof (predicate as { validateAdd?: unknown }).validateAdd !== "function") return false;
  return (predicate as { validateAdd(nextValue: unknown): MutationValidation }).validateAdd(value);
}

export function validatePredicateRemove(
  predicate: AnyPredicate,
  value: unknown,
): MutationValidation {
  if (typeof (predicate as { validateRemove?: unknown }).validateRemove !== "function")
    return false;
  return (predicate as { validateRemove(nextValue: unknown): MutationValidation }).validateRemove(
    value,
  );
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

  return performValidatedMutation(
    callbacks,
    () => validatePredicateValue(predicate, undefined),
    () => false,
  );
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

export function getPredicateFieldDescription(predicate: AnyPredicate): string | undefined {
  return (getPredicateFieldMeta(predicate.field) as { description?: string } | undefined)
    ?.description;
}

export function collectFieldIssues({
  controller,
  issues,
}: Pick<AnyRenderableFieldProps, "controller" | "issues">): readonly ValidationIssue[] {
  if (!issues) {
    return emptyFieldIssues;
  }

  if (Array.isArray(issues)) {
    return controller ? collectValidationIssuesForPath(issues, controller.path) : issues;
  }

  if (!controller) {
    return emptyFieldIssues;
  }

  return isValidationIssueAggregate(issues) ? issues.getPathIssues(controller.path) : issues;
}

export function getFieldState(props: AnyRenderableFieldProps): AnyFieldState {
  const issues = collectFieldIssues(props);

  return {
    controller: props.controller,
    description: getPredicateFieldDescription(props.predicate),
    invalid: issues.length > 0,
    issues,
    label: getPredicateFieldLabel(props.predicate),
  };
}

export function DefaultFieldRow({
  children,
  fieldKind,
  state,
}: {
  children: ReactNode;
  fieldKind: string;
  state: AnyFieldState;
}) {
  return (
    <Field
      data-invalid={state.invalid || undefined}
      data-web-field-kind={fieldKind}
      data-web-field-mode="field"
      data-web-field-touched={state.controller?.getSnapshot().touched || undefined}
    >
      <FieldContent>
        <FieldTitle>{state.label}</FieldTitle>
        {state.description ? <FieldDescription>{state.description}</FieldDescription> : null}
        {children}
        <FieldError errors={state.issues} />
      </FieldContent>
    </Field>
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
