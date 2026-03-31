import type { QueryResultItem } from "@io/graph-client";
import type { CollectionSurfaceSpec, GraphCommandSurfaceSpec } from "@io/graph-module";

export type CollectionCommandExecutionSubject =
  | {
      readonly entityId: string;
      readonly item: QueryResultItem;
      readonly kind: "entity";
    }
  | {
      readonly entityIds: readonly string[];
      readonly items: readonly QueryResultItem[];
      readonly kind: "selection";
    };

export type CollectionCommandExecutionResult = {
  readonly createdEntityId?: string;
};

export type CollectionCommandSurfaceBinding = {
  readonly description?: string;
  readonly surface: GraphCommandSurfaceSpec;
  execute(
    subject: CollectionCommandExecutionSubject,
  ): CollectionCommandExecutionResult | Promise<CollectionCommandExecutionResult | void> | void;
};

export type CollectionCommandBindingIssueCode =
  | "binding-missing"
  | "unsupported-post-success"
  | "unsupported-subject-kind";

export type CollectionCommandBindingIssue = {
  readonly code: CollectionCommandBindingIssueCode;
  readonly commandSurfaceKey: string;
  readonly message: string;
};

export type ResolvedCollectionCommandBinding = {
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly surface: GraphCommandSurfaceSpec;
  readonly execute: CollectionCommandSurfaceBinding["execute"];
};

export type CollectionCommandBindingResolution = {
  readonly entityCommands: readonly ResolvedCollectionCommandBinding[];
  readonly issues: readonly CollectionCommandBindingIssue[];
  readonly selectionCommands: readonly ResolvedCollectionCommandBinding[];
};

function createIssue(
  code: CollectionCommandBindingIssueCode,
  commandSurfaceKey: string,
  message: string,
): CollectionCommandBindingIssue {
  return {
    code,
    commandSurfaceKey,
    message,
  };
}

function isSupportedPostSuccess(surface: GraphCommandSurfaceSpec): boolean {
  return surface.postSuccess.every(
    (behavior) => behavior.kind === "refresh" || behavior.kind === "openCreatedEntity",
  );
}

function resolveBindingLabel(binding: CollectionCommandSurfaceBinding): string {
  return binding.surface.label?.trim() || binding.surface.command;
}

function toResolvedBinding(
  binding: CollectionCommandSurfaceBinding,
): ResolvedCollectionCommandBinding {
  return {
    ...(binding.description ? { description: binding.description } : {}),
    execute: binding.execute,
    key: binding.surface.key,
    label: resolveBindingLabel(binding),
    surface: binding.surface,
  };
}

export function createEntityCommandSubject(
  item: QueryResultItem,
): CollectionCommandExecutionSubject | null {
  if (typeof item.entityId !== "string" || item.entityId.length === 0) {
    return null;
  }
  return {
    entityId: item.entityId,
    item,
    kind: "entity",
  };
}

export function createSelectionCommandSubject(
  items: readonly QueryResultItem[],
): CollectionCommandExecutionSubject | null {
  const entityItems = items.filter(
    (item): item is QueryResultItem & { readonly entityId: string } =>
      typeof item.entityId === "string" && item.entityId.length > 0,
  );
  if (entityItems.length === 0) {
    return null;
  }
  return {
    entityIds: entityItems.map((item) => item.entityId),
    items: entityItems,
    kind: "selection",
  };
}

export function resolveCollectionCommandBindings(
  collection: CollectionSurfaceSpec,
  bindings: Readonly<Record<string, CollectionCommandSurfaceBinding>>,
): CollectionCommandBindingResolution {
  const entityCommands: ResolvedCollectionCommandBinding[] = [];
  const selectionCommands: ResolvedCollectionCommandBinding[] = [];
  const issues: CollectionCommandBindingIssue[] = [];

  for (const key of collection.commandSurfaces ?? []) {
    const binding = bindings[key];
    if (!binding) {
      issues.push(
        createIssue(
          "binding-missing",
          key,
          `Collection surface "${collection.key}" references missing command surface binding "${key}".`,
        ),
      );
      continue;
    }
    if (!isSupportedPostSuccess(binding.surface)) {
      issues.push(
        createIssue(
          "unsupported-post-success",
          key,
          `Collection command surface "${key}" uses unsupported post-success behavior for the current proving-ground browser host.`,
        ),
      );
      continue;
    }

    switch (binding.surface.subject.kind) {
      case "entity":
        entityCommands.push(toResolvedBinding(binding));
        break;
      case "selection":
        selectionCommands.push(toResolvedBinding(binding));
        break;
      default:
        issues.push(
          createIssue(
            "unsupported-subject-kind",
            key,
            `Collection command surface "${key}" uses unsupported subject kind "${binding.surface.subject.kind}" for the current proving-ground browser host.`,
          ),
        );
        break;
    }
  }

  return {
    entityCommands,
    issues,
    selectionCommands,
  };
}
