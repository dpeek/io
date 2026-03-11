import { relative } from "node:path";

import type {
  AgentIssue,
  ManagedCommentChildMutation,
  ResolvedContextBundle,
  WorkflowModule,
} from "./types.js";
import {
  MANAGED_BACKLOG_PROPOSAL_END,
  MANAGED_BACKLOG_PROPOSAL_START,
} from "./backlog-proposal.js";

export const MANAGED_STREAM_FOCUS_DOC_PATH = "./llm/topic/goals.md";

type ManagedBacklogOption = {
  alignment: string;
  focus: string;
  title: string;
};

type MarkdownSection = {
  heading?: string;
  lines: string[];
};

function uniqueOrdered(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function toRepoRelativePath(repoRoot: string, path: string) {
  const value = relative(repoRoot, path).replace(/\\/g, "/");
  return value.startsWith(".") ? value : `./${value}`;
}

function isListItem(line: string) {
  return /^\s*(?:[-*+]|\d+\.)\s+/.test(line);
}

function splitMarkdownSections(content: string) {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { lines: [] };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (current.heading || current.lines.length) {
        sections.push(current);
      }
      current = {
        heading: headingMatch[2]?.trim(),
        lines: [],
      };
      continue;
    }
    current.lines.push(line);
  }

  if (current.heading || current.lines.length) {
    sections.push(current);
  }
  return sections;
}

function extractBullets(section: MarkdownSection, maxItems: number) {
  const bullets = section.lines
    .filter((line) => isListItem(line))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim())
    .filter(Boolean);
  return bullets.slice(0, maxItems);
}

function findSectionBullets(options: {
  content: string;
  fallback: string[];
  headings: string[];
  maxItems: number;
}) {
  const { content, fallback, headings, maxItems } = options;
  const headingPatterns = headings.map((heading) => new RegExp(`^${heading}$`, "i"));
  const sections = splitMarkdownSections(content);
  const bullets = uniqueOrdered(
    sections
      .filter((section) =>
        headingPatterns.some((pattern) => Boolean(section.heading && pattern.test(section.heading))),
      )
      .flatMap((section) => extractBullets(section, maxItems)),
  );
  return uniqueOrdered([...bullets, ...fallback]).slice(0, maxItems);
}

export function parseManagedBacklogOptions(description: string): ManagedBacklogOption[] {
  const start = description.indexOf(MANAGED_BACKLOG_PROPOSAL_START);
  const end = description.indexOf(MANAGED_BACKLOG_PROPOSAL_END);
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const blockLines = description
    .slice(start + MANAGED_BACKLOG_PROPOSAL_START.length, end)
    .split(/\r?\n/);
  const options: ManagedBacklogOption[] = [];

  for (let index = 0; index < blockLines.length; index++) {
    const title = blockLines[index]?.match(/^\d+\.\s+\*\*(.+?)\*\*$/)?.[1]?.trim();
    const focus = blockLines[index + 1]?.match(/^\s*Focus:\s*(.+)$/)?.[1]?.trim();
    const alignment = blockLines[index + 2]?.match(/^\s*Alignment:\s*(.+)$/)?.[1]?.trim();
    if (!title || !focus || !alignment) {
      continue;
    }
    options.push({ alignment, focus, title });
  }

  return options;
}

function renderManagedBacklogChildDescription(options: {
  docs: string[];
  issue: AgentIssue;
  note?: string;
  option: ManagedBacklogOption;
  primaryModuleId: string;
}) {
  const docLines = options.docs.length
    ? options.docs.map((doc) => `- ${doc}`)
    : ["- Reuse the parent issue brief and module defaults."];
  const noteLines = options.note?.trim() ? [`- Operator note: ${options.note.trim()}`] : [];

  return [
    "## Outcome",
    `- ${options.option.focus}`,
    `- Land the next ${options.primaryModuleId} stream slice for ${options.issue.identifier}.`,
    "",
    "## Scope",
    `- ${options.option.alignment}`,
    `- Keep the work centered on the ${options.primaryModuleId} module surface.`,
    "",
    "## Acceptance Criteria",
    `- ${options.option.focus}`,
    `- ${options.option.alignment}`,
    "- Keep the parent managed brief and child backlog aligned.",
    "",
    "## Module Scope",
    `- Primary module: ${options.primaryModuleId}`,
    "",
    "## Dependencies And Docs",
    `- Parent issue: ${options.issue.identifier}`,
    ...docLines,
    ...noteLines,
    "",
    "## Out Of Scope",
    "- Unrelated module work or repo-wide refactors beyond this slice.",
  ].join("\n");
}

