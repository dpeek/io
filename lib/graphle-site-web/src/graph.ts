import {
  createHttpGraphClient,
  type HttpGraphClientOptions,
  type SyncedGraphClient,
} from "@dpeek/graphle-client";
import { colorType, minimalCore, tag } from "@dpeek/graphle-module-core";
import { site } from "@dpeek/graphle-module-site";

export type GraphleSiteGraphNamespace = typeof site & {
  readonly tag: typeof tag;
};
export type GraphleSiteGraphDefinitions = typeof minimalCore & {
  readonly color: typeof colorType;
  readonly tag: typeof tag;
} & typeof site;

export const graphleSiteGraphNamespace: GraphleSiteGraphNamespace = { ...site, tag };
export const graphleSiteGraphDefinitions: GraphleSiteGraphDefinitions = {
  ...minimalCore,
  color: colorType,
  tag,
  ...site,
};

export const graphleSiteGraphBootstrapOptions = Object.freeze({
  availableDefinitions: graphleSiteGraphDefinitions,
  cacheKey: graphleSiteGraphDefinitions,
  coreSchema: minimalCore,
});

export type GraphleSiteGraphClient = SyncedGraphClient<
  GraphleSiteGraphNamespace,
  GraphleSiteGraphDefinitions
>;
export type GraphleSiteHttpGraphClientOptions = Omit<
  HttpGraphClientOptions<GraphleSiteGraphDefinitions>,
  "bootstrap" | "definitions"
>;

export function createGraphleSiteHttpGraphClient(
  options: GraphleSiteHttpGraphClientOptions = {},
): Promise<GraphleSiteGraphClient> {
  return createHttpGraphClient(graphleSiteGraphNamespace, {
    ...options,
    bootstrap: graphleSiteGraphBootstrapOptions,
    definitions: graphleSiteGraphDefinitions,
  });
}
