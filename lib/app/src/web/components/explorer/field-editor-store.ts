import { type GraphStore } from "@io/app/graph";
import { useRef, useSyncExternalStore } from "react";

import { getFirstObject } from "./helpers.js";

export function useStoreSlotValue(
  store: GraphStore,
  subjectId: string,
  predicateId: string,
): string | undefined {
  const hasSnapshotRef = useRef(false);
  const snapshotRef = useRef<string | undefined>(undefined);

  function readSnapshot(): string | undefined {
    const next = getFirstObject(store, subjectId, predicateId);
    if (hasSnapshotRef.current && snapshotRef.current === next) return snapshotRef.current;
    snapshotRef.current = next;
    hasSnapshotRef.current = true;
    return next;
  }

  return useSyncExternalStore(
    (listener) => store.subscribePredicateSlot(subjectId, predicateId, listener),
    readSnapshot,
    readSnapshot,
  );
}
