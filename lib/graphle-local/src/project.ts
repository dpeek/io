import { resolve } from "node:path";

import { ensureLocalProjectEnv, type EnsureLocalEnvOptions, type LocalProjectEnv } from "./env.js";

export const graphleSqliteFilename = "graphle.sqlite";

export interface PrepareLocalProjectOptions extends Omit<EnsureLocalEnvOptions, "cwd" | "envPath"> {
  readonly cwd: string;
}

export interface GraphleLocalProject {
  readonly cwd: string;
  readonly env: LocalProjectEnv;
  readonly databasePath: string;
  readonly authSecret: string;
  readonly projectId: string;
}

export async function prepareLocalProject({
  cwd,
  generateAuthSecret,
  generateProjectId,
}: PrepareLocalProjectOptions): Promise<GraphleLocalProject> {
  const resolvedCwd = resolve(cwd);
  const env = await ensureLocalProjectEnv({
    cwd: resolvedCwd,
    generateAuthSecret,
    generateProjectId,
  });

  return {
    cwd: resolvedCwd,
    env,
    databasePath: resolve(resolvedCwd, graphleSqliteFilename),
    authSecret: env.values.authSecret,
    projectId: env.values.projectId,
  };
}
