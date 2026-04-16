"use client";

import type { ComponentProps } from "react";
import { useState } from "react";

import { Button } from "@dpeek/graphle-web-ui/button";

import type {
  CollectionCommandExecutionResult,
  CollectionCommandExecutionSubject,
  ResolvedCollectionCommandBinding,
} from "../collection-command-surface.js";

export function CollectionCommandButtons({
  className,
  commands,
  onExecuted,
  scope,
  size = "sm",
  subject,
  variant = "outline",
}: {
  readonly className?: string;
  readonly commands: readonly ResolvedCollectionCommandBinding[];
  readonly onExecuted?: (
    binding: ResolvedCollectionCommandBinding,
    result: CollectionCommandExecutionResult | void,
    subject: CollectionCommandExecutionSubject,
  ) => void | Promise<void>;
  readonly scope: "entity" | "selection";
  readonly size?: ComponentProps<typeof Button>["size"];
  readonly subject: CollectionCommandExecutionSubject | null;
  readonly variant?: ComponentProps<typeof Button>["variant"];
}) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  if (!subject || commands.length === 0) {
    return null;
  }
  const resolvedSubject = subject;

  async function execute(binding: ResolvedCollectionCommandBinding): Promise<void> {
    if (pendingKey !== null) {
      return;
    }
    setPendingKey(binding.key);
    try {
      const result = await binding.execute(resolvedSubject);
      await onExecuted?.(binding, result, resolvedSubject);
      setConfirmKey((current) => (current === binding.key ? null : current));
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div
      className={className ?? "flex flex-wrap gap-2"}
      data-collection-command-actions={scope}
      data-collection-command-count={commands.length}
    >
      {commands.map((binding) => {
        const isPending = pendingKey === binding.key;
        const label = isPending ? "Working..." : binding.label;

        if (binding.surface.submitBehavior.kind !== "confirm") {
          return (
            <Button
              className={className}
              data-collection-command-entity={
                resolvedSubject.kind === "entity" ? resolvedSubject.entityId : undefined
              }
              data-collection-command-scope={scope}
              data-collection-command-selection-count={
                resolvedSubject.kind === "selection" ? resolvedSubject.entityIds.length : undefined
              }
              data-collection-command-trigger={binding.key}
              disabled={pendingKey !== null}
              key={binding.key}
              onClick={() => {
                void execute(binding);
              }}
              size={size}
              type="button"
              variant={variant}
            >
              {label}
            </Button>
          );
        }

        return (
          <div
            className="flex flex-wrap items-center gap-2"
            data-collection-command-confirm={binding.key}
            key={binding.key}
          >
            <Button
              data-collection-command-entity={
                resolvedSubject.kind === "entity" ? resolvedSubject.entityId : undefined
              }
              data-collection-command-scope={scope}
              data-collection-command-selection-count={
                resolvedSubject.kind === "selection" ? resolvedSubject.entityIds.length : undefined
              }
              data-collection-command-trigger={binding.key}
              disabled={pendingKey !== null}
              onClick={() => {
                setConfirmKey(binding.key);
              }}
              size={size}
              type="button"
              variant={variant}
            >
              {label}
            </Button>
            {confirmKey === binding.key ? (
              <div
                className="border-border/70 bg-background/90 flex flex-wrap items-center gap-2 rounded-md border px-2 py-1"
                data-collection-command-confirm-panel={binding.key}
              >
                <span className="text-muted-foreground text-[11px]">
                  {binding.surface.submitBehavior.title ?? binding.label}
                </span>
                <Button
                  disabled={pendingKey !== null}
                  onClick={() => {
                    setConfirmKey(null);
                  }}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  data-collection-command-confirm-action={binding.key}
                  disabled={pendingKey !== null}
                  onClick={() => {
                    void execute(binding);
                  }}
                  size="xs"
                  type="button"
                  variant="default"
                >
                  {binding.surface.submitBehavior.confirmLabel ?? binding.label}
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
