import { usePredicateSlotValue } from "@io/graph-react";
import { useGraphRuntime } from "../graph-runtime-bootstrap";
import { typeIconPredicateId } from "./model";
import { GraphIcon } from "@io/graph-module-core/react-dom";

export function EntityIcon({ id }: { id: string }) {
  const runtime = useGraphRuntime();

  const graphIconId = usePredicateSlotValue(runtime.store, id, typeIconPredicateId);
  if (!graphIconId) return null;

  return <GraphIcon iconId={graphIconId} className="size-4" />;
}
