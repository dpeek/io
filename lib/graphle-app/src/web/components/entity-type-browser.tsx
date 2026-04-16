"use client";

import { GraphIcon } from "@dpeek/graphle-module-core/react-dom";
import { Button } from "@dpeek/graphle-web-ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@dpeek/graphle-web-ui/card";
import { Empty, EmptyDescription } from "@dpeek/graphle-web-ui/empty";
import { ScrollArea } from "@dpeek/graphle-web-ui/scroll-area";
import { cn } from "@dpeek/graphle-web-ui/utils";
import { useEffect, useMemo, useState } from "react";

import { EntityCreateButton, EntityCreateRuntimeProvider } from "./entity-create-button.js";
import { EntitySurface, resolveEntityPreviewIconId } from "./entity-surface.js";
import { buildEntityCatalog } from "./explorer/catalog.js";
import { usePredicateSlotValue } from "./explorer/field-editor.js";
import {
  getEntityLabel,
  getUntitledEntityLabel,
  postSecretFieldMutation,
} from "./explorer/helpers.js";
import type {
  AnyEntityRef,
  EntityCatalogEntry,
  ExplorerRuntime,
  SubmitSecretFieldMutation,
} from "./explorer/model.js";
import { typePredicateId } from "./explorer/model.js";
import { useExplorerSyncSnapshot } from "./explorer/sync.js";
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

function EntityListItem({
  active,
  className,
  entity,
  onSelect,
  props,
  store,
  typeEntry,
}: {
  active: boolean;
  className?: string;
  entity: AnyEntityRef;
  onSelect: () => void;
  props?: Record<string, string>;
  store: ExplorerRuntime["store"];
  typeEntry: EntityCatalogEntry;
}) {
  const iconSlotValue = usePredicateSlotValue(
    store,
    entity.id,
    typeEntry.iconPredicateId ?? typePredicateId,
  );
  const iconId = resolveEntityPreviewIconId(entity.id, iconSlotValue, typeEntry);
  const title = getEntityLabel(entity, getUntitledEntityLabel(typeEntry.name));

  return (
    <Button
      {...props}
      className={cn(
        "h-auto w-full justify-start rounded-xl border px-3 py-3 text-left text-sm",
        active
          ? "border-primary/20 bg-secondary text-foreground"
          : "border-border/60 bg-background text-foreground hover:bg-muted",
        className,
      )}
      data-explorer-item-entity={entity.id}
      onClick={onSelect}
      type="button"
      variant="ghost"
    >
      <div className="flex items-start gap-3">
        {typeof iconId === "string" && iconId.length > 0 ? (
          <GraphIcon className="text-muted-foreground size-8" iconId={iconId} />
        ) : null}
        <div className="space-y-1">
          <div className="text-sm font-medium">{title}</div>
        </div>
      </div>
    </Button>
  );
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
        <Card data-entity-type-browser={typeId}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardAction>
              <EntityCreateButton
                onCreated={(entityId) => {
                  commitEntitySelection(entityId);
                  onCreated?.(entityId);
                }}
                typeId={typeId}
              />
            </CardAction>
          </CardHeader>
          <CardContent>
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
              <Empty className="border-border bg-muted/20 flex-none p-4">
                <EmptyDescription className="text-sm">
                  No records are available yet.
                </EmptyDescription>
              </Empty>
            )}
          </CardContent>
        </Card>

        <div className="min-h-0">
          {selectedEntity ? (
            <EntitySurface
              defaultMode="edit"
              entity={selectedEntity}
              runtime={runtime}
              submitSecretField={submitSecretField}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Detail</CardTitle>
              </CardHeader>
              <CardContent>
                <Empty className="border-border bg-muted/20 flex-none p-4">
                  <EmptyDescription className="text-sm">
                    Select a record to open its field editor.
                  </EmptyDescription>
                </Empty>
              </CardContent>
            </Card>
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
