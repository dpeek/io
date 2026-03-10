import { LinearClient } from "@linear/sdk";
import { createLogger, type Logger } from "@io/lib";

import type { AgentIssue, TrackerConfig } from "../types.js";

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
      id
      identifier
      title
      description
      priority
      createdAt
      updatedAt
      project { slugId }
      state { name }
      parent {
        id
        identifier
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

interface LinearResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
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
    nodes?: Array<
      | {
          relatedIssue?: { id: string; state?: { name?: string | null } | null } | null;
          type?: string | null;
        }
      | null
    > | null;
  } | null;
  labels?: { nodes?: Array<{ name?: string | null } | null> | null } | null;
  parent?: { id: string; identifier?: string | null } | null;
  priority?: number | null;
  project?: { slugId?: string | null } | null;
  state?: { name?: string | null } | null;
  title: string;
  updatedAt: string;
}

interface CandidateIssuePage {
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

export function normalizeLinearIssue(node: CandidateIssueNode): AgentIssue {
  return {
    blockedBy: (node.inverseRelations?.nodes ?? [])
      .filter(
        (
          relation,
        ): relation is {
          relatedIssue?: { id: string; state?: { name?: string | null } | null } | null;
          type?: string | null;
        } => !!relation,
      )
      .filter((relation) => relation.type?.trim().toLowerCase() === "blocks")
      .map((relation) => relation.relatedIssue)
      .filter(
        (
          relatedIssue,
        ): relatedIssue is {
          id: string;
          state?: { name?: string | null } | null;
        } => !!relatedIssue,
      )
      .filter((relatedIssue) => relatedIssue.id !== node.id)
      .filter((relatedIssue) => relatedIssue.state?.name?.trim().toLowerCase() !== "done")
      .map((relatedIssue) => relatedIssue.id),
    createdAt: node.createdAt,
    description: node.description ?? "",
    hasChildren: (node.children?.nodes ?? []).some((child) => Boolean(child?.id)),
    hasParent: Boolean(node.parent?.id),
    id: node.id,
    identifier: node.identifier,
    labels: (node.labels?.nodes ?? [])
      .map((label) => label?.name?.trim().toLowerCase())
      .filter((value): value is string => !!value),
    parentIssueId: node.parent?.id ?? undefined,
    parentIssueIdentifier: node.parent?.identifier?.trim() || undefined,
    priority: Number.isInteger(node.priority) ? node.priority! : null,
    projectSlug: node.project?.slugId?.trim() || undefined,
    state: node.state?.name?.trim() || "Unknown",
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
    const issues: AgentIssue[] = [];
    let after: string | undefined;
    for (;;) {
      const response = await this.#request<CandidateIssuePage>(CANDIDATE_QUERY, {
        after,
        first: 50,
        projectSlug: this.#getProjectSlug(),
        states: this.#config.activeStates,
      });
      const page = response.issues;
      for (const issue of page?.nodes ?? []) {
        if (issue) {
          issues.push(normalizeLinearIssue(issue));
        }
      }
      if (!page?.pageInfo?.hasNextPage) {
        return issues;
      }
      after = page.pageInfo.endCursor ?? undefined;
      if (!after) {
        throw new Error("linear_missing_end_cursor");
      }
    }
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
        .filter((node): node is { id: string; state?: { name?: string | null } | null } => !!node)
        .map((node) => [node.id, node.state?.name?.trim() || "Unknown"]),
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
