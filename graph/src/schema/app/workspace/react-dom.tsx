import type { ObjectViewFieldSpec, ObjectViewSpec, PredicateRef } from "../../../index.js";
import { usePredicateField } from "../../../react/predicate.js";
import { performValidatedMutation } from "../../../react/mutation-validation.js";
import { PredicateFieldEditor } from "../../../react-dom/resolver.js";
import type { ReactNode } from "react";

import { workspaceManagementWorkflow } from "./workflows.js";
import {
  clearOptionalReference,
  findIssueName,
  setPredicateValue,
  useWorkspaceManagementModel,
  validatePredicateValue,
  type IssueSummary,
  type ReferenceOption,
  type WorkspaceManagementRuntime,
  type WorkspaceSection,
} from "./react.js";
import { workspaceIssueObjectView } from "./workspace-issue/index.js";
import { workspaceLabelObjectView } from "./workspace-label/index.js";
import { workspaceProjectObjectView } from "./workspace-project/index.js";

type AnyPredicate = PredicateRef<any, any>;
type WorkspaceFieldDescriptions = Record<string, string>;

const workspaceIssueFieldDescriptions: WorkspaceFieldDescriptions = {
  blockedBy: "Track upstream issues that must land before this one can move.",
  description: "Route notes and acceptance context.",
  dueDate: "Optional due date for route-owned scheduling cues.",
  identifier: "Linear-style issue key used in route-owned summaries.",
  labels: "Attach planning labels from the workspace label catalog.",
  name: "Short operator-facing title for the issue.",
  parent: "Optional parent link for stream and feature hierarchy.",
  priority:
    "Optional planning priority. Lower numbers indicate more urgent work in the seed data.",
  project: "Optional project link for grouping related issue work.",
  status: "Required workflow status from the workspace status lane.",
};

const workspaceProjectFieldDescriptions: WorkspaceFieldDescriptions = {
  color: "Visual token used by summaries and badges.",
  description: "Narrative context for the project outcome.",
  key: "Stable project key for route summaries.",
  name: "Operator-facing project title.",
  targetDate: "Expected milestone date for the project slice.",
};

const workspaceLabelFieldDescriptions: WorkspaceFieldDescriptions = {
  color: "Visual token for label chips.",
  description: "Optional notes for how the label is used.",
  key: "Stable key for route filtering and summaries.",
  name: "Label display name.",
};

const workspaceIssueRelatedDescriptions: WorkspaceFieldDescriptions = {
  blockedBy: "Browse linked issues from the route without leaving the workspace management surface.",
};