export function buildManagedBacklogChildMutations(options: {
  docs: string[];
  issue: AgentIssue;
  note?: string;
  optionList: ManagedBacklogOption[];
  primaryModuleId: string;
}) {
  return options.optionList.map(
    (option, index): ManagedCommentChildMutation => ({
      blockedBy: index === 0 ? [] : [`managed-backlog-${index}`],
      description: renderManagedBacklogChildDescription({
        docs: options.docs,
        issue: options.issue,
        note: options.note,
        option,
        primaryModuleId: options.primaryModuleId,
      }),
      docs: options.docs,
      labels: [options.primaryModuleId],
      priority: options.issue.priority,
      reference: `managed-backlog-${index + 1}`,
      state: "Todo",
      title: option.title,
    }),
  );
}

export function buildManagedBacklogChildren(options: {
  docs: string[];
  issue: AgentIssue;
  note?: string;
  parentDescription: string;
  primaryModuleId: string;
}) {
  const childDocs = uniqueOrdered([MANAGED_STREAM_FOCUS_DOC_PATH, ...options.docs]);
  return buildManagedBacklogChildMutations({
    docs: childDocs,
    issue: options.issue,
    note: options.note,
    optionList: parseManagedBacklogOptions(options.parentDescription),
    primaryModuleId: options.primaryModuleId,
  });
}

export function buildManagedFocusDoc(options: {
  issue: AgentIssue;
  module: WorkflowModule;
  repoRoot: string;
  requestedDocs: string[];
  resolvedContext: ResolvedContextBundle;
  proposalDescription: string;
}) {
  const objective = findSectionBullets({
    content: options.issue.description,
    fallback: [
      `Ship the next managed ${options.module.id} stream slice for ${options.issue.identifier}.`,
      "Keep the parent brief, child backlog, and repo focus in sync.",
    ],
    headings: ["Outcome", "Objective"],
    maxItems: 2,
  });
  const currentFocus = uniqueOrdered(
    parseManagedBacklogOptions(options.proposalDescription)
      .map((entry) => entry.focus)
      .slice(0, 3),
  );
  const constraints = findSectionBullets({
    content: options.proposalDescription,
    fallback: [
      "Keep changes narrow and reviewable.",
      "Preserve human-authored content outside managed surfaces.",
      "Treat equivalent reruns as no-ops.",
    ],
    headings: ["Constraints"],
    maxItems: 3,
  });
  const proofSurfaces = uniqueOrdered([
    toRepoRelativePath(options.repoRoot, options.module.path),
    ...options.module.docs,
    ...options.requestedDocs,
    ...options.resolvedContext.docs.map((doc) =>
      doc.path ? toRepoRelativePath(options.repoRoot, doc.path) : undefined,
    ),
  ]).slice(0, 6);
  const deferred = findSectionBullets({
    content: options.issue.description,
    fallback: [
      "Non-essential work outside the current managed stream slice.",
      "Operator UI changes that are not required for the write surfaces.",
    ],
    headings: ["Out Of Scope", "Deferred"],
    maxItems: 3,
  });

  return [
    `# ${options.issue.identifier}: ${options.issue.title}`,
    "",
    "## Objective",
    ...objective.map((line) => `- ${line}`),
    "",
    "## Current Focus",
    ...(currentFocus.length ? currentFocus : ["Keep the next managed slice explicit and reviewable."])
      .map((line) => `- ${line}`),
    "",
    "## Constraints",
    ...constraints.map((line) => `- ${line}`),
    "",
    "## Proof Surfaces",
    ...(proofSurfaces.length ? proofSurfaces : [toRepoRelativePath(options.repoRoot, options.module.path)])
      .map((line) => `- ${line}`),
    "",
    "## Deferred",
    ...deferred.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

export function renderManagedFocusDoc(options: {
  docs: string[];
  issue: AgentIssue;
  module: WorkflowModule;
  parentDescription: string;
  repoRoot: string;
  resolvedContext: ResolvedContextBundle;
}) {
  return buildManagedFocusDoc({
    issue: options.issue,
    module: options.module,
    proposalDescription: options.parentDescription,
    repoRoot: options.repoRoot,
    requestedDocs: options.docs,
    resolvedContext: options.resolvedContext,
  });
}
