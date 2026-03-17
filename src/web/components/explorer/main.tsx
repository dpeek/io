import { typeId } from "@io/core/graph";
import { GraphMutationRuntimeProvider } from "@io/core/graph/react";
import { app } from "@io/core/graph/schema/app";
import { Input } from "@io/web/input";
import { ScrollArea } from "@io/web/scroll-area";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { useGraphRuntime } from "../graph-runtime-bootstrap.js";
import { buildEntityCatalog, buildPredicateCatalog, buildTypeCatalog } from "./catalog.js";
import { buildCreatePlan, GenericCreateInspector } from "./create-draft.js";
import { EntityInspector, EntityListItem } from "./entities.js";
import {
  getEntityLabel,
  getNodeName,
  getUntitledEntityLabel,
  matchesQuery,
  postSecretFieldMutation,
} from "./helpers.js";
import { newTarget, predicateTypeId, schemaTarget, typePredicateId } from "./model.js";
import type { ExplorerRuntime, ExplorerSelection, SubmitSecretFieldMutation } from "./model.js";
import {
  buildExplorerHref,
  isNewTarget,
  isSchemaTarget,
  pushExplorerUrl,
  readExplorerSearchParams,
  readExplorerSelectionFromSearchParams,
  replaceExplorerUrl,
} from "./navigation.js";
import { PredicateInspector } from "./predicates.js";
import { ExplorerSyncContext, useExplorerSyncSnapshot } from "./sync.js";
import { TypeInspector, TypeListItem } from "./types-panel.js";
import { Badge, EmptyState, ListButton, Section } from "./ui.js";

function selectionsEqual(left: ExplorerSelection, right: ExplorerSelection): boolean {
  return left.typeId === right.typeId && left.target === right.target;
}

