import { relative } from "node:path";

import { resolveIssueModule } from "./issue-routing.js";
import type { AgentIssue, ResolvedContextBundle, Workflow, WorkflowModule } from "./types.js";

const SUMMARY_HEADING_PATTERNS = [/^summary$/i, /^objective$/i] as const;
const FOCUS_HEADING_PATTERNS = [/^focus$/i, /^current focus$/i] as const;
const GOALS_HEADING_PATTERNS = [/^goals$/i, /^objective$/i] as const;
const GUARDRAIL_HEADING_PATTERNS = [/^guardrails$/i, /^constraints$/i] as const;
const REFERENCE_HEADING_PATTERNS = [/^references$/i, /^proof surfaces?$/i] as const;
const ROADMAP_HEADING_PATTERNS = [/^roadmap$/i, /^work options$/i] as const;
const DEFERRED_HEADING_PATTERNS = [/^deferred$/i] as const;
const LEGACY_GOALS_PATH_PATTERN = /(?:^|\/)io\/goals\.md$/i;
const PRESERVED_SECTION_PATTERNS = [
  /decision/i,
  /approval/i,
  /question/i,
  /risk/i,
  /note/i,
  /success criteria/i,
  /context/i,
] as const;

interface MarkdownSection {
  heading?: string;
  lines: string[];
}

interface ProposalOption {
  alignment: string;
  focus: string;
  title: string;
}

export function shouldWriteManagedBacklogProposal(
  issue: AgentIssue,
  workflow: Pick<Workflow, "modules">,
) {
  return (
    !issue.hasParent &&
    issue.labels.some((label) => label.trim().toLowerCase() === "io") &&
    Boolean(resolveIssueModule(workflow.modules, issue))
  );
}

export function rewriteManagedBacklogDescription(options: {
  bundle: ResolvedContextBundle;
  issue: AgentIssue;
  repoRoot: string;
  workflow: Pick<Workflow, "modules">;
}) {
  const { bundle, issue, repoRoot, workflow } = options;
  const module = resolveIssueModule(workflow.modules, issue);
  if (!module) {
    return issue.description;
  }
  return renderManagedParentDescription({
    bundle,
    description: issue.description,
    issue,
    module,
    repoRoot,
  });
}

export function buildManagedParentProposal(options: {
  issue: AgentIssue;
  module: WorkflowModule;
  repoRoot: string;
  resolvedContext: ResolvedContextBundle;
}) {
  const description = renderManagedParentDescription({
    bundle: options.resolvedContext,
    description: options.issue.description,
    issue: options.issue,
    module: options.module,
    repoRoot: options.repoRoot,
  });

  return {
    changed: description !== options.issue.description,
    description,
  };
}

