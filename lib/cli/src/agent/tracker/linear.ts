import { createLogger, type Logger } from "../../lib/index.js";
import { LinearClient } from "@linear/sdk";

import type { AgentIssue, TrackerConfig } from "../types.js";

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  sortOrder
  subIssueSortOrder
  createdAt
  updatedAt
  project { slugId }
  team { id }
  state { name }
  parent {
    id
    identifier
    title
    state { name }
    parent {
      id
      identifier
      title
      state { name }
    }
  }
  children(first: 1) {
    nodes {
      id
    }
  }
  labels { nodes { name } }
  inverseRelations(first: 50) {
    nodes {
      type
      relatedIssue {
        id
        state { name }
      }
    }
  }
`;

const CANDIDATE_QUERY = `
query AgentCandidateIssues(
  $after: String
  $first: Int!
  $projectSlug: String!
  $states: [String!]
) {
  issues(
    after: $after
    first: $first
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $states } }
    }
  ) {
    nodes {
${ISSUE_FIELDS}
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

const STATE_QUERY = `
query AgentIssueStates($ids: [ID!]!) {
  issues(filter: { id: { in: $ids } }) {
    nodes {
      id
      state { name }
    }
  }
}
`;

const ISSUE_BY_IDS_QUERY = `
query AgentIssuesByIds($ids: [ID!]!) {
  issues(filter: { id: { in: $ids } }) {
    nodes {
${ISSUE_FIELDS}
    }
  }
}
`;

interface LinearResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface IssueRelationNode {
  relatedIssue?: { id: string; state?: { name?: string | null } | null } | null;
  type?: string | null;
}

interface CandidateIssueNode {
  children?: {
    nodes?: Array<{ id: string } | null> | null;
  } | null;
  createdAt: string;
  description?: string | null;
  id: string;
  identifier: string;
  inverseRelations?: {
    nodes?: Array<IssueRelationNode | null> | null;
  } | null;
  labels?: { nodes?: Array<{ name?: string | null } | null> | null } | null;
  parent?: {
    id: string;
    identifier?: string | null;
    parent?: {
      id: string;
      identifier?: string | null;
      state?: { name?: string | null } | null;
      title?: string | null;
    } | null;
    state?: { name?: string | null } | null;
    title?: string | null;
  } | null;
  priority?: number | null;
  project?: { slugId?: string | null } | null;
  sortOrder?: number | null;
  subIssueSortOrder?: number | null;
  state?: { name?: string | null } | null;
  team?: { id?: string | null } | null;
  title: string;
  updatedAt: string;
}

interface IssuePage {
  issues?: {
    nodes?: Array<CandidateIssueNode | null> | null;
    pageInfo?: {
      endCursor?: string | null;
      hasNextPage?: boolean | null;
    } | null;
  } | null;
}

function normalizeStateName(state: string) {
  return state.trim().toLowerCase();
}

function uniqueStateNames(states: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const state of states) {
    const trimmed = state.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = normalizeStateName(trimmed);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(trimmed);
  }
  return unique;
}

function isDoneState(state?: string | null) {
  return state?.trim().toLowerCase() === "done";
}

export function normalizeLinearIssue(node: CandidateIssueNode): AgentIssue {
  const parentIssueId = node.parent?.id?.trim();
  const streamIssueId = node.parent?.parent?.id?.trim() || parentIssueId;
  return {
    blockedBy: (node.inverseRelations?.nodes ?? [])
      .filter((relation): relation is IssueRelationNode => Boolean(relation))
      .filter((relation) => relation.type?.trim().toLowerCase() === "blocks")
      .map((relation) => relation.relatedIssue)
      .filter(
        (
          relatedIssue,
        ): relatedIssue is {
          id: string;
          state?: { name?: string | null } | null;
        } => Boolean(relatedIssue),
      )
      .filter((relatedIssue) => relatedIssue.id !== node.id)
      .filter((relatedIssue) => !isDoneState(relatedIssue.state?.name))
      .map((relatedIssue) => relatedIssue.id),
    createdAt: node.createdAt,
    description: node.description ?? "",
    hasChildren: (node.children?.nodes ?? []).some((child) => Boolean(child?.id)),
    hasParent: Boolean(parentIssueId),
    id: node.id,
    identifier: node.identifier,
    grandparentIssueId: node.parent?.parent?.id?.trim() || undefined,
    grandparentIssueIdentifier: node.parent?.parent?.identifier?.trim() || undefined,
    grandparentIssueState: node.parent?.parent?.state?.name?.trim() || undefined,
    grandparentIssueTitle: node.parent?.parent?.title?.trim() || undefined,
    labels: (node.labels?.nodes ?? [])
      .map((label) => label?.name?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
    parentIssueId: parentIssueId || undefined,
    parentIssueIdentifier: parentIssueId ? node.parent?.identifier?.trim() || undefined : undefined,
    parentIssueState: parentIssueId ? node.parent?.state?.name?.trim() || undefined : undefined,
    parentIssueTitle: parentIssueId ? node.parent?.title?.trim() || undefined : undefined,
    priority:
      typeof node.priority === "number" && Number.isInteger(node.priority) ? node.priority : null,
    projectSlug: node.project?.slugId?.trim() || undefined,
    sortOrder: typeof node.sortOrder === "number" ? node.sortOrder : null,
    subIssueSortOrder: typeof node.subIssueSortOrder === "number" ? node.subIssueSortOrder : null,
    state: node.state?.name?.trim() || "Unknown",
    streamIssueId: streamIssueId || undefined,
    streamIssueIdentifier: streamIssueId
      ? node.parent?.parent?.identifier?.trim() || node.parent?.identifier?.trim() || undefined
      : undefined,
    streamIssueState: streamIssueId
      ? node.parent?.parent?.state?.name?.trim() || node.parent?.state?.name?.trim() || undefined
      : undefined,
    teamId: node.team?.id?.trim() || undefined,
    title: node.title.trim(),
    updatedAt: node.updatedAt,
  };
}

export class LinearTrackerAdapter {
  #client?: LinearClient;
  readonly #config: TrackerConfig;
  readonly #log: Logger;
  readonly #stateIdByTeam = new Map<string, Map<string, string>>();

  constructor(
    config: TrackerConfig,
    log: Logger = createLogger({ pkg: "agent" }),
    client?: LinearClient,
  ) {
    this.#config = config;
    this.#log = log.child({ event_prefix: "tracker.linear" });
    this.#client = client;
  }

  async fetchCandidateIssues(): Promise<AgentIssue[]> {
    return await this.#paginateIssues(CANDIDATE_QUERY, (node) => normalizeLinearIssue(node));
  }

  async fetchIssueStatesByIds(issueIds: string[]) {
    if (!issueIds.length) {
      return new Map<string, string>();
    }
    const response = await this.#request<{
      issues?: {
        nodes?: Array<{ id: string; state?: { name?: string | null } | null } | null> | null;
      } | null;
    }>(STATE_QUERY, { ids: issueIds });
    return new Map(
      (response.issues?.nodes ?? [])
        .filter((node): node is { id: string; state?: { name?: string | null } | null } =>
          Boolean(node),
        )
        .map((node) => [node.id, node.state?.name?.trim() || "Unknown"]),
    );
  }

  async fetchIssuesByIds(issueIds: string[]) {
    if (!issueIds.length) {
      return new Map<string, AgentIssue>();
    }
    const response = await this.#request<IssuePage>(ISSUE_BY_IDS_QUERY, { ids: issueIds });
    return new Map(
      (response.issues?.nodes ?? [])
        .filter((node): node is CandidateIssueNode => Boolean(node))
        .map((node) => {
          const issue = normalizeLinearIssue(node);
          return [issue.id, issue] as const;
        }),
    );
  }

  async setIssueState(issueId: string, stateName: string) {
    const client = this.#getClient();
    const issue = await client.issue(issueId);
    const stateId = await this.#resolveStateId(issue, stateName);
    const payload = await issue.update({ stateId });
    if (!payload.success) {
      throw new Error(`linear_issue_update_failed:${issueId}:${stateName}`);
    }
  }

  async updateIssueDescription(issueId: string, description: string) {
    const client = this.#getClient();
    const issue = await client.issue(issueId);
    const payload = await issue.update({ description });
    if (!payload.success) {
      throw new Error(`linear_issue_description_update_failed:${issueId}`);
    }
  }

  async #paginateIssues<T>(
    query: string,
    mapNode: (node: CandidateIssueNode) => T,
    states = this.#config.activeStates,
  ): Promise<T[]> {
    const results: T[] = [];
    let after: string | undefined;
    for (;;) {
      const response = await this.#request<IssuePage>(query, {
        after,
        first: 50,
        projectSlug: this.#getProjectSlug(),
        states: uniqueStateNames(states),
      });
      const page = response.issues;
      for (const node of page?.nodes ?? []) {
        if (!node) {
          continue;
        }
        results.push(mapNode(node));
      }
      if (!page?.pageInfo?.hasNextPage) {
        return results;
      }
      after = page.pageInfo.endCursor ?? undefined;
      if (!after) {
        throw new Error("linear_missing_end_cursor");
      }
    }
  }

  async #request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const apiKey = this.#getApiKey();
    const response = await fetch(this.#config.endpoint, {
      body: JSON.stringify({ query, variables }),
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`linear_api_status:${response.status}`);
    }
    const payload = (await response.json()) as LinearResponse<T>;
    if (payload.errors?.length) {
      throw new Error(
        `linear_graphql_errors:${payload.errors.map((entry) => entry.message || "unknown").join("; ")}`,
      );
    }
    if (!payload.data) {
      throw new Error("linear_unknown_payload");
    }
    return payload.data;
  }

  #getClient() {
    this.#client ??= new LinearClient({
      apiKey: this.#getApiKey(),
      apiUrl: this.#config.endpoint,
    });
    return this.#client;
  }

  async #resolveStateId(issue: { id: string; teamId?: string | null }, stateName: string) {
    const client = this.#getClient();
    const issueId = issue.id;
    const teamId = issue.teamId?.trim();
    if (!teamId) {
      throw new Error(`linear_issue_team_missing:${issueId}`);
    }
    let stateIds = this.#stateIdByTeam.get(teamId);
    if (!stateIds) {
      const team = await client.team(teamId);
      const states = await team.states();
      stateIds = new Map(
        states.nodes
          .map((state) => {
            const name = state.name?.trim();
            const id = state.id?.trim();
            if (!name || !id) {
              return undefined;
            }
            return [normalizeStateName(name), id] as const;
          })
          .filter((entry): entry is readonly [string, string] => Boolean(entry)),
      );
      this.#stateIdByTeam.set(teamId, stateIds);
    }
    const stateId = stateIds.get(normalizeStateName(stateName));
    if (!stateId) {
      throw new Error(`linear_state_not_found:${teamId}:${stateName}`);
    }
    return stateId;
  }

  #getApiKey() {
    const value = this.#config.apiKey?.trim();
    if (!value) {
      this.#log.error("missing_tracker_api_key");
      throw new Error("missing_tracker_api_key");
    }
    return value;
  }

  #getProjectSlug() {
    const value = this.#config.projectSlug?.trim();
    if (!value) {
      this.#log.error("missing_tracker_project_slug");
      throw new Error("missing_tracker_project_slug");
    }
    return value;
  }
}
