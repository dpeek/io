import { edgeId, isEntityType, type AnyTypeOutput, type GraphStore, typeId } from "@io/app/graph";
import { formatValidationPath, GraphValidationError } from "@io/graph-client";
import { core, resolvePredicateDefinitionIconId, unknownIconSeed } from "@io/graph-module-core";
import { format as formatDate } from "date-fns";

import type { WriteSecretFieldWebAuthorityCommand } from "../../lib/authority.js";
import type {
  AnyPredicateRef,
  FieldStatus,
  FieldValidationMessage,
  SubmitSecretFieldMutation,
} from "./model.js";
import { cardinalityLabelById, explorerNamespace } from "./model.js";

const explorerTypeLabelById = new Map(
  Object.values(explorerNamespace).map((typeDef) => [
    typeId(typeDef),
    typeDef.values.name ?? humanizeIdentifier(typeDef.values.key),
  ]),
);

export function trimOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function formatTimestamp(value: Date | undefined): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "Not recorded";
  return value.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function readMutationError(
  status: number,
  statusText: string,
  payload: unknown,
  fallback: string,
): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return `${fallback} with ${status} ${statusText}.`;
}

export const postSecretFieldMutation: SubmitSecretFieldMutation = async (input) => {
  const command = {
    kind: "write-secret-field",
    input,
  } satisfies WriteSecretFieldWebAuthorityCommand;

  const response = await fetch("/api/commands", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const payload = (await response.json().catch(() => undefined)) as
    | { readonly error?: string }
    | Awaited<ReturnType<SubmitSecretFieldMutation>>
    | undefined;

  if (!response.ok) {
    throw new Error(
      readMutationError(response.status, response.statusText, payload, "Secret-field write failed"),
    );
  }

  return payload as Awaited<ReturnType<SubmitSecretFieldMutation>>;
};

export function getFirstObject(
  store: GraphStore,
  subjectId: string,
  predicateId: string,
): string | undefined {
  return store.facts(subjectId, predicateId)[0]?.o;
}

export function getNodeName(store: GraphStore, id: string): string {
  return getFirstObject(store, id, edgeId(core.node.fields.name)) ?? id;
}

export function humanizeIdentifier(text: string): string {
  const segment = text.split(":").at(-1) ?? text;
  const spaced = segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");
  return spaced.length > 0 ? `${spaced[0]!.toUpperCase()}${spaced.slice(1)}` : text;
}

export function getDefinitionDisplayLabel(name: string | undefined, key: string): string {
  return trimOptionalString(name ?? "") ?? humanizeIdentifier(key);
}

export function getUntitledEntityLabel(typeLabel: string): string {
  return `Untitled ${typeLabel}`;
}

export function getEntityLabel(
  entity: { id: string; get(): Record<string, unknown> },
  fallbackLabel = "Untitled record",
): string {
  const snapshot = entity.get();
  const name = snapshot.name;
  if (typeof name === "string" && name.length > 0) return name;
  return fallbackLabel;
}

export function getExplorerTypeLabel(
  typeIdValue: string,
  typeKeyById: ReadonlyMap<string, string>,
): string {
  const explorerLabel = explorerTypeLabelById.get(typeIdValue);
  if (explorerLabel) return explorerLabel;
  const typeKey = typeKeyById.get(typeIdValue);
  return typeKey ? humanizeIdentifier(typeKey) : typeIdValue;
}

export function formatCardinality(cardinality: "one" | "one?" | "many"): string {
  if (cardinality === "one") return "required";
  if (cardinality === "one?") return "optional";
  return "many";
}

export function formatGraphCardinality(valueId: string | undefined): string {
  if (!valueId) return "unset";
  return cardinalityLabelById.get(valueId) ?? valueId;
}

export function formatEntityHeaderDate(value: unknown): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return formatDate(value, "MMM d, yyyy h:mm a");
}

export function startCase(text: string): string {
  return text.length > 0 ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text;
}

export function getFieldLabel(predicate: AnyPredicateRef): string {
  const field = predicate.field as { key: string; meta?: { label?: string } };
  if (field.meta?.label) return field.meta.label;
  const segments = field.key.split(":");
  return segments.at(-1) ?? field.key;
}

export function getFieldRangeLabel(
  predicate: AnyPredicateRef,
  typeKeyById: ReadonlyMap<string, string>,
): string {
  const rangeName = predicate.rangeType?.values.name;
  const rangeKey = predicate.rangeType?.values.key;
  return (
    rangeName ??
    (rangeKey ? humanizeIdentifier(rangeKey) : undefined) ??
    getExplorerTypeLabel(predicate.field.range, typeKeyById)
  );
}

