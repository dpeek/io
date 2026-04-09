"use client";

import { Alert, AlertDescription, AlertTitle } from "@io/web/alert";
import { Badge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Checkbox } from "@io/web/checkbox";
import { Empty, EmptyDescription } from "@io/web/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@io/web/field";
import { Input } from "@io/web/input";
import { NativeSelect, NativeSelectOption } from "@io/web/native-select";
import { Textarea } from "@io/web/textarea";
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";

import {
  addQueryEditorFilter,
  addQueryEditorParameter,
  addQueryEditorSort,
  createQueryEditorDraft,
  createQueryEditorDefaultFilterValue,
  getQueryEditorField,
  getQueryEditorSurface,
  queryEditorDefaults,
  removeQueryEditorFilter,
  removeQueryEditorParameter,
  removeQueryEditorSort,
  normalizeQueryEditorDraft,
  serializeQueryEditorDraft,
  updateQueryEditorFilter,
  updateQueryEditorParameter,
  updateQueryEditorSort,
  validateQueryEditorDraft,
  type QueryEditorCatalog,
  type QueryEditorDraft,
  type QueryEditorFieldSpec,
  type QueryEditorParameterDraft,
  type QueryEditorRawValue,
  type QueryEditorValueDraft,
} from "../query-editor.js";
import {
  QueryEditorPredicateField,
  canUseQueryEditorPredicateFieldEditor,
} from "./query-editor-predicate-field.js";
import {
  describeUnsupportedQueryEditorFieldKind,
  getQueryEditorFieldKindForFilterOperator,
  getQueryEditorFieldKindForParameterType,
  isQueryEditorFieldKindSupported,
} from "../query-editor-value-semantics.js";

type QueryEditorProps = {
  readonly catalog: QueryEditorCatalog;
  readonly description?: string;
  readonly draft?: QueryEditorDraft;
  readonly footer?: ReactNode;
  readonly initialDraft?: QueryEditorDraft;
  readonly onDraftChange?: (draft: QueryEditorDraft) => void;
  readonly title?: string;
};

