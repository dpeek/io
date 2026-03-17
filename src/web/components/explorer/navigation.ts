import { typeId } from "@io/core/graph";
import { app } from "@io/core/graph/schema/app";

import type { ExplorerSelection } from "./model.js";
import { newTarget, schemaTarget } from "./model.js";

export function isSchemaTarget(target: string): boolean {
  return target === schemaTarget;
}

export function isNewTarget(target: string): boolean {
  return target === newTarget;
}

export function readExplorerSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function readExplorerSelectionFromSearchParams(
  searchParams: URLSearchParams,
): ExplorerSelection {
  const defaultTypeId = typeId(app.topic);
  return {
    target: searchParams.get("target") ?? schemaTarget,
    typeId: searchParams.get("type") ?? defaultTypeId,
  };
}

export function buildExplorerHref(input: ExplorerSelection): string {
  const params = new URLSearchParams();
  if (input.typeId) params.set("type", input.typeId);
  if (input.target) params.set("target", input.target);

  const query = params.toString();
  return query.length > 0 ? `/graph?${query}` : "/graph";
}

export function replaceExplorerUrl(nextUrl: string): void {
  if (typeof window === "undefined") return;
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (currentUrl === nextUrl) return;
  window.history.replaceState(null, "", nextUrl);
}

export function pushExplorerUrl(nextUrl: string): void {
  if (typeof window === "undefined") return;
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (currentUrl === nextUrl) return;
  window.history.pushState(null, "", nextUrl);
}
