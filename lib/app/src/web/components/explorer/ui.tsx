import { Badge as UiBadge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { cn } from "@io/web/utils";
import { type ReactNode, useState } from "react";

import { checkToneClass } from "./helpers.js";

export function Section({
  children,
  description,
  right,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  title: string;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <Card className="border-border/70 bg-card/95 flex h-full min-h-0 flex-col border shadow-sm">
        <CardHeader className="border-border/60 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle>{title}</CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </div>
            {right ? <div className="shrink-0">{right}</div> : null}
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">{children}</CardContent>
      </Card>
    </section>
  );
}

export function Badge({
  children,
  className = "",
  data,
}: {
  children: ReactNode;
  className?: string;
  data?: Record<string, string>;
}) {
  return (
    <UiBadge
      {...data}
      variant="outline"
      className={cn("px-2 py-0.5 text-[11px] font-medium tracking-[0.16em] uppercase", className)}
    >
      {children}
    </UiBadge>
  );
}

export function ListButton({
  active,
  className,
  children,
  onClick,
  props,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
  onClick: () => void;
  props?: Record<string, string>;
}) {
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
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="border-border bg-muted/20 text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
      {children}
    </p>
  );
}

export function DebugDisclosure({
  children,
  panelId,
  summary = "Raw ids, keys, and compiled values stay hidden until you ask for them.",
  title = "Advanced Debug",
}: {
  children: ReactNode;
  panelId: string;
  summary?: ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-border/70 bg-card/70 space-y-3 rounded-2xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-muted-foreground text-sm">{summary}</div>
        </div>
        <Button
          data-explorer-debug-toggle={panelId}
          onClick={() => setOpen((current) => !current)}
          type="button"
          variant="outline"
        >
          {open ? "Hide debug" : "Show debug"}
        </Button>
      </div>

      {open ? (
        <div className="grid gap-3" data-explorer-debug-panel={panelId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DebugValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-border bg-muted/20 space-y-1 rounded-xl border p-3">
      <div className="text-muted-foreground text-[11px] font-medium tracking-[0.16em] uppercase">
        {label}
      </div>
      <code className="text-foreground block text-xs break-all">{value}</code>
    </div>
  );
}

export function DefinitionCheck({
  check,
  label,
  state,
}: {
  check: string;
  label: string;
  state: "aligned" | "drifted" | "missing";
}) {
  return (
    <div
      className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
      data-explorer-check={check}
      data-explorer-check-state={state}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-100">{label}</span>
        <Badge className={checkToneClass(state)}>{state}</Badge>
      </div>
    </div>
  );
}
