"use client";

import type { QueryResultItem } from "@io/graph-client";
import type { CollectionSurfaceSpec } from "@io/graph-module";
import { ScrollArea } from "@io/web/scroll-area";
import { useEffect, useMemo, useState } from "react";

import { CollectionCommandActionButtons } from "./collection-command-actions.js";
import type { CollectionSurfaceRecordLookup } from "../lib/collection-surface.js";
import type {
  CollectionCommandExecutionResult,
  CollectionCommandSurfaceBinding,
  ResolvedCollectionCommandBinding,
} from "../lib/collection-command-surface.js";
import {
  createEntityCommandSubject,
  createSelectionCommandSubject,
  resolveCollectionCommandBindings,
} from "../lib/collection-command-surface.js";
import type {
  QueryContainerPageExecutor,
  QueryContainerRuntimeController,
  QueryContainerRuntimeValue,
} from "../lib/query-container.js";
import { CollectionSurfaceMount } from "./collection-surface-mount.js";
import { EntityCreateButton, EntityCreateRuntimeProvider } from "./entity-create-button.js";
import { buildEntityCatalog } from "./explorer/catalog.js";
import { EntityInspector } from "./explorer/entities.js";
import { postSecretFieldMutation } from "./explorer/helpers.js";
import type {
  EntityCatalogEntry,
  ExplorerRuntime,
  SubmitSecretFieldMutation,
} from "./explorer/model.js";
import { ExplorerSyncContext, useExplorerSyncSnapshot } from "./explorer/sync.js";
import { EmptyState, Section } from "./explorer/ui.js";

function resolveEntityTypeEntry(
  entityEntryById: ReadonlyMap<string, EntityCatalogEntry>,
  typeId: string,
): EntityCatalogEntry {
  const typeEntry = entityEntryById.get(typeId);
  if (!typeEntry) {
    throw new Error(`Entity type "${typeId}" is not available in the explorer catalog.`);
  }
  return typeEntry;
}

function readCollectionItems(
  value: QueryContainerRuntimeValue | undefined,
): readonly QueryResultItem[] {
  if (!value) {
    return [];
  }
  if (
    value.state.kind === "ready" ||
    value.state.kind === "paginated" ||
    value.state.kind === "refreshing" ||
    value.state.kind === "stale"
  ) {
    return value.state.result.items;
  }
  return [];
}

function readActiveItemKey(
  items: readonly QueryResultItem[],
  selectedEntityId: string | null,
): string | undefined {
  if (!selectedEntityId) {
    return undefined;
  }
  return items.find((item) => item.entityId === selectedEntityId)?.key;
}

export type CollectionBrowserSurfaceProps = {
  readonly collection: CollectionSurfaceSpec;
  readonly commandBindings?: Readonly<Record<string, CollectionCommandSurfaceBinding>>;
  readonly executePage?: QueryContainerPageExecutor;
  readonly initialValue?: QueryContainerRuntimeValue;
  readonly lookup: CollectionSurfaceRecordLookup;
  readonly queryRuntime?: QueryContainerRuntimeController;
  readonly runtime: ExplorerRuntime;
  readonly submitSecretField?: SubmitSecretFieldMutation;
  readonly typeId: string;
};