export function Explorer({
  runtime,
  submitSecretField = postSecretFieldMutation,
  showSyncInspector: _showSyncInspector = true,
}: {
  runtime?: ExplorerRuntime;
  submitSecretField?: SubmitSecretFieldMutation;
  showSyncInspector?: boolean;
}) {
  const graphRuntime = runtime ?? useGraphRuntime();
  const client = graphRuntime.graph;
  const syncSnapshot = useExplorerSyncSnapshot(graphRuntime.sync);

  const typeEntries = useMemo(
    () => buildTypeCatalog(graphRuntime.store),
    [graphRuntime.store, syncSnapshot],
  );
  const entityEntries = useMemo(
    () => buildEntityCatalog(client, graphRuntime.store),
    [client, graphRuntime.store, syncSnapshot],
  );
  const predicateEntries = useMemo(
    () => buildPredicateCatalog(client, typeEntries),
    [client, typeEntries],
  );
  const typeEntryById = useMemo(
    () => new Map(typeEntries.map((entry) => [entry.id, entry])),
    [typeEntries],
  );
  const entityEntryById = useMemo(
    () => new Map(entityEntries.map((entry) => [entry.id, entry])),
    [entityEntries],
  );
  const predicateEntryById = useMemo(
    () => new Map(predicateEntries.map((entry) => [entry.id, entry])),
    [predicateEntries],
  );
  const typeKeyById = useMemo(
    () => new Map(typeEntries.map((entry) => [entry.id, entry.key])),
    [typeEntries],
  );
  const createPlanByTypeId = useMemo(
    () => new Map(entityEntries.map((entry) => [entry.id, buildCreatePlan(entry)])),
    [entityEntries],
  );

  const initialSearchParams = readExplorerSearchParams();
  const defaultTypeId =
    typeEntryById.get(typeId(app.topic))?.id ?? typeEntries[0]?.id ?? typeId(app.topic);

  function canCreateType(typeIdValue: string): boolean {
    return createPlanByTypeId.get(typeIdValue)?.supported ?? false;
  }

  function normalizeSelection(nextSelection: ExplorerSelection): ExplorerSelection {
    const nextTypeId = typeEntryById.get(nextSelection.typeId)?.id ?? defaultTypeId;
    const nextTypeEntry = typeEntryById.get(nextTypeId);

    if (!nextTypeEntry) {
      return { target: schemaTarget, typeId: defaultTypeId };
    }
    if (nextTypeEntry.kind !== "entity") {
      return { target: schemaTarget, typeId: nextTypeEntry.id };
    }

    const nextEntityEntry = entityEntryById.get(nextTypeEntry.id);
    if (!nextEntityEntry) {
      return { target: schemaTarget, typeId: nextTypeEntry.id };
    }
    if (isSchemaTarget(nextSelection.target)) {
      return { target: schemaTarget, typeId: nextTypeEntry.id };
    }
    if (isNewTarget(nextSelection.target)) {
      return canCreateType(nextTypeEntry.id)
        ? { target: newTarget, typeId: nextTypeEntry.id }
        : { target: schemaTarget, typeId: nextTypeEntry.id };
    }
    if (nextEntityEntry.ids.includes(nextSelection.target)) {
      return { target: nextSelection.target, typeId: nextTypeEntry.id };
    }
    if (
      graphRuntime.store.facts(nextSelection.target, typePredicateId, nextTypeEntry.id).length > 0
    ) {
      return { target: nextSelection.target, typeId: nextTypeEntry.id };
    }

    return {
      target: nextEntityEntry.ids[0] ?? schemaTarget,
      typeId: nextTypeEntry.id,
    };
  }

  const [selection, setSelection] = useState<ExplorerSelection>(() =>
    normalizeSelection(readExplorerSelectionFromSearchParams(initialSearchParams)),
  );

  const resolvedSelection = useMemo(
    () => normalizeSelection(selection),
    [selection, typeEntryById, entityEntryById],
  );

  const [typeQuery, setTypeQuery] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const deferredTypeQuery = useDeferredValue(typeQuery.trim().toLowerCase());
  const deferredTargetQuery = useDeferredValue(targetQuery.trim().toLowerCase());

  const visibleTypes = useMemo(
    () =>
      typeEntries.filter((entry) =>
        matchesQuery(deferredTypeQuery, entry.key, entry.name, entry.kind),
      ),
    [deferredTypeQuery, typeEntries],
  );

  const selectedTypeEntry = typeEntryById.get(resolvedSelection.typeId) ?? null;
  const selectedEntityType =
    selectedTypeEntry?.kind === "entity"
      ? (entityEntryById.get(selectedTypeEntry.id) ?? null)
      : null;
  const visibleEntityIds = useMemo(() => {
    if (!selectedEntityType) return [];
    return selectedEntityType.ids.filter((id) =>
      matchesQuery(
        deferredTargetQuery,
        id,
        getEntityLabel(
          selectedEntityType.getRef(id),
          getUntitledEntityLabel(selectedEntityType.name),
        ),
        getNodeName(graphRuntime.store, id),
      ),
    );
  }, [deferredTargetQuery, graphRuntime.store, selectedEntityType]);
  const selectedEntity =
    selectedEntityType &&
    !isSchemaTarget(resolvedSelection.target) &&
    !isNewTarget(resolvedSelection.target)
      ? selectedEntityType.getRef(resolvedSelection.target)
      : null;
  const selectedPredicateEntry =
    resolvedSelection.typeId === predicateTypeId &&
    !isSchemaTarget(resolvedSelection.target) &&
    !isNewTarget(resolvedSelection.target)
      ? (predicateEntryById.get(resolvedSelection.target) ?? null)
      : null;
  const canCreateSelectedType =
    selectedTypeEntry?.kind === "entity" && canCreateType(selectedTypeEntry.id);

  useEffect(() => {
    if (!selectionsEqual(selection, resolvedSelection)) {
      setSelection(resolvedSelection);
    }
  }, [resolvedSelection, selection]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function handlePopState(): void {
      const nextSelection = normalizeSelection(
        readExplorerSelectionFromSearchParams(readExplorerSearchParams()),
      );
      setSelection((current) =>
        selectionsEqual(current, nextSelection) ? current : nextSelection,
      );
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [entityEntryById, typeEntryById]);

  useEffect(() => {
    replaceExplorerUrl(buildExplorerHref(resolvedSelection));
  }, [resolvedSelection]);

  useEffect(() => {
    if (visibleTypes.length === 0) return;
    if (visibleTypes.some((entry) => entry.id === resolvedSelection.typeId)) return;

    const nextSelection = normalizeSelection({
      target: schemaTarget,
      typeId: visibleTypes[0]!.id,
    });
    setSelection((current) => (selectionsEqual(current, nextSelection) ? current : nextSelection));
  }, [normalizeSelection, resolvedSelection.typeId, visibleTypes]);

  useEffect(() => {
    if (!selectedEntityType) return;
    if (isSchemaTarget(resolvedSelection.target) || isNewTarget(resolvedSelection.target)) return;
    if (visibleEntityIds.includes(resolvedSelection.target)) return;

    const nextSelection = normalizeSelection({
      target: visibleEntityIds[0] ?? schemaTarget,
      typeId: resolvedSelection.typeId,
    });
    setSelection((current) => (selectionsEqual(current, nextSelection) ? current : nextSelection));
  }, [
    normalizeSelection,
    resolvedSelection.target,
    resolvedSelection.typeId,
    selectedEntityType,
    visibleEntityIds,
  ]);

  function commitSelection(nextSelection: ExplorerSelection): void {
    const normalizedSelection = normalizeSelection(nextSelection);
    setSelection(normalizedSelection);
    pushExplorerUrl(buildExplorerHref(normalizedSelection));
  }

  function selectType(typeIdValue: string): void {
    commitSelection({ target: schemaTarget, typeId: typeIdValue });
  }

  function selectTarget(targetValue: string): void {
    if (!selectedTypeEntry) return;
    commitSelection({ target: targetValue, typeId: selectedTypeEntry.id });
  }

  function openType(typeIdValue: string): void {
    commitSelection({ target: schemaTarget, typeId: typeIdValue });
  }

  function openPredicate(predicateIdValue: string): void {
    commitSelection({ target: predicateIdValue, typeId: predicateTypeId });
  }

  function handleEntityCreated(entityId: string): void {
    setTargetQuery("");
    commitSelection({ target: entityId, typeId: resolvedSelection.typeId });
  }

  const inspectorPanel = (() => {
    if (isSchemaTarget(resolvedSelection.target)) {
      return selectedTypeEntry ? (
        <TypeInspector
          client={client}
          entry={selectedTypeEntry}
          onOpenPredicate={openPredicate}
          store={graphRuntime.store}
          typeKeyById={typeKeyById}
        />
      ) : null;
    }

    if (isNewTarget(resolvedSelection.target)) {
      return selectedEntityType ? (
        <GenericCreateInspector
          onCancelCreate={() => selectTarget(schemaTarget)}
          onCreated={handleEntityCreated}
          entityEntry={selectedEntityType}
          entityEntryById={entityEntryById}
          runtime={graphRuntime}
        />
      ) : (
        <EmptyState>Create flow is not available for this type yet.</EmptyState>
      );
    }

    if (selectedPredicateEntry) {
      return (
        <PredicateInspector
          client={client}
          entry={selectedPredicateEntry}
          onOpenType={openType}
          store={graphRuntime.store}
          typeEntries={typeEntries}
        />
      );
    }

    if (selectedEntity && selectedEntityType) {
      return (
        <EntityInspector
          entity={selectedEntity}
          runtime={graphRuntime}
          submitSecretField={submitSecretField}
          store={graphRuntime.store}
          typeEntry={selectedEntityType}
        />
      );
    }

    return <EmptyState>Select a schema row or record to inspect it.</EmptyState>;
  })();

  return (
    <ExplorerSyncContext.Provider value={graphRuntime.sync}>
      <GraphMutationRuntimeProvider runtime={{ graph: client, sync: graphRuntime.sync }}>
        <div className="graph-explorer text-foreground flex min-h-0 flex-1 flex-col gap-4 xl:overflow-hidden">
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[280px_340px_minmax(0,1fr)] xl:overflow-hidden">
            <div className="flex min-h-0 flex-col gap-4">
              <div className="min-h-0 flex-1">
                <Section
                  title="Types"
                  right={
                    <Badge className="border-border bg-muted/30 text-muted-foreground">
                      {visibleTypes.length}
                    </Badge>
                  }
                >
                  <Input
                    onChange={(event) => setTypeQuery(event.target.value)}
                    placeholder="Filter by key, name, or kind"
                    value={typeQuery}
                  />
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="grid gap-2 pr-3">
                      {visibleTypes.length > 0 ? (
                        visibleTypes.map((entry) => (
                          <TypeListItem
                            active={entry.id === resolvedSelection.typeId}
                            entry={entry}
                            key={entry.id}
                            onSelect={() => selectType(entry.id)}
                            store={graphRuntime.store}
                          />
                        ))
                      ) : (
                        <EmptyState>No types match the current filter.</EmptyState>
                      )}
                    </div>
                  </ScrollArea>
                </Section>
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-4">
              <div className="min-h-0 flex-1">
                <Section
                  title={selectedTypeEntry ? `${selectedTypeEntry.name} Targets` : "Targets"}
                  right={
                    <div className="flex items-center gap-2">
                      {selectedTypeEntry?.kind === "entity" ? (
                        <Badge className="border-border bg-muted/30 text-muted-foreground">
                          {visibleEntityIds.length}
                        </Badge>
                      ) : null}
                    </div>
                  }
                >
                  {selectedTypeEntry?.kind === "entity" ? (
                    <Input
                      onChange={(event) => setTargetQuery(event.target.value)}
                      placeholder="Filter by id or name"
                      value={targetQuery}
                    />
                  ) : null}
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="grid gap-2 pr-3">
                      <ListButton
                        active={isSchemaTarget(resolvedSelection.target)}
                        onClick={() => selectTarget(schemaTarget)}
                        props={{ "data-explorer-target": schemaTarget }}
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-medium">Schema</div>
                          <div className="text-muted-foreground text-xs">
                            Edit graph metadata and inspect the compiled definition for this type.
                          </div>
                        </div>
                      </ListButton>

                      {canCreateSelectedType ? (
                        <ListButton
                          active={isNewTarget(resolvedSelection.target)}
                          onClick={() => selectTarget(newTarget)}
                          props={{ "data-explorer-target": newTarget }}
                        >
                          <div className="space-y-1">
                            <div className="text-sm font-medium">
                              New {selectedTypeEntry?.name ?? "Record"}
                            </div>
                            <div className="text-muted-foreground text-xs">
                              Create metadata first, then keep editing through the normal entity
                              surface.
                            </div>
                          </div>
                        </ListButton>
                      ) : null}

                      {selectedEntityType ? (
                        visibleEntityIds.length > 0 ? (
                          visibleEntityIds.map((id) => (
                            <EntityListItem
                              active={id === resolvedSelection.target}
                              entity={selectedEntityType.getRef(id)}
                              key={id}
                              onSelect={() => selectTarget(id)}
                              store={graphRuntime.store}
                              typeEntry={selectedEntityType}
                            />
                          ))
                        ) : (
                          <EmptyState>No nodes match the current filter.</EmptyState>
                        )
                      ) : null}
                    </div>
                  </ScrollArea>
                </Section>
              </div>
            </div>

            <ScrollArea className="min-h-0 pr-1 xl:h-full">
              <div className="space-y-4 pr-3">{inspectorPanel}</div>
            </ScrollArea>
          </div>
        </div>
      </GraphMutationRuntimeProvider>
    </ExplorerSyncContext.Provider>
  );
}
