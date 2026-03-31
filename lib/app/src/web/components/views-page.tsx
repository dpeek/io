"use client";

import { getPredicateDisplayKind, getPredicateEditorKind } from "@io/graph-react";
import { PredicateFieldEditor, PredicateFieldView } from "@io/graph-module-core/react-dom";
import { Button } from "@io/web/button";
import { Card, CardContent, CardHeader, CardTitle } from "@io/web/card";
import { useState } from "react";

import { viewsFamilies, type ViewsExample } from "./views-catalog.js";

function ViewsFamilyList({
  onSelect,
  selectedFamilyId,
}: {
  readonly onSelect: (familyId: string) => void;
  readonly selectedFamilyId: string;
}) {
  return (
    <div className="grid gap-2">
      {viewsFamilies.map((family) => (
        <Button
          className="justify-start"
          key={family.id}
          onClick={() => {
            onSelect(family.id);
          }}
          type="button"
          variant={family.id === selectedFamilyId ? "default" : "ghost"}
        >
          {family.label}
        </Button>
      ))}
    </div>
  );
}

function ViewsExampleSurface({ example }: { readonly example: ViewsExample }) {
  const [predicate] = useState(() => example.createPredicate());
  const displayKind = getPredicateDisplayKind(predicate.field) ?? "missing";
  const editorKind = getPredicateEditorKind(predicate.field) ?? "missing";

  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">{example.label}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2 lg:grid-cols-[10rem_minmax(0,1fr)] lg:items-start">
          <div className="text-muted-foreground text-sm font-medium">Display kind</div>
          <div className="font-mono text-sm">{displayKind}</div>
        </div>
        <div className="grid gap-2 lg:grid-cols-[10rem_minmax(0,1fr)] lg:items-start">
          <div className="text-muted-foreground text-sm font-medium">Display example</div>
          <div className="border-border/70 bg-muted/20 min-h-16 rounded-xl border px-4 py-3">
            <PredicateFieldView predicate={predicate} />
          </div>
        </div>
        <div className="grid gap-2 lg:grid-cols-[10rem_minmax(0,1fr)] lg:items-start">
          <div className="text-muted-foreground text-sm font-medium">Editor kind</div>
          <div className="font-mono text-sm">{editorKind}</div>
        </div>
        <div className="grid gap-2 lg:grid-cols-[10rem_minmax(0,1fr)] lg:items-start">
          <div className="text-muted-foreground text-sm font-medium">Editor example</div>
          <div className="border-border/70 bg-background min-h-16 rounded-xl border px-4 py-3">
            <PredicateFieldEditor predicate={predicate} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ViewsExampleCard({ example }: { readonly example: ViewsExample }) {
  const [resetVersion, setResetVersion] = useState(0);

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setResetVersion((current) => current + 1);
          }}
          type="button"
          variant="outline"
        >
          Reset
        </Button>
      </div>
      <ViewsExampleSurface example={example} key={resetVersion} />
    </div>
  );
}

export function ViewsPage() {
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>(viewsFamilies[0]?.id ?? "");
  const selectedFamily =
    viewsFamilies.find((family) => family.id === selectedFamilyId) ?? viewsFamilies[0];

  if (!selectedFamily) {
    return null;
  }

  return (
    <div className="grid min-h-0 flex-1 gap-6 overflow-hidden lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="overflow-y-auto pr-1">
        <ViewsFamilyList onSelect={setSelectedFamilyId} selectedFamilyId={selectedFamily.id} />
      </aside>
      <section className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        <h1 className="text-3xl font-semibold tracking-tight">{selectedFamily.label}</h1>
        <div className="flex flex-col gap-4">
          {selectedFamily.examples.map((example) => (
            <ViewsExampleCard example={example} key={example.id} />
          ))}
        </div>
      </section>
    </div>
  );
}