export function CollectionBrowserSurface({
  collection,
  commandBindings = {},
  executePage,
  initialValue,
  lookup,
  queryRuntime,
  runtime,
  submitSecretField = postSecretFieldMutation,
  typeId,
}: CollectionBrowserSurfaceProps) {
  const syncSnapshot = useExplorerSyncSnapshot(runtime.sync);
  const entityEntries = useMemo(
    () => buildEntityCatalog(runtime.graph, runtime.store),
    [runtime.graph, runtime.store, syncSnapshot],
  );
  const entityEntryById = useMemo(
    () => new Map(entityEntries.map((entry) => [entry.id, entry])),
    [entityEntries],
  );
  const typeEntry = useMemo(
    () => resolveEntityTypeEntry(entityEntryById, typeId),
    [entityEntryById, typeId],
  );
  const entities = useMemo(() => typeEntry.ids.map((id) => typeEntry.getRef(id)), [typeEntry]);
  const [collectionValue, setCollectionValue] = useState<QueryContainerRuntimeValue | undefined>(
    initialValue,
  );
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const visibleItems = useMemo(() => readCollectionItems(collectionValue), [collectionValue]);
  const visibleEntityIds = useMemo(
    () =>
      visibleItems.flatMap((item) =>
        typeof item.entityId === "string" && item.entityId.length > 0 ? [item.entityId] : [],
      ),
    [visibleItems],
  );
  const activeItemKey = useMemo(
    () => readActiveItemKey(visibleItems, selectedEntityId),
    [selectedEntityId, visibleItems],
  );
  const resolvedCommandBindings = useMemo(
    () => resolveCollectionCommandBindings(collection, commandBindings),
    [collection, commandBindings],
  );
  const selectedEntity = entities.find((entity) => entity.id === selectedEntityId) ?? null;
  const collectionRefreshKey = `${syncSnapshot.state.cursor ?? "local"}:${syncSnapshot.pendingTransactions.length}`;

  useEffect(() => {
    setCollectionValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (visibleEntityIds.length === 0) {
      if (selectedEntityId !== null) {
        setSelectedEntityId(null);
      }
      return;
    }
    if (selectedEntityId && visibleEntityIds.includes(selectedEntityId)) {
      return;
    }
    setSelectedEntityId(visibleEntityIds[0] ?? null);
  }, [selectedEntityId, visibleEntityIds]);

  async function handleCommandExecuted(
    binding: ResolvedCollectionCommandBinding,
    result: CollectionCommandExecutionResult | void,
    subject: ReturnType<typeof createEntityCommandSubject>,
  ): Promise<void> {
    if (subject?.kind === "entity") {
      setSelectedEntityId(subject.entityId);
    }
    for (const behavior of binding.surface.postSuccess) {
      if (behavior.kind === "refresh") {
        await runtime.sync.flush();
      }
      if (behavior.kind === "openCreatedEntity" && result?.createdEntityId) {
        setSelectedEntityId(result.createdEntityId);
      }
    }
  }

  const affordances =
    resolvedCommandBindings.entityCommands.length > 0 ||
    resolvedCommandBindings.selectionCommands.length > 0
      ? {
          ...(resolvedCommandBindings.entityCommands.length > 0
            ? {
                renderRowActions: (item: QueryResultItem) => (
                  <CollectionCommandActionButtons
                    commands={resolvedCommandBindings.entityCommands}
                    onExecuted={handleCommandExecuted}
                    scope="entity"
                    size="xs"
                    subject={createEntityCommandSubject(item)}
                    variant="ghost"
                  />
                ),
              }
            : {}),
          ...(resolvedCommandBindings.selectionCommands.length > 0
            ? {
                renderSelectionActions: (selection: {
                  readonly items: readonly QueryResultItem[];
                  readonly keys: readonly string[];
                }) => (
                  <CollectionCommandActionButtons
                    commands={resolvedCommandBindings.selectionCommands}
                    onExecuted={handleCommandExecuted}
                    scope="selection"
                    size="sm"
                    subject={createSelectionCommandSubject(selection.items)}
                    variant="outline"
                  />
                ),
              }
            : {}),
        }
      : undefined;

  return (
    <ExplorerSyncContext.Provider value={runtime.sync}>
      <EntityCreateRuntimeProvider runtime={runtime}>
        <div
          className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(24rem,1.1fr)_minmax(0,1fr)]"
          data-collection-browser={collection.key}
        >
          <div className="grid min-h-0 gap-3">
            <div className="flex justify-end">
              <EntityCreateButton
                onCreated={(entityId) => {
                  setSelectedEntityId(entityId);
                }}
                typeId={typeId}
              />
            </div>

            <CollectionSurfaceMount
              activeItemKey={activeItemKey}
              affordances={affordances}
              collection={collection}
              executePage={executePage}
              initialValue={initialValue}
              key={collectionRefreshKey}
              lookup={lookup}
              onActivateItem={(item) => {
                if (!item.entityId) {
                  return;
                }
                setSelectedEntityId(item.entityId);
              }}
              onValueChange={setCollectionValue}
              runtime={queryRuntime}
            />
          </div>

          <div className="min-h-0">
            {selectedEntity ? (
              <ScrollArea className="h-full pr-1">
                <EntityInspector
                  entity={selectedEntity}
                  runtime={runtime}
                  store={runtime.store}
                  submitSecretField={submitSecretField}
                  typeEntry={typeEntry}
                />
              </ScrollArea>
            ) : (
              <Section title="Detail">
                <EmptyState>Select a record to open its field editor.</EmptyState>
              </Section>
            )}
          </div>
        </div>
      </EntityCreateRuntimeProvider>
    </ExplorerSyncContext.Provider>
  );
}