function renderManagedParentDescription(options: {
  bundle: ResolvedContextBundle;
  description: string;
  issue: AgentIssue;
  module: WorkflowModule;
  repoRoot: string;
}) {
  const { bundle, description, issue, module, repoRoot } = options;
  const normalizedDescription = normalizeDescriptionText(description);
  const repoDocs = bundle.docs.filter((doc) => doc.source !== "builtin");
  const prioritizedDocs = prioritizeModuleDocs(repoDocs, module);
  const analysisDocs = [...prioritizedDocs, createIssueDocForAnalysis(normalizedDescription)];
  const modulePath = toRepoRelativePath(repoRoot, module.path);

  const summary = findSectionBullets({
    docs: analysisDocs,
    fallback: [
      `This stream owns the next ${module.id} delivery slice for ${issue.identifier}.`,
      `It keeps the ${module.id} surface aligned with the current backlog and execution workflow.`,
    ],
    headingPatterns: SUMMARY_HEADING_PATTERNS,
    maxItems: 2,
  });
  const goals = findSectionBullets({
    docs: analysisDocs,
    fallback: [
      `Define the next ${module.id} outcome clearly enough for follow-on feature and task work.`,
      "Keep backlog updates reviewable and grounded in the assembled context bundle.",
      "Preserve useful human notes when refreshing the stream brief.",
    ],
    headingPatterns: GOALS_HEADING_PATTERNS,
    maxItems: 3,
  });
  const roadmapItems = resolveRoadmapItems({
    description: normalizedDescription,
    goals,
    module,
    repoRoot,
  });
  const deferred = findSectionBullets({
    docs: analysisDocs,
    fallback: [],
    headingPatterns: DEFERRED_HEADING_PATTERNS,
    maxItems: 2,
  });
  const focus = uniqueOrdered([
    ...findSectionBullets({
      docs: analysisDocs,
      fallback: [],
      headingPatterns: FOCUS_HEADING_PATTERNS,
      maxItems: 4,
    }),
    ...roadmapItems.map((option) => option.focus),
    ...deferred.map((line) => `Not in focus yet: ${line}`),
    `Keep the next ${module.id} slice explicit and reviewable.`,
  ]).slice(0, 4);
  const guardrails = findSectionBullets({
    docs: analysisDocs,
    fallback: [
      "Preserve useful human-authored notes and decisions when refreshing the stream brief.",
      "Keep the brief concise, concrete, and easy to refresh on later backlog runs.",
      "Prefer one primary module surface unless a cross-module exception is explicit.",
    ],
    headingPatterns: GUARDRAIL_HEADING_PATTERNS,
    maxItems: 4,
  });
  const references = uniqueOrdered([
    ...findSectionBullets({
      docs: analysisDocs,
      fallback: [],
      headingPatterns: REFERENCE_HEADING_PATTERNS,
      maxItems: 6,
    }),
    ...extractRepoPaths(normalizedDescription),
    modulePath,
    ...module.docs,
    ...bundle.docs.map((doc) => (doc.path ? toRepoRelativePath(repoRoot, doc.path) : undefined)),
  ])
    .filter((line) => !isLegacyGoalsPath(line))
    .slice(0, 6);
  const preservedSections = selectPreservedSections(normalizedDescription);

  return [
    "## Summary",
    ...summary.map((line) => `- ${line}`),
    "",
    "## Focus",
    ...focus.map((line) => `- ${line}`),
    "",
    "## Goals",
    ...goals.map((line) => `- ${line}`),
    "",
    "## Roadmap",
    ...roadmapItems.flatMap((option, index) => [
      `${index + 1}. **${option.title}**`,
      `   Scope: ${option.focus}`,
      `   Outcome: ${option.alignment}`,
    ]),
    "",
    "## Guardrails",
    ...guardrails.map((line) => `- ${line}`),
    ...preservedSections.flatMap((section) => [
      "",
      `## ${section.heading}`,
      "",
      ...trimTrailingBlankLines(section.lines),
    ]),
    "",
    "## References",
    ...(references.length ? references : [modulePath]).map((line) => `- ${line}`),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function resolveRoadmapItems(options: {
  description: string;
  goals: string[];
  module: WorkflowModule;
  repoRoot: string;
}) {
  const parsed = parseRoadmapItems(options.description);
  if (parsed.length) {
    return parsed;
  }
  return buildRoadmapItems({
    goals: options.goals,
    module: options.module,
    repoRoot: options.repoRoot,
    themes: extractIssueThemes(options.description),
  });
}

function parseRoadmapItems(description: string) {
  const options: ProposalOption[] = [];
  for (const section of splitMarkdownSections(description).filter((entry) =>
    matchesAnyPattern(entry.heading, ROADMAP_HEADING_PATTERNS)
  )) {
    for (let index = 0; index < section.lines.length; index++) {
      const title = section.lines[index]?.match(/^\d+\.\s+\*\*(.+?)\*\*$/)?.[1]?.trim();
      if (!title) {
        continue;
      }
      let focus: string | undefined;
      let alignment: string | undefined;
      for (let cursor = index + 1; cursor < section.lines.length; cursor++) {
        const line = section.lines[cursor] ?? "";
        if (/^\d+\.\s+\*\*/.test(line)) {
          break;
        }
        focus ??= line.match(/^\s*(?:Scope|Focus):\s*(.+)$/)?.[1]?.trim();
        alignment ??= line.match(/^\s*(?:Outcome|Alignment):\s*(.+)$/)?.[1]?.trim();
      }
      if (!title || !focus || !alignment) {
        continue;
      }
      options.push({ alignment, focus, title });
    }
  }
  return options;
}

function buildRoadmapItems(options: {
  goals: string[];
  module: WorkflowModule;
  repoRoot: string;
  themes: string[];
}) {
  const { goals, module, repoRoot, themes } = options;
  const modulePath = toRepoRelativePath(repoRoot, module.path);
  const fallbackThemes = [
    `Clarify the next ${module.id} roadmap item in \`${modulePath}\`.`,
    `Generate clearer execution guidance directly from the assembled \`${module.id}\` context bundle.`,
    `Prove rerun safety and keep the next slice reviewable in \`${modulePath}\`.`,
  ];
  const fallbackGoals = [
    "Keep the planning loop explicit, legible, and easy to refresh.",
    "Improve execution readiness without forcing humans to reopen every linked doc.",
    "Preserve operator trust by keeping planning changes deterministic and scoped.",
  ];

  return Array.from({ length: 3 }, (_, index): ProposalOption => {
    const focus = themes[index] ?? fallbackThemes[index] ?? fallbackThemes[0]!;
    const alignment = goals[index] ?? fallbackGoals[index] ?? fallbackGoals[0]!;
    return {
      alignment,
      focus,
      title: createOptionTitle(focus, index),
    };
  });
}

function createOptionTitle(focus: string, index: number) {
  const cleaned = normalizeHighlight(focus)
    .replace(/^focus on\s+/i, "")
    .replace(/\.$/, "");
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length) {
    const title = words.join(" ");
    return title.charAt(0).toUpperCase() + title.slice(1);
  }
  return `Option ${index + 1}`;
}

function extractIssueThemes(description: string) {
  const sections = splitMarkdownSections(description);
  const prioritizedSections = [
    { limit: 3, patterns: FOCUS_HEADING_PATTERNS },
    { limit: 2, patterns: GUARDRAIL_HEADING_PATTERNS },
    { limit: 1, patterns: GOALS_HEADING_PATTERNS },
    { limit: 1, patterns: REFERENCE_HEADING_PATTERNS },
  ] as const;
  const prioritizedThemes: string[] = [];

  for (const { limit, patterns } of prioritizedSections) {
    for (const section of sections.filter((entry) => matchesAnyPattern(entry.heading, patterns))) {
      prioritizedThemes.push(...extractSectionHighlights(section, limit));
      if (uniqueOrdered(prioritizedThemes).length >= 3) {
        return uniqueOrdered(prioritizedThemes).slice(0, 3);
      }
    }
  }

  return uniqueOrdered(
    sections.flatMap((section) => extractSectionHighlights(section, 1)),
  ).slice(0, 3);
}

function findSectionBullets(options: {
  docs: Array<{ content: string; path?: string }>;
  fallback: string[];
  headingPatterns: readonly RegExp[];
  maxItems: number;
}) {
  const highlights = uniqueOrdered(
    options.docs.flatMap((doc) =>
      splitMarkdownSections(doc.content)
        .filter((section) => matchesAnyPattern(section.heading, options.headingPatterns))
        .flatMap((section) => extractSectionHighlights(section, 2))
    ),
  );
  return uniqueOrdered([...highlights, ...options.fallback]).slice(0, options.maxItems);
}

function selectPreservedSections(description: string) {
  return splitMarkdownSections(description)
    .filter((section) => matchesAnyPattern(section.heading, PRESERVED_SECTION_PATTERNS))
    .filter((section) => !matchesAnyPattern(section.heading, STANDARD_SECTION_PATTERNS))
    .filter((section) => trimTrailingBlankLines(section.lines).some((line) => line.trim().length > 0));
}

const STANDARD_SECTION_PATTERNS = [
  ...SUMMARY_HEADING_PATTERNS,
  ...FOCUS_HEADING_PATTERNS,
  ...GOALS_HEADING_PATTERNS,
  ...GUARDRAIL_HEADING_PATTERNS,
  ...REFERENCE_HEADING_PATTERNS,
  ...ROADMAP_HEADING_PATTERNS,
  ...DEFERRED_HEADING_PATTERNS,
] as const;

function prioritizeModuleDocs(
  docs: Array<{ content: string; path?: string; source?: string }>,
  module: WorkflowModule,
) {
  return [...docs].sort((left, right) => {
    const leftScore = isModuleDoc(left.path, module) ? 0 : 1;
    const rightScore = isModuleDoc(right.path, module) ? 0 : 1;
    return leftScore - rightScore;
  });
}

function isModuleDoc(path: string | undefined, module: WorkflowModule) {
  return Boolean(path && (path === module.path || path.startsWith(`${module.path}/`)));
}

function createIssueDocForAnalysis(content: string) {
  return { content };
}

function extractSectionHighlights(section: MarkdownSection, limit: number) {
  const bullets = trimTrailingBlankLines(section.lines)
    .filter((line) => isListItem(line))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""))
    .map(normalizeHighlight)
    .filter(Boolean);
  if (bullets.length) {
    return bullets.slice(0, limit);
  }
  const paragraph = normalizeHighlight(section.lines.join(" "));
  return paragraph ? [paragraph] : [];
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
        heading: headingMatch[2]?.trim() ?? "",
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

