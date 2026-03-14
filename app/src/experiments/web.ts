import { companyExperimentWeb } from "./company/web.js";
import { appRouteGroups, collectExperimentRoutes } from "./contracts.js";
import { envVarsExperimentWeb } from "./env-vars/web.js";
import { explorerExperimentWeb } from "./explorer/web.js";
import { outlinerExperimentWeb } from "./outliner/web.js";
import { workspaceExperimentWeb } from "./workspace/web.js";

export const appExperimentWebs = [
  companyExperimentWeb,
  workspaceExperimentWeb,
  explorerExperimentWeb,
  outlinerExperimentWeb,
  envVarsExperimentWeb,
] as const;

export const appRoutes = collectExperimentRoutes(appExperimentWebs);

export type AppRouteDefinition = (typeof appRoutes)[number];
export type AppRouteKey = AppRouteDefinition["key"];

export { appRouteGroups };
export type { AppExperimentRouteDefinition, AppRouteGroupKey } from "./contracts.js";
