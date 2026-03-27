import { isSecretBackedField } from "@io/app/graph";
import { GraphIcon } from "@io/graph-module-core/react-dom";
import { type ReactNode } from "react";

import { PredicateRow, SecretFieldEditor } from "./field-editor.js";
import type {
  AnyPredicateRef,
  ExplorerRuntime,
  MutationCallbacks,
  SubmitSecretFieldMutation,
} from "./model.js";
import { EmptyState, Badge, Section } from "./ui.js";

export type InspectorFieldRow = {
  customEditor?: (callbacks: MutationCallbacks) => ReactNode;
  description?: string;
  display?: "compact" | "default";
  pathLabel: string;
  predicate?: AnyPredicateRef;
  readOnly?: boolean;
  title?: string;
  value?: ReactNode;
};

export function InspectorShell({
  badges,
  children,
  description,
  iconId,
  state,
  status,
  summaryItems = [],
  title,
  typeLabel,
}: {
  badges?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  iconId?: string;
  state: "entity" | "new" | "predicate" | "schema";
  status: string;
  summaryItems?: readonly string[];
  title: string;
  typeLabel: string;
}) {
  return (
    <div className="space-y-4" data-explorer-panel="inspector" data-explorer-state={state}>
      <Section
        right={
          <Badge
            className="border-border bg-muted/30 text-muted-foreground tracking-normal normal-case"
            data={{ "data-explorer-inspector-status": status }}
          >
            {status}
          </Badge>
        }
        title="Selection"
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            {typeof iconId === "string" && iconId.length > 0 ? (
              <GraphIcon className="text-muted-foreground size-12" iconId={iconId} />
            ) : null}
            <div className="min-w-0 space-y-1">
              <div
                className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase"
                data-explorer-inspector-type={typeLabel}
              >
                {typeLabel}
              </div>
              <h3 className="text-2xl font-semibold" data-explorer-inspector-title={title}>
                {title}
              </h3>
              {description ? (
                <div className="text-muted-foreground max-w-2xl text-sm">{description}</div>
              ) : null}
            </div>
          </div>

          {summaryItems.length > 0 ? (
            <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {summaryItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}

          {badges ? <div className="flex flex-wrap gap-2">{badges}</div> : null}
        </div>
      </Section>

      {children}
    </div>
  );
}

export function InspectorFieldSection({
  chrome = true,
  description,
  emptyMessage = "No shared fields are available for this selection.",
  hideMissingStatus = false,
  rows,
  runtime,
  submitSecretField,
  title = "Fields",
}: {
  chrome?: boolean;
  description?: string;
  emptyMessage?: string;
  hideMissingStatus?: boolean;
  rows: readonly InspectorFieldRow[];
  runtime?: ExplorerRuntime;
  submitSecretField?: SubmitSecretFieldMutation;
  title?: string;
}) {
  const content =
    rows.length > 0 ? (
      <div className="grid gap-4">
        {rows.map((row) => (
          <PredicateRow
            customEditor={
              row.predicate
                ? (row.customEditor ??
                  (runtime &&
                  submitSecretField &&
                  isSecretBackedField(row.predicate.field) &&
                  row.predicate.field.cardinality !== "many"
                    ? (callbacks) => (
                        <SecretFieldEditor
                          callbacks={callbacks}
                          predicate={row.predicate!}
                          runtime={runtime}
                          submitSecretField={submitSecretField}
                        />
                      )
                    : undefined))
                : undefined
            }
            description={row.description}
            display={row.display}
            hideMissingStatus={hideMissingStatus}
            key={
              row.predicate
                ? `${row.pathLabel}:${row.predicate.predicateId}`
                : `${row.pathLabel}:value`
            }
            pathLabel={row.pathLabel}
            predicate={row.predicate}
            readOnly={row.readOnly}
            title={row.title}
            value={row.value}
          />
        ))}
      </div>
    ) : (
      <EmptyState>{emptyMessage}</EmptyState>
    );

  if (!chrome) return content;

  return (
    <Section description={description} title={title}>
      {content}
    </Section>
  );
}
