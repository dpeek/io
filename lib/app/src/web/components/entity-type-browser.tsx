"use client";

import { ScrollArea } from "@io/web/scroll-area";
import { useEffect, useMemo, useState } from "react";

import { EntityCreateButton, EntityCreateRuntimeProvider } from "./entity-create-button.js";
import { buildEntityCatalog } from "./explorer/catalog.js";
import { EntityInspector, EntityListItem } from "./explorer/entities.js";
import { postSecretFieldMutation } from "./explorer/helpers.js";
import type {
  EntityCatalogEntry,
  ExplorerRuntime,
  SubmitSecretFieldMutation,
} from "./explorer/model.js";
import { useExplorerSyncSnapshot } from "./explorer/sync.js";
import { EmptyState, Section } from "./explorer/ui.js";
import { useGraphRuntime } from "./graph-runtime-bootstrap.js";

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

export function EntityTypeBrowserSurface({
  onCreated,
  onSelectEntity,
  runtime,
  selectedEntityId: controlledSelectedEntityId,
  submitSecretField = postSecretFieldMutation,
  title,
  typeId,
}: {
  onCreated?: (entityId: string) => void;
  onSelectEntity?: (entityId: string) => void;
  runtime: ExplorerRuntime;
  selectedEntityId?: string | null;
  submitSecretField?: SubmitSecretFieldMutation;
  title: string;
  typeId: string;
}) {
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
  const [uncontrolledSelectedEntityId, setUncontrolledSelectedEntityId] = useState<string | null>(
    () => entities[0]?.id ?? null,
  );
  const selectedEntityId = controlledSelectedEntityId ?? uncontrolledSelectedEntityId;

  useEffect(() => {
    if (entities.length === 0) {
      if (controlledSelectedEntityId === undefined && uncontrolledSelectedEntityId !== null) {
        setUncontrolledSelectedEntityId(null);
      }
      return;
    }
    if (selectedEntityId && entities.some((entity) => entity.id === selectedEntityId)) return;
    if (controlledSelectedEntityId !== undefined) {
      onSelectEntity?.(entities[0]!.id);
      return;
    }
    setUncontrolledSelectedEntityId(entities[0]!.id);
  }, [
    controlledSelectedEntityId,
    entities,
    onSelectEntity,
    selectedEntityId,
    uncontrolledSelectedEntityId,
  ]);

  const selectedEntity = entities.find((entity) => entity.id === selectedEntityId) ?? null;

  function commitEntitySelection(entityId: string): void {
    onSelectEntity?.(entityId);
    if (controlledSelectedEntityId === undefined) {
      setUncontrolledSelectedEntityId(entityId);
    }
  }

  return (
    <EntityCreateRuntimeProvider runtime={runtime}>
      <div
        className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]"
        data-entity-type-browser={typeId}
      >
        <Section
          right={
            <EntityCreateButton
              onCreated={(entityId) => {
                commitEntitySelection(entityId);
                onCreated?.(entityId);
              }}
              typeId={typeId}
            />
          }
          title={title}
        >
          {entities.length > 0 ? (
            <ScrollArea className="-mx-4 min-h-0 flex-1" data-entity-type-list-scroll={typeId}>
              <div className="grid min-w-0" data-entity-type-list={typeId}>
                {entities.map((entity) => (
                  <EntityListItem
                    active={entity.id === selectedEntityId}
                    className="min-h-16 rounded-none border-x-0 border-t-0 px-4 py-4 [&_svg]:shrink-0"
                    entity={entity}
                    key={entity.id}
                    onSelect={() => commitEntitySelection(entity.id)}
                    props={{ "data-entity-type-list-item": entity.id }}
                    store={runtime.store}
                    typeEntry={typeEntry}
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <EmptyState>No records are available yet.</EmptyState>
          )}
        </Section>

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
  );
}

export function EntityTypeBrowser({ title, typeId }: { title: string; typeId: string }) {
  const runtime = useGraphRuntime();
  return <EntityTypeBrowserSurface runtime={runtime} title={title} typeId={typeId} />;
}