function formatDate(value: Date | undefined): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "No date";
  return value.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SurfaceField({
  children,
  description,
  field,
  label,
  span = 1,
}: {
  readonly children: ReactNode;
  readonly description?: string;
  readonly field: string;
  readonly label: string;
  readonly span?: 1 | 2;
}) {
  return (
    <section
      className={`grid gap-3 rounded-[1.6rem] border border-slate-200/80 bg-slate-50/80 p-4 ${
        span === 2 ? "xl:col-span-2" : ""
      }`}
      data-workspace-field={field}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
          <span className="text-[0.68rem] tracking-[0.22em] text-slate-400 uppercase">
            Workspace schema
          </span>
        </div>
        {description ? <p className="text-sm text-slate-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function DetailSection({
  children,
  description,
  sectionKey,
  title,
}: {
  readonly children: ReactNode;
  readonly description?: string;
  readonly sectionKey?: string;
  readonly title: string;
}) {
  return (
    <section
      className="grid gap-4 rounded-[1.8rem] border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-900/5"
      data-workspace-view-section={sectionKey}
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
        {description ? <p className="max-w-3xl text-sm text-slate-600">{description}</p> : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">{children}</div>
    </section>
  );
}

function SectionToggle({
  active,
  count,
  description,
  onClick,
  section,
  title,
}: {
  readonly active: boolean;
  readonly count: number;
  readonly description: string;
  readonly onClick: () => void;
  readonly section: WorkspaceSection;
  readonly title: string;
}) {
  return (
    <button
      className={`grid gap-1 rounded-[1.4rem] border px-4 py-3 text-left transition ${
        active
          ? "border-cyan-400/70 bg-cyan-50 text-cyan-950 shadow-sm shadow-cyan-900/10"
          : "border-slate-200 bg-white/80 text-slate-700 hover:border-slate-300 hover:bg-white"
      }`}
      data-workspace-tab={section}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-medium text-white">
          {count}
        </span>
      </div>
      <span className="text-sm text-slate-500">{description}</span>
    </button>
  );
}

function ListCard({
  active,
  children,
  kind,
  onClick,
  recordId,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly kind: "issue" | "project" | "label";
  readonly onClick: () => void;
  readonly recordId: string;
}) {
  return (
    <button
      className={`grid gap-2 rounded-[1.4rem] border px-4 py-4 text-left transition ${
        active
          ? "border-cyan-400/70 bg-slate-950 text-white shadow-lg shadow-slate-950/10"
          : "border-slate-200 bg-white/85 text-slate-800 hover:border-slate-300 hover:bg-white"
      }`}
      data-workspace-entity-item={recordId}
      data-workspace-entity-kind={kind}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function EmptyPanel({ message }: { readonly message: string }) {
  return (
    <div className="rounded-[1.8rem] border border-dashed border-slate-300 bg-slate-50/80 px-5 py-8 text-sm text-slate-500">
      {message}
    </div>
  );
}

function ReferenceSelectField({
  description,
  field,
  label,
  onMutationError,
  onMutationSuccess,
  options,
  predicate,
  placeholder,
  span,
}: {
  readonly description?: string;
  readonly field: string;
  readonly label: string;
  readonly onMutationError?: (error: unknown) => void;
  readonly onMutationSuccess?: () => void;
  readonly options: readonly ReferenceOption[];
  readonly placeholder: string;
  readonly predicate: AnyPredicate;
  readonly span?: 1 | 2;
}) {
  const { value } = usePredicateField(predicate);
  const selectedValue = typeof value === "string" ? value : "";
  const selectedOption = options.find((option) => option.id === selectedValue);

  return (
    <SurfaceField description={description} field={field} label={label} span={span}>
      <div className="grid gap-3">
        <select
          className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950"
          data-workspace-reference-select={field}
          onChange={(event) => {
            const nextValue = event.target.value;
            if (!nextValue) {
              clearOptionalReference(predicate, {
                onMutationError,
                onMutationSuccess,
              });
              return;
            }

            performValidatedMutation(
              { onMutationError, onMutationSuccess },
              () => validatePredicateValue(predicate, nextValue),
              () => setPredicateValue(predicate, nextValue),
            );
          }}
          value={selectedValue}
        >
          {predicate.field.cardinality === "one?" ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {selectedOption?.supporting ?? "No linked record selected."}
        </div>
      </div>
    </SurfaceField>
  );
}

function PredicateEditorField({
  description,
  field,
  label,
  onMutationError,
  onMutationSuccess,
  predicate,
  span,
}: {
  readonly description?: string;
  readonly field: string;
  readonly label: string;
  readonly onMutationError: (error: unknown) => void;
  readonly onMutationSuccess: () => void;
  readonly predicate: AnyPredicate;
  readonly span?: 1 | 2;
}) {
  return (
    <SurfaceField description={description} field={field} label={label} span={span}>
      <PredicateFieldEditor
        onMutationError={onMutationError}
        onMutationSuccess={onMutationSuccess}
        predicate={predicate}
      />
    </SurfaceField>
  );
}

function LinkedIssueList({
  issues,
  onOpenIssue,
}: {
  readonly issues: readonly IssueSummary[];
  readonly onOpenIssue: (issueId: string) => void;
}) {
  if (issues.length === 0) {
    return <EmptyPanel message="No issues are linked into this slice yet." />;
  }

  return (
    <div className="grid gap-3">
      {issues.map((issue) => (
        <button
          className="flex items-center justify-between gap-3 rounded-[1.3rem] border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-700 transition hover:border-slate-300 hover:bg-white"
          data-workspace-related-issue={issue.id}
          key={issue.id}
          onClick={() => onOpenIssue(issue.id)}
          type="button"
        >
          <span className="grid gap-1">
            <span className="font-medium text-slate-950">{issue.name}</span>
            <span className="text-xs text-slate-500">{issue.statusName}</span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
            {issue.identifier}
          </span>
        </button>
      ))}
    </div>
  );
}

function renderObjectViewSections({
  renderField,
  view,
}: {
  readonly renderField: (field: ObjectViewFieldSpec) => ReactNode;
  readonly view: ObjectViewSpec;
}) {
  return view.sections.map((section) => (
    <DetailSection
      description={section.description}
      key={section.key}
      sectionKey={section.key}
      title={section.title}
    >
      {section.fields.map((field) => renderField(field))}
    </DetailSection>
  ));
}

function IssueDetail({
  issueId,
  issues,
  onMutationError,
  onMutationSuccess,
  onOpenIssue,
  projectOptions,
  runtime,
  statusOptions,
}: {
  readonly issueId: string;
  readonly issues: readonly IssueSummary[];
  readonly onMutationError: (error: unknown) => void;
  readonly onMutationSuccess: () => void;
  readonly onOpenIssue: (issueId: string) => void;
  readonly projectOptions: readonly ReferenceOption[];
  readonly runtime: WorkspaceManagementRuntime;
  readonly statusOptions: readonly ReferenceOption[];
}) {
  const issueRef = runtime.graph.workspaceIssue.ref(issueId);
  const issue = runtime.graph.workspaceIssue.get(issueId);
  const parentOptions = issues
    .filter((candidate) => candidate.id !== issueId)
    .map((candidate) => ({
      id: candidate.id,
      label: `${candidate.identifier} ${candidate.name}`,
      supporting: candidate.statusName,
    }));
  const blockingIssues = issues.filter((candidate) => issue.blockedBy.includes(candidate.id));

  function renderIssueField(field: ObjectViewFieldSpec): ReactNode {
    const label = field.label ?? field.path;
    const description = workspaceIssueFieldDescriptions[field.path];

    switch (field.path) {
      case "identifier":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={issueRef.fields.identifier}
            span={field.span}
          />
        );
      case "name":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={issueRef.fields.name}
            span={field.span}
          />
        );
      case "description":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={issueRef.fields.description}
            span={field.span}
          />
        );
      case "status":
        return (
          <ReferenceSelectField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            options={statusOptions}
            placeholder="Select a status"
            predicate={issueRef.fields.status}
            span={field.span}
          />
        );
      case "project":
        return (
          <ReferenceSelectField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            options={projectOptions}
            placeholder="No project"
            predicate={issueRef.fields.project}
            span={field.span}
          />
        );
      case "priority":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={issueRef.fields.priority}
            span={field.span}
          />
        );
      case "dueDate":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={issueRef.fields.dueDate}
            span={field.span}
          />
        );
      case "parent":
        return (
          <ReferenceSelectField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            options={parentOptions}
            placeholder="No parent issue"
            predicate={issueRef.fields.parent}
            span={field.span}
          />
        );
      case "labels":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={issueRef.fields.labels}
            span={field.span}
          />
        );
      case "blockedBy":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={issueRef.fields.blockedBy}
            span={field.span}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div
      className="grid gap-5"
      data-workspace-object-view={workspaceIssueObjectView.key}
      data-workspace-panel="issues"
    >
      <section className="grid gap-4 rounded-[2rem] border border-slate-200/80 bg-slate-950 px-6 py-5 text-white shadow-xl shadow-slate-950/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs tracking-[0.24em] text-cyan-300 uppercase">Workspace issue</p>
            <h2 className="text-2xl font-semibold tracking-tight">{issue.name}</h2>
            <p className="max-w-3xl text-sm text-slate-300">
              Route-owned issue editing over typed workspace refs instead of the generic explorer.
            </p>
          </div>
          <div className="grid gap-2 text-right">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-100">
              {issue.identifier}
            </span>
            <span className="text-sm text-slate-300">
              {findIssueName(issues, issue.parent)
                ? `Parent: ${findIssueName(issues, issue.parent)}`
                : "Top-level issue"}
            </span>
          </div>
        </div>
      </section>

      {renderObjectViewSections({
        renderField: renderIssueField,
        view: workspaceIssueObjectView,
      })}

      {workspaceIssueObjectView.related?.map((related) => (
        <DetailSection
          description={workspaceIssueRelatedDescriptions[related.key]}
          key={related.key}
          sectionKey={related.key}
          title={related.title}
        >
          <div className="xl:col-span-2">
            <LinkedIssueList issues={blockingIssues} onOpenIssue={onOpenIssue} />
          </div>
        </DetailSection>
      ))}
    </div>
  );
}

