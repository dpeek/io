import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { createExampleRuntime } from "#graph";

type OutlineNode = {
  id: string;
  text: string;
  parentId?: string;
  order: number;
  depth: number;
  hasChildren: boolean;
};

type StoredOutlineNode = {
  id: string;
  text: string;
  parentId: string;
  order: number;
  collapsed: boolean;
};

const INVISIBLE_ROOT_ID = "outline:invisible-root";
const runtime = createExampleRuntime();
const { graph } = runtime;

function toStoredParentId(parentId?: string): string {
  return parentId ?? INVISIBLE_ROOT_ID;
}

function toApiParentId(parentId?: string): string | undefined {
  if (!parentId || parentId === INVISIBLE_ROOT_ID) return undefined;
  return parentId;
}

function typographyClass(depth: number, text: string): string {
  const compact = text.trim().length <= 48 && !/[.!?]/.test(text);
  if (depth === 0 && compact) return "text-2xl font-semibold tracking-tight";
  if (depth <= 1 && compact) return "text-xl font-semibold";
  if (depth <= 2) return "text-base font-medium";
  return "text-sm font-normal";
}

function snapshotNodes(): StoredOutlineNode[] {
  return graph.block
    .list()
    .map((node) => ({
      id: node.id,
      text: node.text,
      parentId: node.parent ?? INVISIBLE_ROOT_ID,
      order: Number(node.order),
      collapsed: Boolean(node.collapsed),
    }))
    .sort((a, b) => a.order - b.order);
}