export function resolveDisplayedDefinitionIconId(
  compiledIconId: string,
  graphIconId: string | undefined,
): string {
  if (!graphIconId || graphIconId === unknownIconSeed.id) return compiledIconId;
  return graphIconId;
}

export function resolvePredicateRowIconId(
  predicate: AnyPredicateRef,
  graphIconId: string | undefined,
): string {
  return resolveDisplayedDefinitionIconId(
    resolvePredicateDefinitionIconId(predicate.field, predicate.rangeType as AnyTypeOutput),
    graphIconId,
  );
}

export function matchesQuery(query: string, ...parts: Array<string | undefined>): boolean {
  if (!query) return true;
  return parts.some((part) => part?.toLowerCase().includes(query));
}

export function describePredicateValue(predicate: AnyPredicateRef, value: unknown): FieldStatus {
  if (predicate.field.cardinality === "many") {
    const count = Array.isArray(value) ? value.length : 0;
    return count > 0
      ? { label: `${count} items`, tone: "present" }
      : { label: "empty", tone: "empty" };
  }

  if (value === undefined) {
    return predicate.field.cardinality === "one"
      ? { label: "missing", tone: "missing" }
      : { label: "unset", tone: "empty" };
  }

  if (typeof value === "string" && value.length === 0) {
    return { label: "empty string", tone: "empty" };
  }

  return { label: "set", tone: "present" };
}

export function statusBadgeClass(status: FieldStatus["tone"]): string {
  if (status === "missing") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  if (status === "empty") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
}

export function formatPredicateMetaSummary(
  predicate: AnyPredicateRef,
  options: {
    includeReadOnly?: boolean;
    status?: FieldStatus;
  },
): string {
  const parts: string[] = [];

  if (options.includeReadOnly) parts.unshift("Read only");
  if (
    options.status &&
    options.status.tone !== "present" &&
    options.status.label !== "unset" &&
    options.status.label !== "empty"
  ) {
    parts.push(startCase(options.status.label));
  }

  return parts.join(" · ");
}

function formatFieldValidationMessage(
  issue: {
    code: string;
    message: string;
    nodeId: string;
    path: readonly string[];
    predicateKey: string;
    source: string;
  },
  index: number,
): FieldValidationMessage {
  return {
    id: `${issue.nodeId}:${issue.predicateKey}:${issue.code}:${index}`,
    message: issue.message,
    pathLabel: formatValidationPath(issue.path),
    source: issue.source,
  };
}

export function collectValidationMessages(error: unknown): FieldValidationMessage[] {
  if (!(error instanceof GraphValidationError)) return [];

  return error.result.issues.map((issue, index) => formatFieldValidationMessage(issue, index));
}

export function collectValidationMessagesByPath(
  error: unknown,
): Map<string, FieldValidationMessage[]> {
  const grouped = new Map<string, FieldValidationMessage[]>();

  for (const message of collectValidationMessages(error)) {
    if (message.pathLabel.length === 0) continue;
    const existing = grouped.get(message.pathLabel);
    if (existing) {
      existing.push(message);
      continue;
    }
    grouped.set(message.pathLabel, [message]);
  }

  return grouped;
}

export function collectFieldValidationMessages(
  error: unknown,
  predicate: AnyPredicateRef,
): FieldValidationMessage[] {
  if (!(error instanceof GraphValidationError)) return [];
  const relevantByNode = error.result.issues.filter(
    (issue) => issue.nodeId === predicate.subjectId && issue.predicateKey === predicate.field.key,
  );
  const relevantByPredicate = error.result.issues.filter(
    (issue) => issue.predicateKey === predicate.field.key,
  );
  const issues =
    relevantByNode.length > 0
      ? relevantByNode
      : relevantByPredicate.length > 0
        ? relevantByPredicate
        : error.result.issues;

  return issues.map((issue, index) => formatFieldValidationMessage(issue, index));
}

export function checkToneClass(state: "aligned" | "drifted" | "missing"): string {
  if (state === "aligned") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (state === "drifted") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-rose-500/30 bg-rose-500/10 text-rose-200";
}

export function isEntityRange(predicate: AnyPredicateRef): boolean {
  return Boolean(predicate.rangeType && isEntityType(predicate.rangeType));
}