function ProjectDetail({
  issues,
  onMutationError,
  onMutationSuccess,
  onOpenIssue,
  projectId,
  runtime,
}: {
  readonly issues: readonly IssueSummary[];
  readonly onMutationError: (error: unknown) => void;
  readonly onMutationSuccess: () => void;
  readonly onOpenIssue: (issueId: string) => void;
  readonly projectId: string;
  readonly runtime: WorkspaceManagementRuntime;
}) {
  const projectRef = runtime.graph.workspaceProject.ref(projectId);
  const project = runtime.graph.workspaceProject.get(projectId);
  const relatedIssues = issues.filter((issue) => issue.projectId === projectId);

  function renderProjectField(field: ObjectViewFieldSpec): ReactNode {
    const label = field.label ?? field.path;
    const description = workspaceProjectFieldDescriptions[field.path];

    switch (field.path) {
      case "name":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={projectRef.fields.name}
            span={field.span}
          />
        );
      case "key":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={projectRef.fields.key}
            span={field.span}
          />
        );
      case "description":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={projectRef.fields.description}
            span={field.span}
          />
        );
      case "color":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={projectRef.fields.color}
            span={field.span}
          />
        );
      case "targetDate":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={label}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={projectRef.fields.targetDate}
            span={field.span}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div
      className="grid gap-5"
      data-workspace-object-view={workspaceProjectObjectView.key}
      data-workspace-panel="projects"
    >
      <section className="grid gap-4 rounded-[2rem] border border-slate-200/80 bg-white/95 px-6 py-5 shadow-sm shadow-slate-900/5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs tracking-[0.24em] text-orange-700 uppercase">Workspace project</p>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{project.name}</h2>
            <p className="max-w-3xl text-sm text-slate-600">
              Projects anchor issue grouping, target dates, and route-owned planning context.
            </p>
          </div>
          <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {relatedIssues.length} linked issues
          </div>
        </div>
      </section>

      {renderObjectViewSections({
        renderField: renderProjectField,
        view: workspaceProjectObjectView,
      })}

      <DetailSection
        description="Project browse flows stay inside the route by opening linked issues directly."
        title="Linked issues"
      >
        <div className="xl:col-span-2">
          <LinkedIssueList issues={relatedIssues} onOpenIssue={onOpenIssue} />
        </div>
      </DetailSection>
    </div>
  );
}

