import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createIdMap,
  extractSchemaKeys,
  findDuplicateIds,
  type AnyTypeOutput,
  type GraphIdMap,
} from "@io/core/graph";

type TypeNamespace = Record<string, AnyTypeOutput>;

function usage(): never {
  console.error(
    [
      "Usage:",
      "  io schema check <schema-file.ts>",
      "  io schema sync <schema-file.ts> [--prune-orphans]",
      "  io schema rename <schema-file.ts> <old-key> <new-key>",
      "",
      "The id map is written next to the schema file as <name>.json",
    ].join("\n"),
  );
  process.exit(1);
}

function mapPathFor(schemaPath: string): string {
  if (!schemaPath.endsWith(".ts")) {
    throw new Error(`Schema path must point to a .ts file, got "${schemaPath}"`);
  }
  return schemaPath.replace(/\.ts$/, ".json");
}

function resolveSchemaPath(inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);
}

function isTypeOutput(value: unknown): value is AnyTypeOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AnyTypeOutput>;
  return candidate.kind === "entity" || candidate.kind === "scalar" || candidate.kind === "enum";
}

function isTypeNamespace(value: unknown): value is TypeNamespace {
  if (!value || typeof value !== "object") return false;
  const entries = Object.values(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(isTypeOutput);
}

function namespaceNameFromPath(schemaPath: string): string {
  const filename = schemaPath.split("/").pop() ?? schemaPath;
  const stem = filename.replace(/\.ts$/, "");
  return stem.endsWith("-schema") ? stem.slice(0, -7) : stem;
}

function detectNamespace(
  moduleExports: Record<string, unknown>,
  schemaPath: string,
): TypeNamespace {
  const preferred = namespaceNameFromPath(schemaPath);
  const direct = moduleExports[preferred];
  if (isTypeNamespace(direct)) return direct;

  for (const value of Object.values(moduleExports)) {
    if (isTypeNamespace(value)) return value;
  }

  const collected: TypeNamespace = {};
  for (const [name, value] of Object.entries(moduleExports)) {
    if (!isTypeOutput(value)) continue;
    collected[name] = value;
  }
  if (Object.keys(collected).length > 0) return collected;

  throw new Error(`Could not detect exported namespace in "${schemaPath}"`);
}

async function importSchema(schemaPath: string): Promise<TypeNamespace> {
  const moduleUrl = `${pathToFileURL(schemaPath).href}?t=${Date.now()}`;
  const moduleExports = (await import(moduleUrl)) as Record<string, unknown>;
  return detectNamespace(moduleExports, schemaPath);
}

async function readMap(mapPath: string): Promise<GraphIdMap | undefined> {
  if (!existsSync(mapPath)) return undefined;
  const json = await readFile(mapPath, "utf8");
  return JSON.parse(json) as GraphIdMap;
}

async function writeMap(mapPath: string, map: GraphIdMap): Promise<void> {
  await mkdir(dirname(mapPath), { recursive: true });
  await writeFile(mapPath, JSON.stringify(map, null, 2) + "\n", "utf8");
}

async function checkCommand(schemaPathInput: string): Promise<void> {
  const schemaPath = resolveSchemaPath(schemaPathInput);
  const mapPath = mapPathFor(schemaPath);
  const namespace = await importSchema(schemaPath);
  const map = await readMap(mapPath);

  if (!map) {
    console.error(`Missing id map: ${mapPath}`);
    process.exit(1);
  }

  const keys = extractSchemaKeys(namespace);
  const keySet = new Set(keys);
  const mapKeys = new Set(Object.keys(map.keys));
  const missing = keys.filter((key) => !mapKeys.has(key));
  const orphans = [...mapKeys].filter((key) => !keySet.has(key)).sort((a, b) => a.localeCompare(b));
  const duplicateIds = findDuplicateIds(map);

  console.log(`Schema: ${schemaPath}`);
  console.log(`Map:    ${mapPath}`);
  console.log(`Keys:   ${keys.length}`);
  console.log(`Missing:${missing.length}`);
  console.log(`Orphans:${orphans.length}`);
  console.log(`Dup IDs:${duplicateIds.length}`);

  if (missing.length > 0) {
    console.log("\nMissing keys:");
    for (const key of missing) console.log(`  - ${key}`);
  }
  if (orphans.length > 0) {
    console.log("\nOrphan keys:");
    for (const key of orphans) console.log(`  - ${key}`);
  }
  if (duplicateIds.length > 0) {
    console.log("\nDuplicate IDs:");
    for (const dup of duplicateIds) console.log(`  - ${dup.id}: ${dup.keys.join(", ")}`);
  }

  if (missing.length > 0 || orphans.length > 0 || duplicateIds.length > 0) process.exit(1);
}

async function syncCommand(schemaPathInput: string, pruneOrphans: boolean): Promise<void> {
  const schemaPath = resolveSchemaPath(schemaPathInput);
  const mapPath = mapPathFor(schemaPath);
  const namespace = await importSchema(schemaPath);
  const existing = await readMap(mapPath);
  const { map, added, removed } = createIdMap(namespace, existing, { pruneOrphans });
  const duplicateIds = findDuplicateIds(map);
  if (duplicateIds.length > 0) {
    console.error("Refusing to write id map with duplicate IDs:");
    for (const dup of duplicateIds) console.error(`  - ${dup.id}: ${dup.keys.join(", ")}`);
    process.exit(1);
  }

  await writeMap(mapPath, map);
  console.log(`Wrote ${mapPath}`);
  console.log(`Added ${added.length} key(s)`);
  if (added.length > 0) {
    for (const key of added) console.log(`  + ${key}`);
  }
  if (removed.length > 0) {
    console.log(`Pruned ${removed.length} orphan key(s)`);
    for (const key of removed) console.log(`  - ${key}`);
  }
}

async function renameCommand(
  schemaPathInput: string,
  oldKey: string,
  newKey: string,
): Promise<void> {
  if (oldKey === newKey) throw new Error("Old key and new key are identical");
  const schemaPath = resolveSchemaPath(schemaPathInput);
  const mapPath = mapPathFor(schemaPath);
  const map = await readMap(mapPath);
  if (!map) throw new Error(`Missing id map: ${mapPath}`);
  const id = map.keys[oldKey];
  if (!id) throw new Error(`Old key "${oldKey}" does not exist in map`);
  if (map.keys[newKey]) throw new Error(`New key "${newKey}" already exists in map`);

  delete map.keys[oldKey];
  map.keys[newKey] = id;
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(map.keys).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = map.keys[key] as string;
  }
  map.keys = sorted;
  await writeMap(mapPath, map);
  console.log(`Renamed key in ${mapPath}`);
  console.log(`  ${oldKey} -> ${newKey}`);
  console.log(`  id: ${id}`);
}

export async function run([command, schemaPathInput, ...rest]: string[]): Promise<void> {
  console.log(command, schemaPathInput, rest);
  if (!command || !schemaPathInput) usage();
  if (command === "check") {
    if (rest.length > 0) usage();
    await checkCommand(schemaPathInput);
    return;
  }
  if (command === "sync") {
    const pruneOrphans = rest.includes("--prune-orphans");
    await syncCommand(schemaPathInput, pruneOrphans);
    return;
  }
  if (command === "rename") {
    if (rest.length !== 2) usage();
    const [oldKey, newKey] = rest;
    if (!oldKey || !newKey) usage();
    await renameCommand(schemaPathInput, oldKey, newKey);
    return;
  }
  usage();
}
