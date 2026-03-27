"use client";

import { Button } from "@io/web/button";
import { Dialog, DialogContent, DialogTrigger } from "@io/web/dialog";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { buildEntityCatalog } from "./explorer/catalog.js";
import { GenericCreateInspector } from "./explorer/create-draft.js";
import type { EntityCatalogEntry, ExplorerRuntime } from "./explorer/model.js";
import { useExplorerSyncSnapshot } from "./explorer/sync.js";
import { useOptionalGraphRuntime } from "./graph-runtime-bootstrap.js";

const EntityCreateRuntimeContext = createContext<ExplorerRuntime | null>(null);

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

function useEntityCreateRuntime(): ExplorerRuntime {
  const contextRuntime = useContext(EntityCreateRuntimeContext);
  const graphRuntime = useOptionalGraphRuntime();
  const runtime = contextRuntime ?? graphRuntime;

  if (!runtime) {
    throw new Error("EntityCreateButton requires a graph runtime provider.");
  }

  return runtime;
}

export function EntityCreateRuntimeProvider({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: ExplorerRuntime;
}) {
  return (
    <EntityCreateRuntimeContext.Provider value={runtime}>
      {children}
    </EntityCreateRuntimeContext.Provider>
  );
}

export function EntityCreateButton({
  className,
  onCreated,
  size = "sm",
  typeId,
  variant = "default",
}: {
  className?: string;
  onCreated?: (entityId: string) => void;
  size?: ComponentProps<typeof Button>["size"];
  typeId: string;
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  const runtime = useEntityCreateRuntime();
  const syncSnapshot = useExplorerSyncSnapshot(runtime.sync);
  const entityEntries = useMemo(
    () => buildEntityCatalog(runtime.graph, runtime.store),
    [runtime.graph, runtime.store, syncSnapshot],
  );
  const entityEntryById = useMemo(
    () => new Map(entityEntries.map((entry) => [entry.id, entry])),
    [entityEntries],
  );
  const entityEntry = useMemo(
    () => resolveEntityTypeEntry(entityEntryById, typeId),
    [entityEntryById, typeId],
  );
  const [open, setOpen] = useState(false);
  const [createSession, setCreateSession] = useState(0);
  const createLabel = `Create ${entityEntry.name}`;

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen);
    if (nextOpen) {
      setCreateSession((current) => current + 1);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            className={className}
            data-entity-create-button={typeId}
            size={size}
            type="button"
            variant={variant}
          >
            {createLabel}
          </Button>
        )}
      />
      <DialogContent
        className="top-4 left-1/2 flex max-h-[calc(100svh-2rem)] w-full max-w-5xl -translate-x-1/2 translate-y-0 flex-col overflow-hidden p-0 sm:max-w-5xl"
        showCloseButton={false}
      >
        <GenericCreateInspector
          entityEntry={entityEntry}
          entityEntryById={entityEntryById}
          key={`${entityEntry.id}:${createSession}`}
          onCreated={(entityId) => {
            setOpen(false);
            onCreated?.(entityId);
          }}
          runtime={runtime}
        />
      </DialogContent>
    </Dialog>
  );
}