function LabelDetail({
  issues,
  labelId,
  onMutationError,
  onMutationSuccess,
  onOpenIssue,
  runtime,
}: {
  readonly issues: readonly IssueSummary[];
  readonly labelId: string;
  readonly onMutationError: (error: unknown) => void;
  readonly onMutationSuccess: () => void;
  readonly onOpenIssue: (issueId: string) => void;
  readonly runtime: WorkspaceManagementRuntime;
}) {
  const labelRef = runtime.graph.workspaceLabel.ref(labelId);
  const label = runtime.graph.workspaceLabel.get(labelId);
  const relatedIssues = issues.filter((issue) => issue.labels.includes(labelId));

  function renderLabelField(field: ObjectViewFieldSpec): ReactNode {
    const labelText = field.label ?? field.path;
    const description = workspaceLabelFieldDescriptions[field.path];

    switch (field.path) {
      case "name":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={labelText}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={labelRef.fields.name}
            span={field.span}
          />
        );
      case "key":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={labelText}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={labelRef.fields.key}
            span={field.span}
          />
        );
      case "description":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={labelText}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={labelRef.fields.description}
            span={field.span}
          />
        );
      case "color":
        return (
          <PredicateEditorField
            description={description}
            field={field.path}
            key={field.path}
            label={labelText}
            onMutationError={onMutationError}
            onMutationSuccess={onMutationSuccess}
            predicate={labelRef.fields.color}
            span={field.span}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div
      className="grid gap-5"
      data-workspace-object-view={workspaceLabelObjectView.key}
      data-workspace-panel="labels"
    >
      <section className="grid gap-4 rounded-[2rem] border border-slate-200/80 bg-white/95 px-6 py-5 shadow-sm shadow-slate-900/5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs tracking-[0.24em] text-emerald-700 uppercase">Workspace label</p>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{label.name}</h2>
            <p className="max-w-3xl text-sm text-slate-600">
              Labels stay lightweight and reusable across issues while the route keeps ownership of
              the planning workflow presentation.
            </p>
          </div>
          <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Applied to {relatedIssues.length} issues
          </div>
        </div>
      </section>

      {renderObjectViewSections({
        renderField: renderLabelField,
        view: workspaceLabelObjectView,
      })}

      <DetailSection
        description="Jump back to the issues carrying this label without leaving the route."
        title="Applied issues"
      >
        <div className="xl:col-span-2">
          <LinkedIssueList issues={relatedIssues} onOpenIssue={onOpenIssue} />
        </div>
      </DetailSection>
    </div>
  );
}

