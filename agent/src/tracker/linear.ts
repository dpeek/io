import { createLogger, type Logger } from "@io/lib";
import { LinearClient } from "@linear/sdk";

import { parseManagedComment } from "../managed-comments.js";
import type {
  AgentIssue,
  ManagedCommentMutation,
  ManagedCommentMutationResult,
  ManagedCommentTrigger,
  TrackerConfig,
} from "../types.js";

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  createdAt
  updatedAt
  project { slugId }
  team { id }
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

const MANAGED_COMMENT_QUERY = `
query ManagedCommentIssues(
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
      comments(first: 100) {
        nodes {
          id
          body
          createdAt
          updatedAt
          parent { id }
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

interface IssueRelationNode {
  relatedIssue?: { id: string; state?: { name?: string | null } | null } | null;
  type?: string | null;
}

interface CandidateIssueNode {
  children?: {
    nodes?: Array<{ id: string } | null> | null;
  } | null;
  comments?: {
    nodes?: Array<CommentNode | null> | null;
  } | null;
  createdAt: string;
  description?: string | null;
  id: string;
  identifier: string;
  inverseRelations?: {
    nodes?: Array<IssueRelationNode | null> | null;
  } | null;
  labels?: { nodes?: Array<{ name?: string | null } | null> | null } | null;
  parent?: { id: string; identifier?: string | null } | null;
  priority?: number | null;
  project?: { slugId?: string | null } | null;
  state?: { name?: string | null } | null;
  team?: { id?: string | null } | null;
  title: string;
  updatedAt: string;
}

interface CommentNode {
  body?: string | null;
  createdAt: string;
  id: string;
  parent?: { id?: string | null } | null;
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

function isDoneState(state?: string | null) {
  return state?.trim().toLowerCase() === "done";
}

export function normalizeLinearIssue(node: CandidateIssueNode): AgentIssue {
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
    hasParent: Boolean(node.parent?.id),
    id: node.id,
    identifier: node.identifier,
    labels: (node.labels?.nodes ?? [])
      .map((label) => label?.name?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
    parentIssueId: node.parent?.id ?? undefined,
    parentIssueIdentifier: node.parent?.identifier?.trim() || undefined,
    priority:
      typeof node.priority === "number" && Number.isInteger(node.priority) ? node.priority : null,
    projectSlug: node.project?.slugId?.trim() || undefined,
    state: node.state?.name?.trim() || "Unknown",
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

  async fetchManagedCommentTriggers(): Promise<ManagedCommentTrigger[]> {
    return await this.#paginateIssues(MANAGED_COMMENT_QUERY, (node) => {
      const issue = normalizeLinearIssue(node);
      if (issue.hasParent || !issue.labels.includes("io")) {
        return [];
      }
      return (node.comments?.nodes ?? [])
        .filter((comment): comment is CommentNode => Boolean(comment))
        .filter((comment) => !comment.parent?.id)
        .map((comment) =>
          parseManagedComment({
            body: comment.body ?? "",
            commentId: comment.id,
            createdAt: comment.createdAt,
            issue,
            updatedAt: comment.updatedAt,
          }),
        )
        .filter((comment): comment is ManagedCommentTrigger => Boolean(comment));
    }).then((comments) =>
      comments.sort((left, right) => {
        if (left.issue.identifier !== right.issue.identifier) {
          return left.issue.identifier.localeCompare(right.issue.identifier);
        }
        if (left.createdAt !== right.createdAt) {
          return left.createdAt.localeCompare(right.createdAt);
        }
        return left.commentId.localeCompare(right.commentId);
      }),
    );
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

  async applyManagedCommentMutation(
    mutation: ManagedCommentMutation,
  ): Promise<ManagedCommentMutationResult> {
    const warnings: string[] = [];
    const client = this.#getClient();
    const issue = mutation.comment.issue;
    const issueRef = await client.issue(issue.id);
    const teamId = issue.teamId?.trim() || issueRef.teamId?.trim();
    if (!teamId) {
      throw new Error(`linear_issue_team_missing:${issue.id}`);
    }

    let updatedParentDescription = false;
    const createdChildIssueIdentifiers: string[] = [];
    let dependencyCount = 0;
    let result: ManagedCommentMutationResult["result"] =
      mutation.children.length || mutation.parentDescription ? "updated" : "noop";

    try {
      if (
        mutation.parentDescription !== undefined &&
        mutation.parentDescription !== issue.description &&
        !("payload" in mutation.comment && mutation.comment.payload.dryRun)
      ) {
        const payload = await issueRef.update({ description: mutation.parentDescription });
        if (!payload.success) {
          throw new Error(`linear_issue_description_update_failed:${issue.id}`);
        }
        updatedParentDescription = true;
      }

      const childIdsByReference = new Map<string, string>();
      for (const existingChild of (await issueRef.children({ first: 250 })).nodes) {
        if (!existingChild?.id || !existingChild.identifier) {
          continue;
        }
        childIdsByReference.set(existingChild.id, existingChild.id);
        childIdsByReference.set(existingChild.identifier, existingChild.id);
      }

      if ("payload" in mutation.comment && mutation.comment.payload.dryRun) {
        result = "noop";
      } else {
        for (const child of mutation.children) {
          const stateId = child.state
            ? await this.#resolveStateId({ id: issue.id, teamId }, child.state)
            : undefined;
          const created = await client.createIssue({
            description: child.description,
            parentId: issue.id,
            priority: child.priority ?? issue.priority ?? undefined,
            stateId,
            teamId,
            title: child.title,
          } as Parameters<LinearClient["createIssue"]>[0]);
          if (!created.success || !created.issueId) {
            throw new Error(`linear_issue_create_failed:${issue.id}:${child.title}`);
          }

          const createdIssue = await created.issue;
          if (!createdIssue?.identifier) {
            throw new Error(`linear_issue_identifier_missing:${issue.id}:${child.title}`);
          }
          createdChildIssueIdentifiers.push(createdIssue.identifier);
          childIdsByReference.set(created.issueId, created.issueId);
          childIdsByReference.set(createdIssue.identifier, created.issueId);

          const labelIds = await this.#resolveLabelIds(teamId, child.labels);
          for (const labelId of labelIds) {
            const labelPayload = await client.issueAddLabel(created.issueId, labelId);
            if (!labelPayload.success) {
              warnings.push(`Failed to attach label ${labelId} to ${createdIssue.identifier}.`);
            }
          }

          for (const doc of child.docs) {
            try {
              await client.attachmentLinkURL(created.issueId, doc, { title: doc });
            } catch (error) {
              warnings.push(
                `Failed to attach doc ${doc} to ${createdIssue.identifier}: ${this.#toErrorMessage(error)}`,
              );
            }
          }
        }

        for (const child of mutation.children) {
          const createdChildId = createdChildIssueIdentifiers[mutation.children.indexOf(child)];
          if (!createdChildId) {
            continue;
          }
          const currentIssueId = childIdsByReference.get(createdChildId) ?? createdChildId;
          for (const blockedBy of child.blockedBy) {
            const relatedIssueId = childIdsByReference.get(blockedBy);
            if (!relatedIssueId) {
              warnings.push(
                `Skipped dependency ${createdChildId} <- ${blockedBy}; target not found.`,
              );
              continue;
            }
            const payload = await client.createIssueRelation({
              issueId: currentIssueId,
              relatedIssueId,
              type: "blocks",
            } as Parameters<LinearClient["createIssueRelation"]>[0]);
            if (!payload.success) {
              warnings.push(`Failed to create dependency ${createdChildId} <- ${blockedBy}.`);
              continue;
            }
            dependencyCount += 1;
          }
        }
      }
    } catch (error) {
      result =
        updatedParentDescription || createdChildIssueIdentifiers.length || dependencyCount
          ? "partial"
          : "blocked";
      warnings.push(this.#toErrorMessage(error));
    }

    const replyPayload = await client.createComment({
      body: this.#renderReplyBody(mutation.replyBody, result, warnings),
      issueId: issue.id,
      parentId: mutation.comment.commentId,
    } as Parameters<LinearClient["createComment"]>[0]);
    if (!replyPayload.success) {
      throw new Error(`linear_comment_create_failed:${mutation.comment.commentId}`);
    }

    return {
      createdChildIssueIdentifiers,
      dependencyCount,
      replyCommentId: replyPayload.commentId,
      result,
      updatedParentDescription,
      warnings,
    };
  }

  async #paginateIssues<T>(
    query: string,
    mapNode: (node: CandidateIssueNode) => T | T[],
  ): Promise<T[]> {
    const results: T[] = [];
    let after: string | undefined;
    for (;;) {
      const response = await this.#request<IssuePage>(query, {
        after,
        first: 50,
        projectSlug: this.#getProjectSlug(),
        states: this.#config.activeStates,
      });
      const page = response.issues;
      for (const node of page?.nodes ?? []) {
        if (!node) {
          continue;
        }
        const mapped = mapNode(node);
        if (Array.isArray(mapped)) {
          results.push(...mapped);
        } else {
          results.push(mapped);
        }
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

  async #resolveLabelIds(teamId: string, names: string[]) {
    if (!names.length) {
      return [];
    }
    const team = await this.#getClient().team(teamId);
    const labels = await team.labels({ first: 250 });
    const labelIdByName = new Map(
      labels.nodes
        .map((label) => {
          const id = label?.id?.trim();
          const name = label?.name?.trim().toLowerCase();
          if (!id || !name) {
            return undefined;
          }
          return [name, id] as const;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry)),
    );

    return names
      .map((name) => labelIdByName.get(name.trim().toLowerCase()))
      .filter((labelId): labelId is string => Boolean(labelId));
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

  #toErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  #renderReplyBody(
    base: string,
    result: ManagedCommentMutationResult["result"],
    warnings: string[],
  ) {
    const resultBody = base.replace(/^Result: .*$/m, `Result: ${result}`);
    if (!warnings.length) {
      return resultBody;
    }
    return `${resultBody}\n- Warning: ${warnings.join("\n- Warning: ")}`;
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
