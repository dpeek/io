import { typeId } from "@io/app/graph";
import { GraphValidationError } from "@io/graph-client";
import { Button } from "@io/web/button";
import { DialogClose, DialogFooter, DialogHeader, DialogTitle } from "@io/web/dialog";
import { XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { buildDraftEntitySurfacePlan } from "./entity-surface-plan.js";
import { buildEntitySurfaceFieldRows } from "./entity-surface.js";
import { createEntityDraftController } from "./explorer/create-draft-controller.js";
import { buildCreateDefaults, buildCreatePlan } from "./explorer/create-draft-plan.js";
import { collectValidationMessages, collectValidationMessagesByPath } from "./explorer/helpers.js";
import { explorerNamespace } from "./explorer/model.js";
import type {
  EntityCatalogEntry,
  ExplorerRuntime,
  FieldValidationMessage,
} from "./explorer/model.js";
import { describeSyncError } from "./explorer/sync.js";
import { EmptyState } from "./explorer/ui.js";
import { InspectorFieldSection } from "./inspector.js";

function ValidationSummary({ message }: { message: string }) {
  if (!message) {
    return null;
  }

  return (
    <div
      className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100"
      data-explorer-create-error="true"
    >
      {message}
    </div>
  );
}

export function CreateEntitySurface({
  entityEntry,
  entityEntryById,
  onCreated,
  runtime,
}: {
  entityEntry: EntityCatalogEntry;
  entityEntryById: ReadonlyMap<string, EntityCatalogEntry>;
  onCreated: (entityId: string) => void;
  runtime: ExplorerRuntime;
}) {
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitValidationMessagesByPath, setSubmitValidationMessagesByPath] = useState<
    ReadonlyMap<string, readonly FieldValidationMessage[]>
  >(new Map());
  const entityEntryRef = useRef(entityEntry);
  const entityEntryByIdRef = useRef(entityEntryById);

  useEffect(() => {
    entityEntryRef.current = entityEntry;
  }, [entityEntry]);

  useEffect(() => {
    entityEntryByIdRef.current = entityEntryById;
  }, [entityEntryById]);

  const typeById = useMemo(
    () => new Map(Object.values(explorerNamespace).map((typeDef) => [typeId(typeDef), typeDef])),
    [],
  );
  const createPlan = useMemo(() => buildCreatePlan(entityEntry), [entityEntry]);
  const controller = useMemo(
    () =>
      createEntityDraftController({
        entry: entityEntry,
        entityEntryByIdRef,
        initialInput: buildCreateDefaults(entityEntry, typeById),
        store: runtime.store,
        typeById,
      }),
    [entityEntry, runtime.store, typeById],
  );
  const surfacePlan = useMemo(
    () =>
      buildDraftEntitySurfacePlan(
        controller.fields,
        createPlan.clientFields.map((field) => field.pathLabel),
        { mode: "edit" },
      ),
    [controller.fields, createPlan.clientFields],
  );
  const fieldRows = useMemo(
    () => buildEntitySurfaceFieldRows(surfacePlan.rows),
    [surfacePlan.rows],
  );
  const visibleFieldPaths = useMemo(
    () => new Set(fieldRows.map((row) => row.pathLabel)),
    [fieldRows],
  );
  const createLabel = `Create ${entityEntry.name}`;

  async function handleCreate(): Promise<void> {
    const currentEntry = entityEntryRef.current;
    const input = controller.session.getSnapshot().draftValue;
    const validation = currentEntry.validateCreate(input as never);

    if (!validation.ok) {
      const validationError = new GraphValidationError(validation);
      const fieldMessagesByPath = collectValidationMessagesByPath(validationError);
      const visibleFieldMessages = new Map<string, readonly FieldValidationMessage[]>();

      for (const [pathLabel, messages] of fieldMessagesByPath) {
        if (!visibleFieldPaths.has(pathLabel)) continue;
        visibleFieldMessages.set(pathLabel, messages);
      }

      setSubmitValidationMessagesByPath(visibleFieldMessages);

      const summaryMessages = collectValidationMessages(validationError).filter(
        (message) => !visibleFieldPaths.has(message.pathLabel),
      );
      setSubmitError(summaryMessages[0]?.message ?? "");
      return;
    }

    setBusy(true);
    setSubmitError("");
    setSubmitValidationMessagesByPath(new Map());

    try {
      const createdId = currentEntry.create(input as never);
      await runtime.sync.flush();
      onCreated(createdId);
    } catch (error) {
      setSubmitValidationMessagesByPath(new Map());
      setSubmitError(describeSyncError(error) ?? "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!createPlan.supported) {
    return (
      <div
        className="flex max-h-full min-h-0 flex-col"
        data-create-entity-surface={entityEntry.id}
        data-entity-surface="create"
      >
        <DialogHeader className="border-border/60 flex-row items-center justify-between gap-3 border-b px-4 py-3">
          <DialogTitle className="text-base font-semibold">{createLabel}</DialogTitle>
          <DialogClose
            render={
              <Button
                aria-label="Close create dialog"
                size="icon-sm"
                type="button"
                variant="ghost"
              />
            }
          >
            <XIcon />
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <EmptyState>
            This type requires fields that cannot be set in the generic create dialog.
          </EmptyState>
        </div>

        <DialogFooter className="border-border/60 border-t px-4 py-3">
          <Button data-explorer-create-submit={entityEntry.id} disabled type="button">
            {createLabel}
          </Button>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div
      className="flex max-h-full min-h-0 flex-col"
      data-create-entity-surface={entityEntry.id}
      data-entity-surface="create"
    >
      <DialogHeader className="border-border/60 flex-row items-center justify-between gap-3 border-b px-4 py-3">
        <DialogTitle className="text-base font-semibold">{createLabel}</DialogTitle>
        <DialogClose
          render={
            <Button aria-label="Close create dialog" size="icon-sm" type="button" variant="ghost" />
          }
        >
          <XIcon />
        </DialogClose>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          <InspectorFieldSection
            chrome={false}
            columns={1}
            emptyMessage="No client-writable fields."
            hideMissingStatus
            mode="edit"
            rows={fieldRows}
            validationMessagesByPath={submitValidationMessagesByPath}
          />
          <ValidationSummary message={submitError} />
        </div>
      </div>

      <DialogFooter className="border-border/60 border-t px-4 py-3">
        <Button
          data-explorer-create-submit={entityEntry.id}
          disabled={busy}
          onClick={() => {
            void handleCreate();
          }}
          type="button"
        >
          {busy ? "Creating..." : createLabel}
        </Button>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
      </DialogFooter>
    </div>
  );
}
