import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import z from "zod";

import {
  DEFAULT_BACKLOG_BUILTIN_DOC_IDS,
  DEFAULT_EXECUTE_BUILTIN_DOC_IDS,
  resolveBuiltinDoc,
} from "./builtins.js";
import type {
  AgentIssue,
  AgentRole,
  IssueRoutingSelection,
  ResolvedContextBundle,
  ResolvedContextDoc,
  Workflow,
} from "./types.js";

const WORKFLOW_FILE = "WORKFLOW.md";
const CONTEXT_ENTRYPOINT_DOC_ID = "context.entrypoint";
const ISSUE_CONTEXT_DOC_ID = "issue.context";
const ISSUE_HINT_BLOCK_PATTERN = /<!--\s*io\b([\s\S]*?)-->/gi;
const BUILTIN_DOC_REF_PATTERN = /(?<![A-Za-z0-9._/-])(builtin:[A-Za-z0-9._-]+)\b/g;
const REGISTERED_DOC_REF_PATTERN =
  /(?<![A-Za-z0-9_/:.-])([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+)\b/g;
const REPO_PATH_DOC_REF_PATTERN =
  /(?<![A-Za-z0-9_./-])(\.\/[A-Za-z0-9_./-]+\.md(?:#[A-Za-z0-9._/-]+)?)\b/g;

const issueBodyHintsSchema = z
  .object({
    agent: z.enum(["backlog", "execute"]).optional(),
    docs: z.union([z.array(z.string().min(1)), z.string().min(1).transform((value) => [value])]).default([]),
    profile: z.string().min(1).optional(),
  })
  .strict();

type IssueBodyHints = {
  agent?: AgentRole;
  docs: string[];
  profile?: string;
};

type PendingResolvedContextDoc = Omit<ResolvedContextDoc, "order">;

export interface ResolvedIssueContext {
  bundle: ResolvedContextBundle;
  issue: AgentIssue;
  selection: IssueRoutingSelection;
  warnings: string[];
}

function uniqueOrdered(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function collectIndexedMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)]
    .map((match) => ({
      index: match.index ?? -1,
      value: match[1],
    }))
    .filter((match): match is { index: number; value: string } => Boolean(match.value));
}

function stripPathFragment(path: string) {
  return path.split("#", 1)[0]!;
}

function isBuiltinDocReference(reference: string) {
  return reference.startsWith("builtin:");
}

function isRepoPathDocReference(reference: string) {
  return reference.startsWith("./");
}

function usesLegacyWorkflowPrompt(workflow: Workflow) {
  return workflow.entrypoint.promptPath.endsWith(WORKFLOW_FILE);
}

function getDefaultProfileInclude(agent: AgentRole) {
  return agent === "backlog"
    ? [...DEFAULT_BACKLOG_BUILTIN_DOC_IDS]
    : [...DEFAULT_EXECUTE_BUILTIN_DOC_IDS];
}

function resolveIssueSelection(
  baseSelection: IssueRoutingSelection,
  hints: IssueBodyHints,
): IssueRoutingSelection {
  const agent = hints.agent ?? baseSelection.agent;
  return {
    agent,
    profile: hints.profile?.trim() || (hints.agent && !hints.profile ? agent : baseSelection.profile),
  };
}

function parseIssueBodyHints(description: string) {
  const warnings: string[] = [];
  const matches = [...description.matchAll(ISSUE_HINT_BLOCK_PATTERN)];
  if (matches.length > 1) {
    warnings.push('Multiple `<!-- io ... -->` blocks found; using the first block.');
  }

  const descriptionWithoutHints = description.replaceAll(ISSUE_HINT_BLOCK_PATTERN, "").trim();
  const firstBlockBody = matches[0]?.[1]?.trim();
  if (!firstBlockBody) {
    return {
      descriptionWithoutHints,
      hints: { docs: [] } satisfies IssueBodyHints,
      warnings,
    };
  }

  try {
    const parsed = parseYaml(firstBlockBody) ?? {};
    const result = issueBodyHintsSchema.safeParse(parsed);
    if (!result.success) {
      warnings.push("Invalid issue metadata block; ignoring issue-level hints.");
      return {
        descriptionWithoutHints,
        hints: { docs: [] } satisfies IssueBodyHints,
        warnings,
      };
    }
    return {
      descriptionWithoutHints,
      hints: {
        agent: result.data.agent,
        docs: uniqueOrdered(result.data.docs),
        profile: result.data.profile?.trim(),
      } satisfies IssueBodyHints,
      warnings,
    };
  } catch {
    warnings.push("Invalid issue metadata block; ignoring issue-level hints.");
    return {
      descriptionWithoutHints,
      hints: { docs: [] } satisfies IssueBodyHints,
      warnings,
    };
  }
}

function extractLinkedDocReferences(description: string) {
  return uniqueOrdered(
    [
      ...collectIndexedMatches(description, BUILTIN_DOC_REF_PATTERN),
      ...collectIndexedMatches(description, REPO_PATH_DOC_REF_PATTERN),
      ...collectIndexedMatches(description, REGISTERED_DOC_REF_PATTERN),
    ]
      .sort((left, right) => left.index - right.index)
      .map((match) => match.value),
  );
}

async function readTrimmedFile(path: string) {
  const content = (await readFile(path, "utf8")).trim();
  if (!content) {
    throw new Error(`workflow_doc_empty:${path}`);
  }
  return content;
}

async function resolveDocReference(
  workflow: Workflow,
  repoRoot: string,
  reference: string,
): Promise<PendingResolvedContextDoc | undefined> {
  const overridePath = isRepoPathDocReference(reference) ? undefined : workflow.context.overrides[reference];
  if (overridePath) {
    return {
      content: await readTrimmedFile(overridePath),
      id: reference,
      label: reference,
      overridden: true,
      path: overridePath,
      source: isBuiltinDocReference(reference) ? "builtin" : "registered",
    };
  }

  if (isBuiltinDocReference(reference)) {
    const builtinDoc = resolveBuiltinDoc(reference);
    if (!builtinDoc) {
      return undefined;
    }
    return {
      content: builtinDoc.content.trim(),
      id: reference,
      label: reference,
      overridden: false,
      source: "builtin",
    };
  }

  if (isRepoPathDocReference(reference)) {
    const absolutePath = resolve(repoRoot, stripPathFragment(reference));
    return {
      content: await readTrimmedFile(absolutePath),
      id: reference,
      label: reference,
      overridden: false,
      path: absolutePath,
      source: "repo-path",
    };
  }

  const registeredPath = workflow.context.docs[reference];
  if (!registeredPath) {
    return undefined;
  }
  return {
    content: await readTrimmedFile(registeredPath),
    id: reference,
    label: reference,
    overridden: false,
    path: registeredPath,
    source: "registered",
  };
}

function appendDoc(
  docs: PendingResolvedContextDoc[],
  seenDocIds: Set<string>,
  seenPaths: Set<string>,
  doc: PendingResolvedContextDoc | undefined,
) {
  if (!doc) {
    return;
  }
  if (seenDocIds.has(doc.id)) {
    return;
  }
  if (doc.path && seenPaths.has(doc.path)) {
    return;
  }
  seenDocIds.add(doc.id);
  if (doc.path) {
    seenPaths.add(doc.path);
  }
  docs.push(doc);
}

function finalizeBundle(docs: PendingResolvedContextDoc[]): ResolvedContextBundle {
  return {
    docs: docs.map((doc, index) => ({
      ...doc,
      order: index + 1,
    })),
  };
}

function createEntrypointDoc(workflow: Workflow): PendingResolvedContextDoc {
  return {
    content: workflow.entrypointContent.trim(),
    id: CONTEXT_ENTRYPOINT_DOC_ID,
    label: workflow.entrypoint.promptPath,
    overridden: false,
    path: workflow.entrypoint.promptPath,
    source: "entrypoint",
  };
}

function createIssueContextDoc(description: string): PendingResolvedContextDoc | undefined {
  if (!description.trim()) {
    return undefined;
  }
  return {
    content: "Issue Description:\n\n{{ issue.description }}",
    id: ISSUE_CONTEXT_DOC_ID,
    label: ISSUE_CONTEXT_DOC_ID,
    overridden: false,
    source: "synthesized",
  };
}

function resolveProfileInclude(workflow: Workflow, selection: IssueRoutingSelection) {
  const profile = workflow.context.profiles[selection.profile];
  if (profile) {
    return {
      include: [...profile.include],
      includeEntrypoint: profile.includeEntrypoint,
      warnings: [],
    };
  }
  return {
    include: getDefaultProfileInclude(selection.agent),
    includeEntrypoint: true,
    warnings:
      selection.profile === selection.agent
        ? []
        : [`Unknown context profile "${selection.profile}"; using "${selection.agent}" defaults.`],
  };
}

export function renderContextBundle(bundle: ResolvedContextBundle) {
  return bundle.docs.map((doc) => `<!-- ${doc.label} -->\n${doc.content}`).join("\n\n");
}

export function summarizeContextBundle(bundle: ResolvedContextBundle) {
  const lines = ["context bundle:"];
  for (const doc of bundle.docs) {
    const location = doc.path ? ` ${doc.path}` : "";
    const override = doc.overridden ? " override" : "";
    lines.push(`${doc.order}. ${doc.id} [${doc.source}${override}]${location}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function resolveIssueContext(options: {
  baseSelection: IssueRoutingSelection;
  issue: AgentIssue;
  repoRoot: string;
  workflow: Workflow;
}): Promise<ResolvedIssueContext> {
  const { baseSelection, issue, repoRoot, workflow } = options;
  const { descriptionWithoutHints, hints, warnings } = parseIssueBodyHints(issue.description);
  const selection = resolveIssueSelection(baseSelection, hints);
  const linkedDocReferences = extractLinkedDocReferences(descriptionWithoutHints);
  const issueDocReferences = uniqueOrdered([...hints.docs, ...linkedDocReferences]);
  const docs: PendingResolvedContextDoc[] = [];
  const seenDocIds = new Set<string>();
  const seenPaths = new Set<string>();
  const issueForPrompt = {
    ...issue,
    description: descriptionWithoutHints,
  };

  if (workflow.entrypoint.kind === "io") {
    const profileResolution = resolveProfileInclude(workflow, selection);
    warnings.push(...profileResolution.warnings);
    const postEntrypointDocs: PendingResolvedContextDoc[] = [];

    for (const reference of profileResolution.include) {
      const doc = await resolveDocReference(workflow, repoRoot, reference);
      if (!doc) {
        throw new Error(`workflow_doc_missing:${reference}`);
      }
      if (usesLegacyWorkflowPrompt(workflow) && doc.source === "builtin") {
        continue;
      }
      if (doc.source === "builtin") {
        appendDoc(docs, seenDocIds, seenPaths, doc);
        continue;
      }
      postEntrypointDocs.push(doc);
    }

    if (profileResolution.includeEntrypoint) {
      appendDoc(docs, seenDocIds, seenPaths, createEntrypointDoc(workflow));
    }
    for (const doc of postEntrypointDocs) {
      appendDoc(docs, seenDocIds, seenPaths, doc);
    }
  } else {
    appendDoc(docs, seenDocIds, seenPaths, createEntrypointDoc(workflow));
  }

  for (const reference of issueDocReferences) {
    try {
      const doc = await resolveDocReference(workflow, repoRoot, reference);
      if (!doc) {
        warnings.push(`Unresolved issue doc reference: ${reference}`);
        continue;
      }
      appendDoc(docs, seenDocIds, seenPaths, doc);
    } catch {
      warnings.push(`Unresolved issue doc reference: ${reference}`);
    }
  }

  if (workflow.entrypoint.kind === "io" && !usesLegacyWorkflowPrompt(workflow)) {
    appendDoc(docs, seenDocIds, seenPaths, createIssueContextDoc(descriptionWithoutHints));
  }

  return {
    bundle: finalizeBundle(docs),
    issue: issueForPrompt,
    selection,
    warnings,
  };
}
