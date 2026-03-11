import { createLogger, type Logger } from "@io/lib";
import { LinearClient } from "@linear/sdk";

import { parseManagedComment, renderManagedCommentReply } from "../managed-comments.js";
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

type LinearIssueEntity = Awaited<ReturnType<LinearClient["issue"]>>;

interface ExistingChildIssue {
  attachedDocs: Set<string>;
  blockedByRelationIdsByIssueId: Map<string, string>;
  description: string;
  id: string;
  identifier: string;
  issue: LinearIssueEntity;
  labelIdsByName: Map<string, string>;
  priority: number | null;
  state: string;
  title: string;
}

interface ManagedChildAssignment {
  blockedByRelationIdsByIssueId: Map<string, string>;
  desired: ManagedCommentMutation["children"][number];
  id: string;
  identifier?: string;
}

interface ManagedChildSyncResult {
  changeCount: number;
  createdChildIssueIdentifiers: string[];
  dependencyCount: number;
  summaryLines: string[];
  updatedChildIssueIdentifiers: string[];
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

function normalizeTitle(title: string) {
  return title.trim().toLowerCase();
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
    const dryRun = "payload" in mutation.comment && mutation.comment.payload.dryRun;
    if (!teamId) {
      throw new Error(`linear_issue_team_missing:${issue.id}`);
    }

    let updatedParentDescription = false;
    const createdChildIssueIdentifiers: string[] = [];
    let updatedChildIssueIdentifiers: string[] = [];
    let dependencyCount = 0;
    let childChangeCount = 0;
    let summaryLines: string[] = [];
    let result: ManagedCommentMutationResult["result"] = mutation.reply.result;

    try {
      if (
        mutation.parentDescription !== undefined &&
        mutation.parentDescription !== issue.description &&
        !dryRun
      ) {
        const payload = await issueRef.update({ description: mutation.parentDescription });
        if (!payload.success) {
          throw new Error(`linear_issue_description_update_failed:${issue.id}`);
        }
        updatedParentDescription = true;
      }
      const childSync = await this.#syncManagedTodoChildren({
        client,
        dryRun,
        issue,
        issueRef,
        mutation,
        teamId,
        warnings,
      });
      createdChildIssueIdentifiers.push(...childSync.createdChildIssueIdentifiers);
      dependencyCount = childSync.dependencyCount;
      childChangeCount = childSync.changeCount;
      summaryLines = childSync.summaryLines;
      updatedChildIssueIdentifiers = childSync.updatedChildIssueIdentifiers;
      result = this.#resolveManagedMutationResult({
        base: mutation.reply.result,
        changed: updatedParentDescription || childChangeCount > 0,
        dryRun,
      });
    } catch (error) {
      result =
        updatedParentDescription ||
          createdChildIssueIdentifiers.length ||
          dependencyCount ||
          childChangeCount
          ? "partial"
          : "blocked";
      warnings.push(this.#toErrorMessage(error));
    }

    const replyPayload = await client.createComment({
      body: this.#renderReplyBody({
        lines: [
          ...mutation.reply.lines,
          ...this.#renderParentDescriptionSummary({
            changed: mutation.parentDescription !== undefined && mutation.parentDescription !== issue.description,
            dryRun,
            present: mutation.parentDescription !== undefined,
            updated: updatedParentDescription,
          }),
          ...summaryLines,
        ],
        reply: mutation.reply,
        result,
        warnings,
      }),
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
      updatedChildIssueIdentifiers,
      updatedParentDescription,
      warnings,
    };
  }

  async #syncManagedTodoChildren(options: {
    client: LinearClient;
    dryRun: boolean;
    issue: AgentIssue;
    issueRef: LinearIssueEntity;
    mutation: ManagedCommentMutation;
    teamId: string;
    warnings: string[];
  }): Promise<ManagedChildSyncResult> {
    const existingChildren = await this.#loadExistingChildren(options.issueRef);
    const existingChildIdsByReference = new Map<string, string>();
    for (const child of existingChildren) {
      existingChildIdsByReference.set(child.id, child.id);
      existingChildIdsByReference.set(child.identifier, child.id);
    }
    const remainingTodoChildren = existingChildren
      .filter((child) => normalizeStateName(child.state) === "todo")
      .sort((left, right) => left.identifier.localeCompare(right.identifier));
    const assignments: ManagedChildAssignment[] = [];
    const createdChildIssueIdentifiers: string[] = [];
    const reusedChildIssueIdentifiers: string[] = [];
    const updatedChildIssueIdentifiers: string[] = [];
    let changeCount = 0;
    let dependencyCount = 0;

    for (const desired of options.mutation.children) {
      const matched =
        this.#takeMatchingTodoChild(remainingTodoChildren, desired.title) ??
        remainingTodoChildren.shift();
      if (matched) {
        reusedChildIssueIdentifiers.push(matched.identifier);
        const changed = await this.#syncExistingTodoChild({
          child: matched,
          client: options.client,
          desired,
          dryRun: options.dryRun,
          issue: options.issue,
          teamId: options.teamId,
          warnings: options.warnings,
        });
        if (changed) {
          changeCount += 1;
          updatedChildIssueIdentifiers.push(matched.identifier);
        }
        assignments.push({
          blockedByRelationIdsByIssueId: new Map(matched.blockedByRelationIdsByIssueId),
          desired,
          id: matched.id,
          identifier: matched.identifier,
        });
        continue;
      }

      const created = await this.#createManagedTodoChild({
        client: options.client,
        desired,
        dryRun: options.dryRun,
        issue: options.issue,
        teamId: options.teamId,
        warnings: options.warnings,
      });
      if (created.identifier) {
        createdChildIssueIdentifiers.push(created.identifier);
      }
      if (created.changed) {
        changeCount += 1;
      }
      assignments.push({
        blockedByRelationIdsByIssueId: new Map(),
        desired,
        id: created.id,
        identifier: created.identifier,
      });
    }

    const assignmentByReference = new Map(assignments.map((assignment) => [assignment.desired.reference, assignment]));
    for (const assignment of assignments) {
      const desiredBlockedByIds = assignment.desired.blockedBy
        .map(
          (reference) =>
            assignmentByReference.get(reference)?.id ?? existingChildIdsByReference.get(reference),
        )
        .filter((id): id is string => Boolean(id));
      const currentBlockedByIds = new Set(assignment.blockedByRelationIdsByIssueId.keys());
      const desiredBlockedByIdSet = new Set(desiredBlockedByIds);
      const relationsToDelete = [...assignment.blockedByRelationIdsByIssueId.entries()]
        .filter(([relatedIssueId]) => !desiredBlockedByIdSet.has(relatedIssueId))
        .map(([, relationId]) => relationId);
      const relatedIssueIdsToCreate = desiredBlockedByIds.filter(
        (relatedIssueId) => !currentBlockedByIds.has(relatedIssueId),
      );

      if (!options.dryRun) {
        for (const relationId of relationsToDelete) {
          const payload = await options.client.deleteIssueRelation(relationId);
          if (!payload.success) {
            options.warnings.push(`Failed to remove dependency from ${assignment.identifier ?? assignment.desired.title}.`);
            continue;
          }
          dependencyCount += 1;
        }
        for (const relatedIssueId of relatedIssueIdsToCreate) {
          const payload = await options.client.createIssueRelation({
            issueId: assignment.id,
            relatedIssueId,
            type: "blocks",
          } as Parameters<LinearClient["createIssueRelation"]>[0]);
          if (!payload.success) {
            options.warnings.push(
              `Failed to create dependency for ${assignment.identifier ?? assignment.desired.title}.`,
            );
            continue;
          }
          dependencyCount += 1;
        }
      } else {
        dependencyCount += relationsToDelete.length + relatedIssueIdsToCreate.length;
      }
    }

    return {
      changeCount: changeCount + dependencyCount,
      createdChildIssueIdentifiers,
      dependencyCount,
      summaryLines: this.#renderManagedChildSummary({
        createdChildIssueIdentifiers,
        dependencyCount,
        dryRun: options.dryRun,
        mutation: options.mutation,
        reusedChildIssueIdentifiers,
        updatedChildIssueIdentifiers,
      }),
      updatedChildIssueIdentifiers,
    };
  }

  async #loadExistingChildren(issueRef: LinearIssueEntity) {
    const children = await issueRef.children({ first: 250 });
    const loadedChildren = await Promise.all(
      (children.nodes ?? []).filter(Boolean).map(async (child) => {
        const [attachments, state, labels, inverseRelations] = await Promise.all([
          child.attachments({ first: 250 }),
          child.state,
          child.labels({ first: 250 }),
          child.inverseRelations({ first: 250 }),
        ]);
        return {
          attachedDocs: new Set(
            (attachments.nodes ?? [])
              .map((attachment) => attachment?.url?.trim() || attachment?.title?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
          blockedByRelationIdsByIssueId: new Map(
            (inverseRelations.nodes ?? [])
              .filter((relation) => relation?.type?.trim().toLowerCase() === "blocks")
              .map((relation) => {
                const relatedIssueId = relation?.relatedIssueId?.trim();
                const relationId = relation?.id?.trim();
                if (!relatedIssueId || !relationId) {
                  return undefined;
                }
                return [relatedIssueId, relationId] as const;
              })
              .filter((entry): entry is readonly [string, string] => Boolean(entry)),
          ),
          description: child.description?.trim() ?? "",
          id: child.id,
          identifier: child.identifier,
          issue: child,
          labelIdsByName: new Map(
            (labels.nodes ?? [])
              .map((label) => {
                const id = label?.id?.trim();
                const name = label?.name?.trim().toLowerCase();
                if (!id || !name) {
                  return undefined;
                }
                return [name, id] as const;
              })
              .filter((entry): entry is readonly [string, string] => Boolean(entry)),
          ),
          priority: typeof child.priority === "number" ? child.priority : null,
          state: state?.name?.trim() || "Unknown",
          title: child.title.trim(),
        } satisfies ExistingChildIssue;
      }),
    );
    return loadedChildren.sort((left, right) => left.identifier.localeCompare(right.identifier));
  }

  #takeMatchingTodoChild(children: ExistingChildIssue[], title: string) {
    const index = children.findIndex((child) => normalizeTitle(child.title) === normalizeTitle(title));
    if (index === -1) {
      return undefined;
    }
    return children.splice(index, 1)[0];
  }

  async #syncExistingTodoChild(options: {
    child: ExistingChildIssue;
    client: LinearClient;
    desired: ManagedCommentMutation["children"][number];
    dryRun: boolean;
    issue: AgentIssue;
    teamId: string;
    warnings: string[];
  }) {
    const expectedPriority = options.desired.priority ?? options.issue.priority ?? null;
    const descriptionChanged = options.child.description !== options.desired.description.trim();
    const titleChanged = options.child.title !== options.desired.title;
    const priorityChanged = (options.child.priority ?? null) !== expectedPriority;
    const stateChanged =
      options.desired.state &&
      normalizeStateName(options.child.state) !== normalizeStateName(options.desired.state);
    const missingLabels = options.desired.labels.filter(
      (label) => !options.child.labelIdsByName.has(label.trim().toLowerCase()),
    );
    const missingDocs = options.desired.docs.filter((doc) => !options.child.attachedDocs.has(doc));
    const changed =
      descriptionChanged ||
      titleChanged ||
      priorityChanged ||
      Boolean(stateChanged) ||
      missingLabels.length > 0 ||
      missingDocs.length > 0;

    if (!changed || options.dryRun) {
      return changed;
    }

    const updateInput: Record<string, unknown> = {};
    if (descriptionChanged) {
      updateInput.description = options.desired.description;
    }
    if (titleChanged) {
      updateInput.title = options.desired.title;
    }
    if (priorityChanged) {
      updateInput.priority = expectedPriority ?? undefined;
    }
    if (stateChanged) {
      updateInput.stateId = await this.#resolveStateId(
        { id: options.child.id, teamId: options.teamId },
        options.desired.state!,
      );
    }
    if (Object.keys(updateInput).length) {
      const payload = await options.child.issue.update(updateInput);
      if (!payload.success) {
        throw new Error(`linear_issue_update_failed:${options.child.identifier}`);
      }
    }

    if (missingLabels.length) {
      const labelIds = await this.#resolveLabelIds(options.teamId, missingLabels);
      for (const labelId of labelIds) {
        const payload = await options.client.issueAddLabel(options.child.id, labelId);
        if (!payload.success) {
          options.warnings.push(`Failed to attach label ${labelId} to ${options.child.identifier}.`);
        }
      }
    }

    for (const doc of missingDocs) {
      try {
        await options.client.attachmentLinkURL(options.child.id, doc, { title: doc });
      } catch (error) {
        options.warnings.push(
          `Failed to attach doc ${doc} to ${options.child.identifier}: ${this.#toErrorMessage(error)}`,
        );
      }
    }

    return true;
  }

  async #createManagedTodoChild(options: {
    client: LinearClient;
    desired: ManagedCommentMutation["children"][number];
    dryRun: boolean;
    issue: AgentIssue;
    teamId: string;
    warnings: string[];
  }) {
    if (options.dryRun) {
      return {
        changed: true,
        id: `dry-run:${options.desired.reference}`,
        identifier: undefined,
      };
    }

    const stateId = options.desired.state
      ? await this.#resolveStateId({ id: options.issue.id, teamId: options.teamId }, options.desired.state)
      : undefined;
    const created = await options.client.createIssue({
      description: options.desired.description,
      parentId: options.issue.id,
      priority: options.desired.priority ?? options.issue.priority ?? undefined,
      stateId,
      teamId: options.teamId,
      title: options.desired.title,
    } as Parameters<LinearClient["createIssue"]>[0]);
    if (!created.success || !created.issueId) {
      throw new Error(`linear_issue_create_failed:${options.issue.id}:${options.desired.title}`);
    }

    const createdIssue = await created.issue;
    if (!createdIssue?.identifier) {
      throw new Error(`linear_issue_identifier_missing:${options.issue.id}:${options.desired.title}`);
    }

    const labelIds = await this.#resolveLabelIds(options.teamId, options.desired.labels);
    for (const labelId of labelIds) {
      const labelPayload = await options.client.issueAddLabel(created.issueId, labelId);
      if (!labelPayload.success) {
        options.warnings.push(`Failed to attach label ${labelId} to ${createdIssue.identifier}.`);
      }
    }

    for (const doc of options.desired.docs) {
      try {
        await options.client.attachmentLinkURL(created.issueId, doc, { title: doc });
      } catch (error) {
        options.warnings.push(
          `Failed to attach doc ${doc} to ${createdIssue.identifier}: ${this.#toErrorMessage(error)}`,
        );
      }
    }

    return {
      changed: true,
      id: created.issueId,
      identifier: createdIssue.identifier,
    };
  }

  #renderManagedChildSummary(options: {
    createdChildIssueIdentifiers: string[];
    dependencyCount: number;
    dryRun: boolean;
    mutation: ManagedCommentMutation;
    reusedChildIssueIdentifiers: string[];
    updatedChildIssueIdentifiers: string[];
  }) {
    const lines: string[] = [];
    if (options.reusedChildIssueIdentifiers.length) {
      lines.push(
        `Reused Todo children: ${options.reusedChildIssueIdentifiers.join(", ")}.`,
      );
    }
    if (options.updatedChildIssueIdentifiers.length) {
      lines.push(
        options.dryRun
          ? `Dry run: would update ${options.updatedChildIssueIdentifiers.length} Todo child issues.`
          : `Updated Todo children: ${options.updatedChildIssueIdentifiers.join(", ")}.`,
      );
    }
    if (options.createdChildIssueIdentifiers.length) {
      lines.push(`Created Todo children: ${options.createdChildIssueIdentifiers.join(", ")}.`);
    } else if (options.dryRun) {
      const plannedCreates = Math.max(
        0,
        options.mutation.children.length - options.reusedChildIssueIdentifiers.length,
      );
      if (plannedCreates > 0) {
        lines.push(`Dry run: would create ${plannedCreates} Todo child issues.`);
      }
    }
    if (options.dependencyCount > 0) {
      lines.push(
        options.dryRun
          ? `Dry run: would relink ${options.dependencyCount} backlog dependency edges.`
          : `Relinked ${options.dependencyCount} backlog dependency edges.`,
      );
    }
    if (!lines.length && options.mutation.children.length) {
      lines.push(
        options.dryRun
          ? "Dry run: the speculative child backlog is already up to date."
          : "The speculative child backlog was already up to date.",
      );
    }
    return lines;
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

  #resolveManagedMutationResult(options: {
    base: ManagedCommentMutationResult["result"];
    changed: boolean;
    dryRun: boolean;
  }) {
    if (options.base === "blocked" || options.base === "partial") {
      return options.base;
    }
    if (options.dryRun) {
      return options.base === "updated" ? "noop" : options.base;
    }
    if (options.changed) {
      return "updated";
    }
    return options.base;
  }

  #renderParentDescriptionSummary(options: {
    changed: boolean;
    dryRun: boolean;
    present: boolean;
    updated: boolean;
  }) {
    if (!options.present) {
      return [];
    }
    if (!options.changed && !options.updated) {
      return options.dryRun
        ? ["Dry run: the parent managed brief is already up to date."]
        : ["The parent managed brief was already up to date."];
    }
    if (options.dryRun) {
      return ["Dry run: would update the parent managed brief."];
    }
    return options.updated ? ["Updated the parent managed brief."] : [];
  }

  #renderReplyBody(options: {
    lines: string[];
    reply: ManagedCommentMutation["reply"];
    result: ManagedCommentMutationResult["result"];
    warnings: string[];
  }) {
    return renderManagedCommentReply({
      command: options.reply.command,
      issueIdentifier: options.reply.issueIdentifier,
      lines: [
        ...options.lines,
        ...options.warnings.map((warning) => `Warning: ${warning}`),
      ],
      result: options.result,
    });
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