export function WorkspaceManagementSurface({
  runtime,
}: {
  readonly runtime: WorkspaceManagementRuntime;
}) {
  const {
    error,
    issues,
    labels,
    onMutationError,
    onMutationSuccess,
    openIssue,
    projectOptions,
    projects,
    section,
    selectedIssueId,
    selectedLabelId,
    selectedProjectId,
    setSection,
    setSelectedIssueId,
    setSelectedLabelId,
    setSelectedProjectId,
    statusOptions,
    statuses,
    workspace,
  } = useWorkspaceManagementModel(runtime);

  if (!workspace) {
    return (
      <main
        className="mx-auto max-w-4xl rounded-[2rem] border border-dashed border-slate-300 bg-white/70 px-6 py-10 text-slate-600 shadow-sm shadow-slate-900/5"
        data-workspace-empty=""
      >
        No workspace seed was loaded into the app runtime.
      </main>
    );
  }

  return (
    <div
      className="mx-auto grid max-w-7xl gap-6"
      data-workspace-root=""
      data-workspace-workflow={workspaceManagementWorkflow.key}
    >
      <section className="grid gap-5 rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs tracking-[0.28em] text-cyan-700 uppercase">Workspace route</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
              {workspace.name}
            </h1>
            <p className="max-w-3xl text-sm text-slate-600">{workspace.description}</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-[1.4rem] bg-slate-950 px-4 py-3 text-white">
              <div className="text-xl font-semibold">{issues.length}</div>
              <div className="text-xs tracking-[0.2em] text-slate-300 uppercase">Issues</div>
            </div>
            <div className="rounded-[1.4rem] bg-slate-100 px-4 py-3 text-slate-950">
              <div className="text-xl font-semibold">{projects.length}</div>
              <div className="text-xs tracking-[0.2em] text-slate-500 uppercase">Projects</div>
            </div>
            <div className="rounded-[1.4rem] bg-slate-100 px-4 py-3 text-slate-950">
              <div className="text-xl font-semibold">{labels.length}</div>
              <div className="text-xs tracking-[0.2em] text-slate-500 uppercase">Labels</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {statuses.map((status) => (
            <div
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              data-workspace-status-summary={status.id}
              key={status.id}
            >
              <span className="font-medium">{status.name}</span>
              <span className="ml-2 text-slate-500">{status.issueCount}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="grid h-fit gap-4 rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-2xl shadow-slate-900/10 backdrop-blur">
          <div className="grid gap-3">
            <SectionToggle
              active={section === "issues"}
              count={issues.length}
              description="Browse routed issue planning records."
              onClick={() => setSection("issues")}
              section="issues"
              title="Issues"
            />
            <SectionToggle
              active={section === "projects"}
              count={projects.length}
              description="Inspect and edit project grouping records."
              onClick={() => setSection("projects")}
              section="projects"
              title="Projects"
            />
            <SectionToggle
              active={section === "labels"}
              count={labels.length}
              description="Manage reusable planning labels."
              onClick={() => setSection("labels")}
              section="labels"
              title="Labels"
            />
          </div>

          <div className="grid gap-3">
            {section === "issues"
              ? issues.map((issue) => (
                  <ListCard
                    active={selectedIssueId === issue.id}
                    key={issue.id}
                    kind="issue"
                    onClick={() => setSelectedIssueId(issue.id)}
                    recordId={issue.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full border border-white/15 bg-black/10 px-2.5 py-1 text-xs font-medium">
                        {issue.identifier}
                      </span>
                      <span className="text-xs text-slate-400">{issue.statusName}</span>
                    </div>
                    <div className="space-y-1">
                      <div className="font-semibold">{issue.name}</div>
                      <div className="text-sm text-slate-500">
                        {issue.projectName ?? "No project"} · {issue.labelCount} labels
                      </div>
                    </div>
                    <div className="text-xs text-slate-400">Due {formatDate(issue.dueDate)}</div>
                  </ListCard>
                ))
              : null}

            {section === "projects"
              ? projects.map((project) => (
                  <ListCard
                    active={selectedProjectId === project.id}
                    key={project.id}
                    kind="project"
                    onClick={() => setSelectedProjectId(project.id)}
                    recordId={project.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{project.name}</span>
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                    </div>
                    <div className="text-sm text-slate-500">{project.key}</div>
                    <div className="text-xs text-slate-400">
                      {project.issueCount} issues · target {formatDate(project.targetDate)}
                    </div>
                  </ListCard>
                ))
              : null}

            {section === "labels"
              ? labels.map((label) => (
                  <ListCard
                    active={selectedLabelId === label.id}
                    key={label.id}
                    kind="label"
                    onClick={() => setSelectedLabelId(label.id)}
                    recordId={label.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{label.name}</span>
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                    </div>
                    <div className="text-sm text-slate-500">{label.key}</div>
                    <div className="text-xs text-slate-400">{label.issueCount} issues tagged</div>
                  </ListCard>
                ))
              : null}
          </div>
        </aside>

        <section className="grid gap-4">
          {error ? (
            <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {error}
            </div>
          ) : null}

          {section === "issues" && selectedIssueId ? (
            <IssueDetail
              issueId={selectedIssueId}
              issues={issues}
              onMutationError={onMutationError}
              onMutationSuccess={onMutationSuccess}
              onOpenIssue={openIssue}
              projectOptions={projectOptions}
              runtime={runtime}
              statusOptions={statusOptions}
            />
          ) : null}

          {section === "projects" && selectedProjectId ? (
            <ProjectDetail
              issues={issues}
              onMutationError={onMutationError}
              onMutationSuccess={onMutationSuccess}
              onOpenIssue={openIssue}
              projectId={selectedProjectId}
              runtime={runtime}
            />
          ) : null}

          {section === "labels" && selectedLabelId ? (
            <LabelDetail
              issues={issues}
              labelId={selectedLabelId}
              onMutationError={onMutationError}
              onMutationSuccess={onMutationSuccess}
              onOpenIssue={openIssue}
              runtime={runtime}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