export function QueryEditor({
  catalog,
  description = "Author inline queries through typed controls, then inspect the generic serialized request.",
  draft: controlledDraft,
  footer,
  initialDraft,
  onDraftChange,
  title = "Query Editor Foundation",
}: QueryEditorProps) {
  const [uncontrolledDraft, setUncontrolledDraft] = useState(
    () => initialDraft ?? createQueryEditorDraft(catalog),
  );
  const draft = controlledDraft ?? uncontrolledDraft;
  const surface = getQueryEditorSurface(catalog, draft.surfaceId);
  const validation = validateQueryEditorDraft(draft, catalog);
  const serialized = validation.ok ? serializeQueryEditorDraft(draft, catalog) : undefined;
  const [normalizedPreview, setNormalizedPreview] = useState<string>();

  useEffect(() => {
    if (!controlledDraft) {
      return;
    }
    setUncontrolledDraft(controlledDraft);
  }, [controlledDraft]);

  useEffect(() => {
    let cancelled = false;
    if (!validation.ok) {
      setNormalizedPreview(undefined);
      return;
    }

    void normalizeQueryEditorDraft(draft, catalog)
      .then((normalized) => {
        if (!cancelled) {
          setNormalizedPreview(JSON.stringify(normalized.normalizedRequest, null, 2));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNormalizedPreview(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catalog, draft, validation.ok]);

  function updateDraft(next: QueryEditorDraft | ((current: QueryEditorDraft) => QueryEditorDraft)) {
    const resolved = typeof next === "function" ? next(draft) : next;
    if (controlledDraft === undefined) {
      setUncontrolledDraft(resolved);
    }
    onDraftChange?.(resolved);
  }

  return (
    <Card data-query-editor="">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{catalog.surfaces.length} surfaces</Badge>
            <Badge variant="outline">{draft.filters.length} filters</Badge>
            <Badge variant="outline">{draft.parameters.length} params</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <section className="grid gap-4" data-query-editor-section="source">
          <SectionHeader
            description="Pick a registered query surface. The editor resets to that surface's field catalog."
            title="Source"
          />
          <FieldGroup>
            <Field
              data-invalid={
                findIssues(validation.issues, "draft.surfaceId").length > 0 || undefined
              }
            >
              <FieldLabel htmlFor="query-editor-surface">Surface</FieldLabel>
              <FieldContent>
                <NativeSelect
                  aria-invalid={
                    findIssues(validation.issues, "draft.surfaceId").length > 0 || undefined
                  }
                  className="w-full"
                  id="query-editor-surface"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    updateDraft(createQueryEditorDraft(catalog, event.target.value));
                  }}
                  value={draft.surfaceId}
                >
                  {catalog.surfaces.map((candidate) => (
                    <NativeSelectOption key={candidate.surfaceId} value={candidate.surfaceId}>
                      {candidate.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {surface ? (
                  <FieldDescription>
                    {surface.description ?? `${surface.queryKind} query on ${surface.sourceKind}.`}
                  </FieldDescription>
                ) : null}
                <FieldError errors={findIssues(validation.issues, "draft.surfaceId")} />
              </FieldContent>
            </Field>
          </FieldGroup>
        </section>

        <section className="grid gap-4" data-query-editor-section="filters">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              description="Filter rows bind stable field ids but render control types from the surface catalog."
              title="Filters"
            />
            <Button
              onClick={() => {
                updateDraft((current) => addQueryEditorFilter(current, catalog));
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Add filter
            </Button>
          </div>
          {surface && draft.filters.length > 0 ? (
            <div className="grid gap-3">
              {draft.filters.map((filter, index) => {
                const field = getQueryEditorField(surface, filter.fieldId);
                const filterPath = `draft.filters[${index}]`;
                const filterFieldIssues = findIssues(validation.issues, `${filterPath}.fieldId`);
                const filterOperatorIssues = findIssues(
                  validation.issues,
                  `${filterPath}.operator`,
                );
                const filterValueIssues = findIssues(validation.issues, `${filterPath}.value`);
                if (!field) {
                  return null;
                }
                return (
                  <Card key={filter.id} size="sm">
                    <CardContent className="grid gap-4 pt-6">
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_auto]">
                        <Field data-invalid={filterFieldIssues.length > 0 || undefined}>
                          <FieldLabel htmlFor={`${filter.id}-field`}>Field</FieldLabel>
                          <FieldContent>
                            <NativeSelect
                              aria-invalid={filterFieldIssues.length > 0 || undefined}
                              className="w-full"
                              id={`${filter.id}-field`}
                              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                updateDraft((current) =>
                                  updateQueryEditorFilter(
                                    current,
                                    filter.id,
                                    { fieldId: event.target.value },
                                    catalog,
                                  ),
                                );
                              }}
                              value={filter.fieldId}
                            >
                              {surface.fields.map((candidate) => (
                                <NativeSelectOption
                                  key={candidate.fieldId}
                                  value={candidate.fieldId}
                                >
                                  {candidate.label}
                                  {isQueryEditorFieldKindSupported(candidate.kind)
                                    ? ""
                                    : " (unsupported)"}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                            <FieldDescription>
                              {field.description ?? field.fieldId}
                            </FieldDescription>
                            <FieldError errors={filterFieldIssues} />
                          </FieldContent>
                        </Field>
                        <Field data-invalid={filterOperatorIssues.length > 0 || undefined}>
                          <FieldLabel htmlFor={`${filter.id}-operator`}>Operator</FieldLabel>
                          <FieldContent>
                            <NativeSelect
                              aria-invalid={filterOperatorIssues.length > 0 || undefined}
                              className="w-full"
                              id={`${filter.id}-operator`}
                              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                updateDraft((current) =>
                                  updateQueryEditorFilter(
                                    current,
                                    filter.id,
                                    {
                                      operator: event.target
                                        .value as QueryEditorDraft["filters"][number]["operator"],
                                    },
                                    catalog,
                                  ),
                                );
                              }}
                              value={filter.operator}
                            >
                              {field.filterOperators.map((operator) => (
                                <NativeSelectOption key={operator} value={operator}>
                                  {operator}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                            <FieldError errors={filterOperatorIssues} />
                          </FieldContent>
                        </Field>
                        <Field data-invalid={filterValueIssues.length > 0 || undefined}>
                          <FieldLabel htmlFor={`${filter.id}-value-mode`}>Value</FieldLabel>
                          <FieldContent className="grid gap-3">
                            <NativeSelect
                              className="w-full"
                              id={`${filter.id}-value-mode`}
                              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                updateDraft((current) =>
                                  updateQueryEditorFilter(
                                    current,
                                    filter.id,
                                    {
                                      value:
                                        event.target.value === "param"
                                          ? { kind: "param", name: "" }
                                          : createQueryEditorDefaultFilterValue(
                                              field,
                                              filter.operator,
                                            ),
                                    },
                                    catalog,
                                  ),
                                );
                              }}
                              value={filter.value.kind}
                            >
                              <NativeSelectOption value="literal">Literal</NativeSelectOption>
                              <NativeSelectOption value="param">Parameter</NativeSelectOption>
                            </NativeSelect>
                            <FilterValueEditor
                              field={field}
                              filterId={filter.id}
                              invalid={filterValueIssues.length > 0}
                              operator={filter.operator}
                              value={filter.value}
                              onChange={(value) => {
                                updateDraft((current) =>
                                  updateQueryEditorFilter(current, filter.id, { value }, catalog),
                                );
                              }}
                            />
                            <FieldError errors={filterValueIssues} />
                          </FieldContent>
                        </Field>
                        <div className="flex items-end">
                          <Button
                            onClick={() => {
                              updateDraft((current) => removeQueryEditorFilter(current, filter.id));
                            }}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No filters yet." />
          )}
          <ValidationSummary issues={findIssues(validation.issues, "draft.filters")} />
        </section>

        <section className="grid gap-4" data-query-editor-section="sort">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              description="Sorts stay limited to the ordering fields the current surface catalog registers."
              title="Sort And Pagination"
            />
            <Button
              onClick={() => {
                updateDraft((current) => addQueryEditorSort(current, catalog));
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Add sort
            </Button>
          </div>
          <div className="grid gap-4">
            <Field
              data-invalid={
                findIssues(validation.issues, "draft.pagination.after").length > 0 || undefined
              }
            >
              <FieldLabel htmlFor="query-editor-after">After cursor</FieldLabel>
              <FieldContent>
                <Input
                  aria-invalid={
                    findIssues(validation.issues, "draft.pagination.after").length > 0 || undefined
                  }
                  id="query-editor-after"
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    updateDraft((current) => ({
                      ...current,
                      pagination: {
                        ...current.pagination,
                        after: nextValue,
                      },
                    }));
                  }}
                  placeholder="Opaque pagination cursor"
                  value={draft.pagination.after}
                />
                <FieldError errors={findIssues(validation.issues, "draft.pagination.after")} />
              </FieldContent>
            </Field>
            <Field
              data-invalid={
                findIssues(validation.issues, "draft.pagination.limit").length > 0 || undefined
              }
            >
              <FieldLabel htmlFor="query-editor-limit">Default page size</FieldLabel>
              <FieldContent>
                <Input
                  aria-invalid={
                    findIssues(validation.issues, "draft.pagination.limit").length > 0 || undefined
                  }
                  id="query-editor-limit"
                  min={1}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    updateDraft((current) => ({
                      ...current,
                      pagination: {
                        ...current.pagination,
                        limit: nextValue === "" ? 0 : Number(nextValue),
                      },
                    }));
                  }}
                  type="number"
                  value={String(draft.pagination.limit)}
                />
                <FieldError errors={findIssues(validation.issues, "draft.pagination.limit")} />
              </FieldContent>
            </Field>
            {surface && draft.sorts.length > 0 ? (
              <div className="grid gap-3">
                {draft.sorts.map((sort, index) => (
                  <Card key={sort.id} size="sm">
                    <CardContent className="grid gap-4 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto]">
                      <Field
                        data-invalid={
                          findIssues(validation.issues, `draft.sorts[${index}].fieldId`).length >
                            0 || undefined
                        }
                      >
                        <FieldLabel htmlFor={`${sort.id}-field`}>Field</FieldLabel>
                        <FieldContent>
                          <NativeSelect
                            aria-invalid={
                              findIssues(validation.issues, `draft.sorts[${index}].fieldId`)
                                .length > 0 || undefined
                            }
                            className="w-full"
                            id={`${sort.id}-field`}
                            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                              updateDraft((current) =>
                                updateQueryEditorSort(current, sort.id, {
                                  fieldId: event.target.value,
                                }),
                              );
                            }}
                            value={sort.fieldId}
                          >
                            {(surface.sortFields ?? []).map((field) => (
                              <NativeSelectOption key={field.fieldId} value={field.fieldId}>
                                {field.label}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                          <FieldError
                            errors={findIssues(validation.issues, `draft.sorts[${index}].fieldId`)}
                          />
                        </FieldContent>
                      </Field>
                      <Field
                        data-invalid={
                          findIssues(validation.issues, `draft.sorts[${index}].direction`).length >
                            0 || undefined
                        }
                      >
                        <FieldLabel htmlFor={`${sort.id}-direction`}>Direction</FieldLabel>
                        <FieldContent>
                          <NativeSelect
                            aria-invalid={
                              findIssues(validation.issues, `draft.sorts[${index}].direction`)
                                .length > 0 || undefined
                            }
                            className="w-full"
                            id={`${sort.id}-direction`}
                            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                              updateDraft((current) =>
                                updateQueryEditorSort(current, sort.id, {
                                  direction: event.target
                                    .value as QueryEditorDraft["sorts"][number]["direction"],
                                }),
                              );
                            }}
                            value={sort.direction}
                          >
                            {(
                              surface.sortFields?.find((field) => field.fieldId === sort.fieldId)
                                ?.directions ?? ["asc", "desc"]
                            ).map((direction) => (
                              <NativeSelectOption key={direction} value={direction}>
                                {direction}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                          <FieldError
                            errors={findIssues(
                              validation.issues,
                              `draft.sorts[${index}].direction`,
                            )}
                          />
                        </FieldContent>
                      </Field>
                      <div className="flex items-end">
                        <Button
                          onClick={() => {
                            updateDraft((current) => removeQueryEditorSort(current, sort.id));
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Remove
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState message="No sort clauses yet." />
            )}
          </div>
          <ValidationSummary issues={findIssues(validation.issues, "draft.sorts")} />
        </section>

        <section className="grid gap-4" data-query-editor-section="parameters">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              description="Parameter definitions stay alongside the query draft so inline previews and future saved queries share one model."
              title="Parameters"
            />
            <Button
              onClick={() => {
                updateDraft((current) => addQueryEditorParameter(current));
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Add parameter
            </Button>
          </div>
          {draft.parameters.length > 0 ? (
            <div className="grid gap-3">
              {draft.parameters.map((parameter, index) => (
                <Card key={parameter.id} size="sm">
                  <CardContent className="grid gap-4 pt-6">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,1fr)_auto]">
                      <ParameterEditor
                        issues={validation.issues}
                        index={index}
                        onChange={(update) => {
                          updateDraft((current) =>
                            updateQueryEditorParameter(current, parameter.id, update),
                          );
                        }}
                        parameter={parameter}
                      />
                      <div className="flex items-end">
                        <Button
                          onClick={() => {
                            updateDraft((current) =>
                              removeQueryEditorParameter(current, parameter.id),
                            );
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState message="No parameter definitions yet." />
          )}
          <ValidationSummary issues={findIssues(validation.issues, "draft.parameters")} />
        </section>

        <section className="grid gap-4" data-query-editor-section="advanced">
          <SectionHeader
            description="Inspect the generic request shape before execution or save."
            title="Advanced"
          />
          <details className="grid gap-4 rounded-2xl border border-dashed p-4" open>
            <summary className="cursor-pointer text-sm font-medium">Serialized request</summary>
            {validation.ok && serialized ? (
              <div className="grid gap-4">
                <pre className="bg-muted/30 overflow-x-auto rounded-[1rem] px-4 py-3 text-xs whitespace-pre-wrap">
                  {JSON.stringify(serialized.request, null, 2)}
                </pre>
                <pre className="bg-muted/30 overflow-x-auto rounded-[1rem] px-4 py-3 text-xs whitespace-pre-wrap">
                  {JSON.stringify(serialized.parameterDefinitions, null, 2)}
                </pre>
                {normalizedPreview ? (
                  <pre className="bg-muted/30 overflow-x-auto rounded-[1rem] px-4 py-3 text-xs whitespace-pre-wrap">
                    {normalizedPreview}
                  </pre>
                ) : null}
              </div>
            ) : (
              <ValidationSummary
                issues={validation.issues}
                title="Resolve the draft validation issues before inspecting the serialized request."
              />
            )}
          </details>
        </section>
        {footer ? <section data-query-editor-section="footer">{footer}</section> : null}
      </CardContent>
    </Card>
  );
}

function SectionHeader({
  description,
  title,
}: {
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{title}</div>
      <p className="text-muted-foreground text-xs leading-5">{description}</p>
    </div>
  );
}

function EmptyState({ message }: { readonly message: string }) {
  return (
    <Empty className="border-border bg-muted/20 flex-none p-4">
      <EmptyDescription className="text-sm">{message}</EmptyDescription>
    </Empty>
  );
}

function ValidationSummary({
  issues,
  title = issues.length === 1 ? "Validation issue" : "Validation issues",
}: {
  readonly issues: readonly { code: string; message: string; path: string }[];
  readonly title?: string;
}) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {issues.length === 1 ? (
          issues[0]?.message
        ) : (
          <ul className="ml-4 flex list-disc flex-col gap-1">
            {issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                <span className="font-medium">{issue.code}</span>: {issue.message}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

function findIssues(
  issues: readonly { code: string; message: string; path: string }[],
  prefix: string,
) {
  return issues.filter((issue) => issue.path === prefix || issue.path.startsWith(`${prefix}.`));
}

function FilterValueEditor({
  field,
  filterId,
  invalid = false,
  operator,
  onChange,
  value,
}: {
  readonly field: QueryEditorFieldSpec;
  readonly filterId: string;
  readonly invalid?: boolean;
  readonly operator: QueryEditorDraft["filters"][number]["operator"];
  readonly onChange: (value: QueryEditorValueDraft) => void;
  readonly value: QueryEditorValueDraft;
}) {
  const unsupportedFieldKindMessage = describeUnsupportedQueryEditorFieldKind(field.kind);
  if (unsupportedFieldKindMessage) {
    return (
      <UnsupportedFieldKindNotice
        kind={field.kind}
        message={`Field "${field.fieldId}" is excluded from query authoring. ${unsupportedFieldKindMessage}`}
      />
    );
  }

  if (value.kind === "param") {
    return (
      <Input
        aria-invalid={invalid || undefined}
        data-query-editor-control="parameter"
        id={`${filterId}-param`}
        onChange={(event) => {
          onChange({ kind: "param", name: event.target.value });
        }}
        placeholder="parameter-name"
        value={value.name}
      />
    );
  }

  if (operator === "exists") {
    return (
      <NativeSelect
        aria-invalid={invalid || undefined}
        className="w-full"
        data-query-editor-control="boolean"
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          onChange({ kind: "literal", value: event.target.value === "true" });
        }}
        value={value.value === true ? "true" : "false"}
      >
        <NativeSelectOption value="true">true</NativeSelectOption>
        <NativeSelectOption value="false">false</NativeSelectOption>
      </NativeSelect>
    );
  }

  if (operator === "in") {
    return renderListEditor(field, value.value, onChange, invalid);
  }

  const editorKind = getQueryEditorFieldKindForFilterOperator(field.kind, operator);

  if (canUseQueryEditorPredicateFieldEditor(editorKind, field.options)) {
    return (
      <QueryEditorPredicateField
        kind={editorKind}
        label={field.label}
        onChange={(nextValue) => {
          onChange({ kind: "literal", value: nextValue });
        }}
        options={field.options}
        path={`${filterId}.literal`}
        rawValue={value.value}
      />
    );
  }

  switch (field.control) {
    case "enum":
    case "entity-ref":
      if (!field.options?.length) {
        return (
          <Input
            aria-invalid={invalid || undefined}
            data-query-editor-control={field.control}
            onChange={(event) => {
              onChange({ kind: "literal", value: event.target.value });
            }}
            value={typeof value.value === "string" ? value.value : ""}
          />
        );
      }
      return (
        <NativeSelect
          aria-invalid={invalid || undefined}
          className="w-full"
          data-query-editor-control={field.control}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            onChange({ kind: "literal", value: event.target.value });
          }}
          value={typeof value.value === "string" ? value.value : ""}
        >
          {(field.options ?? []).map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
    case "date":
      return (
        <Input
          aria-invalid={invalid || undefined}
          data-query-editor-control="date"
          onChange={(event) => {
            onChange({ kind: "literal", value: event.target.value });
          }}
          type="date"
          value={typeof value.value === "string" ? value.value : ""}
        />
      );
    case "boolean":
      return (
        <NativeSelect
          aria-invalid={invalid || undefined}
          className="w-full"
          data-query-editor-control="boolean"
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            onChange({ kind: "literal", value: event.target.value === "true" });
          }}
          value={value.value === true ? "true" : "false"}
        >
          <NativeSelectOption value="true">true</NativeSelectOption>
          <NativeSelectOption value="false">false</NativeSelectOption>
        </NativeSelect>
      );
    case "text":
      return (
        <Input
          aria-invalid={invalid || undefined}
          data-query-editor-control="text"
          onChange={(event) => {
            onChange({ kind: "literal", value: event.target.value });
          }}
          value={typeof value.value === "string" ? value.value : ""}
        />
      );
    case "number":
      return (
        <Input
          aria-invalid={invalid || undefined}
          data-query-editor-control="number"
          onChange={(event) => {
            onChange({ kind: "literal", value: event.target.value });
          }}
          type="number"
          value={String(typeof value.value === "number" ? value.value : (value.value ?? ""))}
        />
      );
  }
}

function UnsupportedFieldKindNotice({
  kind,
  message,
}: {
  readonly kind: QueryEditorFieldSpec["kind"];
  readonly message: string;
}) {
  return (
    <Alert
      data-query-editor-control="unsupported"
      data-query-editor-unsupported-kind={kind}
      variant="destructive"
    >
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function renderListEditor(
  field: QueryEditorFieldSpec,
  value: QueryEditorRawValue,
  onChange: (value: QueryEditorValueDraft) => void,
  invalid = false,
) {
  const stringListValue = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
  const numberListValue = Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === "number")
    : [];
  const booleanListValue = Array.isArray(value)
    ? value.filter((entry): entry is boolean => typeof entry === "boolean")
    : [];
  if ((field.kind === "enum" || field.kind === "entity-ref") && field.options?.length) {
    return (
      <NativeSelect
        aria-invalid={invalid || undefined}
        className="w-full"
        data-query-editor-control={field.control}
        multiple
        onChange={(event) => {
          onChange({
            kind: "literal",
            value: Array.from(event.target.selectedOptions, (option) => option.value),
          });
        }}
        value={stringListValue}
      >
        {field.options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }

  if (field.kind === "boolean") {
    return (
      <Textarea
        aria-invalid={invalid || undefined}
        data-query-editor-control="boolean"
        onChange={(event) => {
          onChange({
            kind: "literal",
            value: event.target.value
              .split(",")
              .map((entry) => entry.trim().toLowerCase())
              .filter((entry) => entry === "true" || entry === "false")
              .map((entry) => entry === "true"),
          });
        }}
        placeholder="true, false"
        value={booleanListValue.join(", ")}
      />
    );
  }

  if (field.kind === "number" || field.kind === "percent") {
    return (
      <Textarea
        aria-invalid={invalid || undefined}
        data-query-editor-control="number"
        onChange={(event) => {
          onChange({
            kind: "literal",
            value: event.target.value
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
              .map((entry) => Number(entry))
              .filter((entry) => Number.isFinite(entry)),
          });
        }}
        placeholder="1, 2, 3"
        value={numberListValue.join(", ")}
      />
    );
  }

  return (
    <Textarea
      aria-invalid={invalid || undefined}
      data-query-editor-control={field.control}
      onChange={(event) => {
        onChange({
          kind: "literal",
          value: event.target.value
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        });
      }}
      placeholder="value-a, value-b"
      value={stringListValue.join(", ")}
    />
  );
}

function ParameterEditor({
  index,
  issues,
  onChange,
  parameter,
}: {
  readonly index: number;
  readonly issues: readonly { code: string; message: string; path: string }[];
  readonly onChange: (update: Partial<QueryEditorParameterDraft>) => void;
  readonly parameter: QueryEditorParameterDraft;
}) {
  const path = `draft.parameters[${index}]`;
  const nameIssues = findIssues(issues, `${path}.name`);
  const defaultIssues = findIssues(issues, `${path}.defaultValue`);

  return (
    <>
      <Field data-invalid={nameIssues.length > 0 || undefined}>
        <FieldLabel htmlFor={`${parameter.id}-name`}>Name</FieldLabel>
        <FieldContent>
          <Input
            aria-invalid={nameIssues.length > 0 || undefined}
            id={`${parameter.id}-name`}
            onChange={(event) => {
              onChange({ name: event.target.value });
            }}
            value={parameter.name}
          />
          <FieldError errors={nameIssues} />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${parameter.id}-label`}>Label</FieldLabel>
        <FieldContent>
          <Input
            id={`${parameter.id}-label`}
            onChange={(event) => {
              onChange({ label: event.target.value });
            }}
            value={parameter.label}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${parameter.id}-type`}>Type</FieldLabel>
        <FieldContent>
          <NativeSelect
            className="w-full"
            id={`${parameter.id}-type`}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              onChange({
                defaultValue: defaultParameterValue(event.target.value),
                type: event.target.value as QueryEditorParameterDraft["type"],
              });
            }}
            value={parameter.type}
          >
            {queryEditorDefaults.parameterTypes.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {type}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FieldContent>
      </Field>
      <Field data-invalid={defaultIssues.length > 0 || undefined}>
        <FieldLabel htmlFor={`${parameter.id}-default`}>Default</FieldLabel>
        <FieldContent className="grid gap-3">
          <ParameterDefaultEditor
            invalid={defaultIssues.length > 0}
            parameter={parameter}
            onChange={(defaultValue) => {
              onChange({ defaultValue });
            }}
          />
          <FieldError errors={defaultIssues} />
          <Field orientation="horizontal">
            <FieldLabel htmlFor={`${parameter.id}-required`}>
              <Checkbox
                checked={parameter.required}
                id={`${parameter.id}-required`}
                onCheckedChange={(checked) => {
                  onChange({ required: checked === true });
                }}
              />
              <FieldContent>
                <FieldTitle>Required</FieldTitle>
                <FieldDescription>
                  Require callers to provide this parameter instead of relying on the default.
                </FieldDescription>
              </FieldContent>
            </FieldLabel>
          </Field>
        </FieldContent>
      </Field>
    </>
  );
}

function ParameterDefaultEditor({
  invalid = false,
  onChange,
  parameter,
}: {
  readonly invalid?: boolean;
  readonly onChange: (value: QueryEditorRawValue) => void;
  readonly parameter: QueryEditorParameterDraft;
}) {
  if (supportsPredicateFieldEditorParameterType(parameter.type)) {
    return (
      <QueryEditorPredicateField
        kind={getQueryEditorFieldKindForParameterType(parameter.type)}
        label={parameter.label}
        onChange={onChange}
        optional
        path={`${parameter.id}.default`}
        rawValue={parameter.defaultValue}
      />
    );
  }

  switch (parameter.type) {
    case "boolean":
      return (
        <NativeSelect
          aria-invalid={invalid || undefined}
          className="w-full"
          data-query-editor-control="boolean"
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            onChange(event.target.value === "true");
          }}
          value={parameter.defaultValue === true ? "true" : "false"}
        >
          <NativeSelectOption value="true">true</NativeSelectOption>
          <NativeSelectOption value="false">false</NativeSelectOption>
        </NativeSelect>
      );
    case "boolean-list":
      return (
        <Textarea
          aria-invalid={invalid || undefined}
          data-query-editor-control="boolean"
          onChange={(event) => {
            onChange(
              event.target.value
                .split(",")
                .map((entry) => entry.trim().toLowerCase())
                .filter((entry) => entry === "true" || entry === "false")
                .map((entry) => entry === "true"),
            );
          }}
          placeholder="true, false"
          value={
            Array.isArray(parameter.defaultValue)
              ? parameter.defaultValue
                  .filter((value): value is boolean => typeof value === "boolean")
                  .join(", ")
              : ""
          }
        />
      );
    case "number-list":
    case "percent-list":
      return (
        <Textarea
          aria-invalid={invalid || undefined}
          data-query-editor-control="number"
          onChange={(event) => {
            onChange(
              event.target.value
                .split(",")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0)
                .map((entry) => Number(entry))
                .filter((entry) => Number.isFinite(entry)),
            );
          }}
          placeholder="1, 2, 3"
          value={
            Array.isArray(parameter.defaultValue)
              ? parameter.defaultValue
                  .filter((value): value is number => typeof value === "number")
                  .join(", ")
              : ""
          }
        />
      );
    case "string-list":
    case "date-list":
    case "enum-list":
    case "entity-ref-list":
    case "url-list":
    case "email-list":
    case "color-list":
    case "duration-list":
    case "money-list":
    case "quantity-list":
    case "range-list":
    case "rate-list":
      return (
        <Textarea
          aria-invalid={invalid || undefined}
          data-query-editor-control="text"
          onChange={(event) => {
            onChange(
              event.target.value
                .split(",")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0),
            );
          }}
          placeholder="value-a, value-b"
          value={Array.isArray(parameter.defaultValue) ? parameter.defaultValue.join(", ") : ""}
        />
      );
    case "enum":
    case "entity-ref":
      return (
        <Input
          aria-invalid={invalid || undefined}
          data-query-editor-control={parameter.type === "entity-ref" ? "entity-ref" : "text"}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          value={typeof parameter.defaultValue === "string" ? parameter.defaultValue : ""}
        />
      );
  }
}

function defaultParameterValue(type: string): QueryEditorRawValue {
  switch (type) {
    case "boolean":
      return false;
    case "number":
    case "percent":
      return 0;
    case "string-list":
    case "number-list":
    case "boolean-list":
    case "date-list":
    case "enum-list":
    case "entity-ref-list":
    case "url-list":
    case "email-list":
    case "color-list":
    case "percent-list":
    case "duration-list":
    case "money-list":
    case "quantity-list":
    case "range-list":
    case "rate-list":
      return [];
    default:
      return "";
  }
}

function supportsPredicateFieldEditorParameterType(
  type: QueryEditorParameterDraft["type"],
): type is
  | "string"
  | "number"
  | "date"
  | "url"
  | "email"
  | "color"
  | "percent"
  | "duration"
  | "money"
  | "quantity"
  | "range"
  | "rate" {
  switch (type) {
    case "string":
    case "number":
    case "date":
    case "url":
    case "email":
    case "color":
    case "percent":
    case "duration":
    case "money":
    case "quantity":
    case "range":
    case "rate":
      return true;
    default:
      return false;
  }
}
