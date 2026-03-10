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
      parent { id }
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
  parent?: { id: string } | null;
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
    priority: Number.isInteger(node.priority) ? node.priority! : null,
    projectSlug: node.project?.slugId?.trim() || undefined,
    state: node.state?.name?.trim() || "Unknown",
    title: node.title.trim(),
    updatedAt: node.updatedAt,
  };
}

export class LinearTrackerAdapter {
  readonly #config: TrackerConfig;
  readonly #log: Logger;

  constructor(config: TrackerConfig, log: Logger = createLogger({ pkg: "agent" })) {
    this.#config = config;
    this.#log = log.child({ event_prefix: "tracker.linear" });
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