function childrenByParent(nodes: StoredOutlineNode[]): Map<string | undefined, StoredOutlineNode[]> {
  const map = new Map<string | undefined, StoredOutlineNode[]>();
  for (const node of nodes) {
    const list = map.get(node.parentId) ?? [];
    list.push(node);
    map.set(node.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
}

function reindexParent(parentId: string | undefined): void {
  const siblings = snapshotNodes()
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order);
  siblings.forEach((node, index) => {
    if (node.order === index) return;
    graph.block.node(node.id).update({ order: index });
  });
}

function moveNode(nodeId: string, parentId: string | undefined, index: number): void {
  const nodes = snapshotNodes();
  const target = nodes.find((node) => node.id === nodeId);
  if (!target) throw new Error(`Node "${nodeId}" not found`);
  const resolvedParentId = toStoredParentId(parentId);
  const graphParentId = toApiParentId(resolvedParentId);

  const oldParentId = target.parentId;
  const currentSiblings = nodes
    .filter((node) => node.parentId === resolvedParentId && node.id !== nodeId)
    .sort((a, b) => a.order - b.order);
  const nextIndex = Math.max(0, Math.min(index, currentSiblings.length));
  currentSiblings.splice(nextIndex, 0, target);

  graph.block.node(nodeId).update({ parent: graphParentId, order: nextIndex });
  currentSiblings.forEach((node, siblingIndex) => {
    if (node.id === nodeId) {
      graph.block.node(node.id).update({ parent: graphParentId, order: siblingIndex });
      return;
    }
    if (node.parentId === resolvedParentId && node.order === siblingIndex) return;
    graph.block.node(node.id).update({ parent: graphParentId, order: siblingIndex });
  });

  if (oldParentId !== resolvedParentId) reindexParent(oldParentId);
}

function collectSubtreeIds(rootId: string): string[] {
  const nodes = snapshotNodes();
  const childMap = childrenByParent(nodes);
  const ids: string[] = [];
  function walk(nodeId: string): void {
    ids.push(nodeId);
    for (const child of childMap.get(nodeId) ?? []) walk(child.id);
  }
  walk(rootId);
  return ids;
}

function outdentWithSubsequentSiblings(nodeId: string): void {
  const nodes = snapshotNodes();
  const target = nodes.find((node) => node.id === nodeId);
  if (!target || !target.parentId || target.parentId === INVISIBLE_ROOT_ID) return;

  const parent = nodes.find((node) => node.id === target.parentId);
  if (!parent) return;
  const grandParentId = parent.parentId ?? INVISIBLE_ROOT_ID;

  const siblings = nodes
    .filter((node) => node.parentId === target.parentId)
    .sort((a, b) => a.order - b.order);
  const targetIndex = siblings.findIndex((node) => node.id === target.id);
  if (targetIndex < 0) return;
  const subsequentSiblingIds = siblings.slice(targetIndex + 1).map((node) => node.id);

  const parentSiblings = nodes
    .filter((node) => node.parentId === grandParentId)
    .sort((a, b) => a.order - b.order);
  const parentIndex = parentSiblings.findIndex((node) => node.id === parent.id);
  const outdentIndex = Math.max(0, parentIndex + 1);

  moveNode(target.id, toApiParentId(grandParentId), outdentIndex);

  const currentChildren = snapshotNodes()
    .filter((node) => node.parentId === target.id)
    .sort((a, b) => a.order - b.order);
  let insertIndex = currentChildren.length;
  for (const siblingId of subsequentSiblingIds) {
    moveNode(siblingId, target.id, insertIndex);
    insertIndex += 1;
  }
}

function flatOutline(): OutlineNode[] {
  const nodes = snapshotNodes();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childMap = childrenByParent(nodes);
  const roots = nodes
    .filter(
      (node) =>
        node.parentId === INVISIBLE_ROOT_ID ||
        !node.parentId ||
        (!byId.has(node.parentId) && node.parentId !== INVISIBLE_ROOT_ID),
    )
    .sort((a, b) => a.order - b.order);

  const out: OutlineNode[] = [];
  const visited = new Set<string>();

  function walk(node: StoredOutlineNode, depth: number): void {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const children = childMap.get(node.id) ?? [];
    out.push({
      id: node.id,
      text: node.text,
      parentId: toApiParentId(node.parentId),
      order: node.order,
      depth,
      hasChildren: children.length > 0,
    });
    for (const child of children) walk(child, depth + 1);
  }

  for (const root of roots) walk(root, 0);
  return out;
}

function ensureSeedOutline(): void {
  if (graph.block.list().length > 0) return;
  graph.block.create({
    name: "Untitled",
    text: "Untitled",
    order: 0,
  });
}

export function Outliner() {
  const containerRef = useRef<HTMLElement | null>(null);
  const [nodes, setNodes] = useState<OutlineNode[]>([]);
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"command" | "edit">("command");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function reload(preferredId?: string): void {
    const next = flatOutline();
    setNodes(next);
    setActiveId((current) => {
      const candidate = preferredId ?? current;
      if (candidate && next.some((node) => node.id === candidate)) return candidate;
      return next[0]?.id ?? "";
    });
  }

  useEffect(() => {
    try {
      ensureSeedOutline();
      reload();
    } catch (loadError: unknown) {
      setError(String(loadError));
    }
  }, []);

  useEffect(() => {
    if (mode !== "command") return;
    containerRef.current?.focus();
  }, [mode, activeId]);

  const byId = useMemo(() => {
    const map = new Map<string, OutlineNode>();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  const childrenByParentMemo = useMemo(() => {
    const map = new Map<string | undefined, OutlineNode[]>();
    for (const node of nodes) {
      const key = node.parentId;
      const list = map.get(key) ?? [];
      list.push(node);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [nodes]);

  const flat = useMemo(() => nodes, [nodes]);
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    flat.forEach((node, index) => map.set(node.id, index));
    return map;
  }, [flat]);

  const activeNode = activeId ? byId.get(activeId) : undefined;

  useEffect(() => {
    if (!activeNode) {
      setDraft("");
      return;
    }
    setDraft(activeNode.text);
  }, [activeNode?.id]);

  function mutate<T>(request: () => T, nextActiveId?: string): T | undefined {
    setBusy(true);
    setError("");
    try {
      const result = request();
      reload(nextActiveId);
      return result;
    } catch (requestError: unknown) {
      setError(String(requestError));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function commitDraft(): void {
    if (!activeNode) return;
    const next = draft.trim();
    if (next === activeNode.text) return;
    mutate(() =>
      graph.block.node(activeNode.id).update({
        text: next,
        name: next || "Untitled",
      }),
    );
  }

  function activeTextIsEmpty(): boolean {
    if (!activeNode) return true;
    const current = mode === "edit" ? draft : activeNode.text;
    return current.trim().length === 0;
  }

  function siblingContext(node: OutlineNode) {
    const siblings = (childrenByParentMemo.get(node.parentId) ?? [])
      .slice()
      .sort((a, b) => a.order - b.order);
    const index = siblings.findIndex((item) => item.id === node.id);
    return { siblings, index };
  }

  function createSiblingBelow(): void {
    if (!activeNode) return;
    if (activeTextIsEmpty()) return;
    commitDraft();
    const { index } = siblingContext(activeNode);
    const created = mutate(() => {
      const id = graph.block.create({
        name: "Untitled",
        text: "",
        parent: activeNode.parentId,
        order: index + 1,
      });
      moveNode(id, activeNode.parentId, index + 1);
      return { id };
    });
    if (created?.id) {
      setActiveId(created.id);
      setMode("edit");
    }
  }

  function createChild(): void {
    if (!activeNode) return;
    if (activeTextIsEmpty()) return;
    commitDraft();
    const count = (childrenByParentMemo.get(activeNode.id) ?? []).length;
    const created = mutate(() => {
      const id = graph.block.create({
        name: "Untitled",
        text: "",
        parent: activeNode.id,
        order: count,
      });
      moveNode(id, activeNode.id, count);
      return { id };
    });
    if (created?.id) {
      setActiveId(created.id);
      setMode("edit");
    }
  }

  function moveBranch(delta: -1 | 1): void {
    if (!activeNode) return;
    const { siblings, index } = siblingContext(activeNode);
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= siblings.length) return;
    mutate(() => moveNode(activeNode.id, activeNode.parentId, nextIndex));
  }

  function indent(): void {
    if (!activeNode) return;
    const { siblings, index } = siblingContext(activeNode);
    if (index <= 0) return;
    const newParent = siblings[index - 1];
    if (!newParent) return;
    const childCount = (childrenByParentMemo.get(newParent.id) ?? []).length;
    mutate(() => moveNode(activeNode.id, newParent.id, childCount));
  }

  function outdent(): void {
    if (!activeNode || !activeNode.parentId) return;
    mutate(() => outdentWithSubsequentSiblings(activeNode.id));
  }

  function deleteNode(liftChildren: boolean): void {
    if (!activeNode) return;
    const index = indexById.get(activeNode.id) ?? -1;
    const fallback = flat[index + 1]?.id ?? flat[index - 1]?.id;
    mutate(() => {
      const nodesSnapshot = snapshotNodes();
      const target = nodesSnapshot.find((node) => node.id === activeNode.id);
      if (!target) throw new Error(`Node "${activeNode.id}" not found`);

      if (liftChildren) {
        const siblings = nodesSnapshot
          .filter((node) => node.parentId === target.parentId && node.id !== target.id)
          .sort((a, b) => a.order - b.order);
        const directChildren = nodesSnapshot
          .filter((node) => node.parentId === target.id)
          .sort((a, b) => a.order - b.order);
        const insertAt = Math.max(0, Math.min(target.order, siblings.length));
        const merged = siblings.slice();
        merged.splice(insertAt, 0, ...directChildren);
        merged.forEach((node, mergedIndex) => {
          const nextParent = directChildren.some((child) => child.id === node.id)
            ? target.parentId
            : node.parentId;
          graph.block.node(node.id).update({
            parent: toApiParentId(nextParent),
            order: mergedIndex,
          });
        });
        graph.block.delete(target.id);
      } else {
        const ids = collectSubtreeIds(target.id);
        for (const nodeId of ids.reverse()) graph.block.delete(nodeId);
        reindexParent(target.parentId);
      }
    }, fallback);
  }

  async function onRootKeyDown(event: KeyboardEvent<HTMLElement>): Promise<void> {
    if (!activeNode) return;

    if (mode === "edit") {
      if (event.key === "Escape") {
        event.preventDefault();
        commitDraft();
        setMode("command");
        return;
      }
      if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        commitDraft();
        outdent();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        commitDraft();
        indent();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commitDraft();
        setMode("command");
      }
      return;
    }

    if (event.key === "i") {
      event.preventDefault();
      setMode("edit");
      return;
    }

    if ((event.altKey || event.metaKey) && event.key === "ArrowUp") {
      event.preventDefault();
      moveBranch(-1);
      return;
    }

    if ((event.altKey || event.metaKey) && event.key === "ArrowDown") {
      event.preventDefault();
      moveBranch(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const index = indexById.get(activeNode.id) ?? -1;
      const prev = flat[index - 1];
      if (prev) setActiveId(prev.id);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const index = indexById.get(activeNode.id) ?? -1;
      const next = flat[index + 1];
      if (next) setActiveId(next.id);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      indent();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      outdent();
      return;
    }

    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      outdent();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      indent();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      createChild();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      createSiblingBelow();
      return;
    }

    if (event.key === "Delete" && event.shiftKey) {
      event.preventDefault();
      deleteNode(true);
      return;
    }

    if (event.key === "Backspace" && draft.trim().length === 0) {
      event.preventDefault();
      deleteNode(false);
    }
  }

  return (
    <main
      ref={containerRef}
      tabIndex={0}
      className="mx-auto flex h-full max-w-4xl flex-col gap-3 p-4"
      onKeyDownCapture={(event) => void onRootKeyDown(event)}
    >
      <header className="flex items-center justify-between border-b border-slate-800 pb-2">
        <h1 className="text-sm font-semibold tracking-wide text-slate-300 uppercase">Outline</h1>
        <span className="text-xs text-slate-500">
          {busy ? "saving..." : `${nodes.length} nodes`} • {mode === "edit" ? "Edit mode" : "Command mode"}
        </span>
      </header>

      <section className="flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/40 p-2">
        {flat.map((node) => {
          const active = node.id === activeId;
          return (
            <div
              key={node.id}
              className={
                "group rounded px-1 py-1 transition " +
                (active ? "bg-indigo-950/60 ring-1 ring-indigo-700/60" : "hover:bg-slate-800/60")
              }
            >
              <div className="w-full" style={{ paddingLeft: `${node.depth * 18}px` }}>
                {active && mode === "edit" ? (
                  <input
                    autoFocus
                    value={draft}
                    onInput={(event) => setDraft(event.currentTarget.value)}
                    onFocus={() => setMode("edit")}
                    onBlur={() => {
                      commitDraft();
                      setMode("command");
                    }}
                    className={
                      "w-full rounded border border-indigo-500/50 bg-slate-950 px-2 py-1 text-slate-100 outline-none " +
                      typographyClass(node.depth, draft)
                    }
                  />
                ) : (
                  <button
                    onClick={() => {
                      setActiveId(node.id);
                      setMode("command");
                    }}
                    onDoubleClick={() => {
                      setActiveId(node.id);
                      setMode("edit");
                    }}
                    className={
                      "w-full rounded px-2 py-1 text-left text-slate-200 " +
                      typographyClass(node.depth, node.text || "Untitled")
                    }
                  >
                    {node.text || "Untitled"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <footer className="flex flex-wrap items-center gap-3 border-t border-slate-800 pt-2 text-xs text-slate-400">
        <span>`i` edit</span>
        <span>`Esc` command mode</span>
        <span>`Enter` sibling (command)</span>
        <span>`Cmd/Ctrl+Enter` child</span>
        <span>`Right` indent</span>
        <span>`Left` outdent</span>
        <span>`Tab` indent</span>
        <span>`Shift+Tab` outdent</span>
        <span>`Alt+Up/Down` move</span>
        <span>`Backspace` delete subtree if empty</span>
        <span>`Shift+Delete` lift children</span>
      </footer>

      {error ? (
        <div className="rounded border border-rose-900 bg-rose-950/60 p-2 text-sm text-rose-300">
          {error}
        </div>
      ) : null}
    </main>
  );
}