function trimTrailingBlankLines(lines: string[]) {
  const trimmed = [...lines];
  while (trimmed.length && !trimmed[trimmed.length - 1]!.trim()) {
    trimmed.pop();
  }
  return trimmed;
}

function extractRepoPaths(content: string) {
  const matches = content.match(/(?:\.\/|\.\.\/)[A-Za-z0-9_./-]+/g) ?? [];
  return uniqueOrdered(matches).filter((path) => !isLegacyGoalsPath(path));
}

function normalizeDescriptionText(description: string) {
  return description
    .split("\n")
    .filter((line) => !isLegacyGoalsPathLine(line))
    .join("\n")
    .trim();
}

function isLegacyGoalsPath(value: string) {
  return LEGACY_GOALS_PATH_PATTERN.test(value.trim().replace(/`/g, ""));
}

function isLegacyGoalsPathLine(line: string) {
  const normalized = line
    .trim()
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/^`(.+)`$/, "$1");
  return isLegacyGoalsPath(normalized);
}

function normalizeHighlight(value: string) {
  return truncateText(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/`{3}[\s\S]*?`{3}/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function truncateText(value: string, maxLength = 180) {
  if (!value || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function uniqueOrdered(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    const normalized = trimmed?.toLowerCase();
    if (!trimmed || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function matchesAnyPattern(value: string | undefined, patterns: readonly RegExp[]) {
  if (!value) {
    return false;
  }
  return patterns.some((pattern) => pattern.test(value));
}

function isListItem(line: string) {
  return /^\s*(?:[-*+]|\d+\.)\s+/.test(line);
}

function toRepoRelativePath(repoRoot: string, path: string) {
  const relativePath = relative(repoRoot, path);
  return relativePath && !relativePath.startsWith("..") ? `./${relativePath}` : path;
}
