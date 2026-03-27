import { typeId } from "@io/core/graph";
import { workflow } from "@io/core/graph/modules/workflow";
import { Input } from "@io/web/input";
import { ScrollArea } from "@io/web/scroll-area";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { EntityTypeBrowserSurface } from "../entity-type-browser.js";
import { GraphRuntimeProvider, useGraphRuntime } from "../graph-runtime-bootstrap.js";
import { buildEntityCatalog, buildTypeCatalog } from "./catalog.js";
import { matchesQuery, postSecretFieldMutation } from "./helpers.js";
import { predicateTypeId, schemaTarget, typePredicateId } from "./model.js";
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
  const typeEntryById = useMemo(
    () => new Map(typeEntries.map((entry) => [entry.id, entry])),
    [typeEntries],
  );
  const entityEntryById = useMemo(
    () => new Map(entityEntries.map((entry) => [entry.id, entry])),
    [entityEntries],
  );
  const typeKeyById = useMemo(
    () => new Map(typeEntries.map((entry) => [entry.id, entry.key])),
    [typeEntries],
  );

  const initialSearchParams = readExplorerSearchParams();
  const defaultTypeId =
    typeEntryById.get(typeId(workflow.document))?.id ??
    typeEntries[0]?.id ??
    typeId(workflow.document);

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
      return {
        target: nextEntityEntry.ids[0] ?? schemaTarget,
        typeId: nextTypeEntry.id,
      };
    }
    if (isNewTarget(nextSelection.target)) {
      return {
        target: nextEntityEntry.ids[0] ?? schemaTarget,
        typeId: nextTypeEntry.id,
      };
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
  const deferredTypeQuery = useDeferredValue(typeQuery.trim().toLowerCase());

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

  function openPredicate(predicateIdValue: string): void {
    commitSelection({ target: predicateIdValue, typeId: predicateTypeId });
  }

  function handleEntityCreated(entityId: string): void {
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

    return <EmptyState>Select a type to inspect it.</EmptyState>;
  })();

  return (
    <ExplorerSyncContext.Provider value={graphRuntime.sync}>
      <GraphRuntimeProvider runtime={graphRuntime}>
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

            {selectedEntityType ? (
              <div className="min-h-0 xl:col-span-2">
                <EntityTypeBrowserSurface
                  onCreated={handleEntityCreated}
                  onSelectEntity={selectTarget}
                  runtime={graphRuntime}
                  selectedEntityId={resolvedSelection.target}
                  submitSecretField={submitSecretField}
                  title={selectedTypeEntry ? `${selectedTypeEntry.name} Targets` : "Targets"}
                  typeId={selectedEntityType.id}
                />
              </div>
            ) : (
              <>
                <div className="flex min-h-0 flex-col gap-4">
                  <div className="min-h-0 flex-1">
                    <Section
                      title={selectedTypeEntry ? `${selectedTypeEntry.name} Targets` : "Targets"}
                    >
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
                                Edit graph metadata and inspect the compiled definition for this
                                type.
                              </div>
                            </div>
                          </ListButton>
                        </div>
                      </ScrollArea>
                    </Section>
                  </div>
                </div>

                <ScrollArea className="min-h-0 pr-1 xl:h-full">
                  <div className="space-y-4 pr-3">{inspectorPanel}</div>
                </ScrollArea>
              </>
            )}
          </div>
        </div>
      </GraphRuntimeProvider>
    </ExplorerSyncContext.Provider>
  );
}
