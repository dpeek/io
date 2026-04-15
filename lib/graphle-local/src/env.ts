import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const graphleAuthSecretEnvKey = "GRAPHLE_AUTH_SECRET";
export const graphleProjectIdEnvKey = "GRAPHLE_PROJECT_ID";

export interface EnsureLocalEnvOptions {
  readonly cwd: string;
  readonly envPath?: string;
  readonly generateAuthSecret?: () => string;
  readonly generateProjectId?: () => string;
}

export interface LocalProjectEnv {
  readonly path: string;
  readonly createdFile: boolean;
  readonly createdKeys: readonly string[];
  readonly reusedKeys: readonly string[];
  readonly values: {
    readonly authSecret: string;
    readonly projectId: string;
  };
}

type EnvMap = Map<string, string>;

function generateAuthSecret(): string {
  return randomBytes(32).toString("base64url");
}

function generateProjectId(): string {
  return `project_${randomBytes(16).toString("hex")}`;
}

function parseEnvContent(content: string): EnvMap {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (!key || values.has(key)) {
      continue;
    }
    values.set(key, unwrapEnvValue(rawValue ?? ""));
  }
  return values;
}

function unwrapEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function formatEnvAppend(content: string, entries: readonly [string, string][]): string {
  const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  return `${prefix}${entries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

export async function ensureLocalProjectEnv({
  cwd,
  envPath = join(cwd, ".env"),
  generateAuthSecret: createAuthSecret = generateAuthSecret,
  generateProjectId: createProjectId = generateProjectId,
}: EnsureLocalEnvOptions): Promise<LocalProjectEnv> {
  let existing = "";
  let createdFile = false;

  try {
    existing = await readFile(envPath, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      throw error;
    }
    await mkdir(dirname(envPath), { recursive: true });
    await writeFile(envPath, "", "utf8");
    createdFile = true;
  }

  const values = parseEnvContent(existing);
  const missingEntries: [string, string][] = [];
  const createdKeys: string[] = [];
  const reusedKeys: string[] = [];

  let authSecret = values.get(graphleAuthSecretEnvKey);
  if (authSecret) {
    reusedKeys.push(graphleAuthSecretEnvKey);
  } else {
    authSecret = createAuthSecret();
    missingEntries.push([graphleAuthSecretEnvKey, authSecret]);
    createdKeys.push(graphleAuthSecretEnvKey);
  }

  let projectId = values.get(graphleProjectIdEnvKey);
  if (projectId) {
    reusedKeys.push(graphleProjectIdEnvKey);
  } else {
    projectId = createProjectId();
    missingEntries.push([graphleProjectIdEnvKey, projectId]);
    createdKeys.push(graphleProjectIdEnvKey);
  }

  if (missingEntries.length > 0) {
    await appendFile(envPath, formatEnvAppend(existing, missingEntries), "utf8");
  }

  return {
    path: envPath,
    createdFile,
    createdKeys,
    reusedKeys,
    values: {
      authSecret,
      projectId,
    },
  };
}
