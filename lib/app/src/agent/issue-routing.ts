import type {
  AgentIssue,
  IssueRoutingConfig,
  IssueRoutingRule,
  IssueRoutingSelection,
  WorkflowModule,
} from "./types.js";

function normalizeRoutingValue(value: string) {
  return value.trim().toLowerCase();
}

export function resolveIssueModule(
  modules: Record<string, WorkflowModule>,
  issue: Pick<AgentIssue, "labels">,
) {
  const issueLabels = new Set(issue.labels.map(normalizeRoutingValue));
  const matchedModules = Object.values(modules).filter((module) => issueLabels.has(module.id));
  if (matchedModules.length !== 1) {
    return undefined;
  }
  return matchedModules[0];
}

export function matchesIssueRoutingRule(issue: AgentIssue, rule: IssueRoutingRule) {
  const issueLabels = new Set(issue.labels.map(normalizeRoutingValue));
  const issueProjectSlug = issue.projectSlug ? normalizeRoutingValue(issue.projectSlug) : undefined;
  const issueState = normalizeRoutingValue(issue.state);

  if (rule.if.labelsAny?.length && !rule.if.labelsAny.some((label) => issueLabels.has(label))) {
    return false;
  }
  if (rule.if.labelsAll?.length && !rule.if.labelsAll.every((label) => issueLabels.has(label))) {
    return false;
  }
  if (rule.if.stateIn?.length && !rule.if.stateIn.includes(issueState)) {
    return false;
  }
  if (rule.if.projectSlugIn?.length) {
    if (!issueProjectSlug || !rule.if.projectSlugIn.includes(issueProjectSlug)) {
      return false;
    }
  }
  if (typeof rule.if.hasParent === "boolean" && issue.hasParent !== rule.if.hasParent) {
    return false;
  }
  if (typeof rule.if.hasChildren === "boolean" && issue.hasChildren !== rule.if.hasChildren) {
    return false;
  }
  return true;
}

export function resolveIssueRouting(
  config: IssueRoutingConfig,
  issue: AgentIssue,
  _modules: Record<string, WorkflowModule> = {},
): IssueRoutingSelection {
  for (const rule of config.routing) {
    if (matchesIssueRoutingRule(issue, rule)) {
      return {
        agent: rule.agent,
        profile: rule.profile,
      };
    }
  }
  return {
    agent: config.defaultAgent,
    profile: config.defaultProfile,
  };
}
