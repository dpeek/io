import { exists } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type PackageJson = {
  name: string;
  version: string;
  private: boolean;
  type: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  workspaces?: string[];
};

const template: PackageJson = {
  name: "template",
  version: "1.0.0",
  type: "module",
  private: true,
  scripts: {
    clean: "rm -rf out",
    build: "tsgo",
    format: "oxfmt",
    lint: "oxlint",
    types: "tsgo --noEmit",
    dev: "tsgo --watch",
  },
  dependencies: {},
  devDependencies: {
    "@io/lib": "workspace:",
    "@types/bun": "^1.3.9",
    "@types/node": "^25.3.2",
    "@typescript/native-preview": "^7.0.0-dev.20260226.1",
    bun: "1.3.9",
    oxfmt: "^0.35.0",
    oxlint: "^1.50.0",
  },
};

async function readPackage(path: string) {
  const packagePath = join(path, "package.json");
  return (await Bun.file(packagePath).json()) as PackageJson;
}

async function writePackage(path: string, json: Partial<PackageJson>) {
  const packagePath = join(path, "package.json");
  await Bun.file(packagePath).write(JSON.stringify(json, null, 2) + "\n");
}

function getPackageUrl(path: string) {
  return new URL(`../${path}`, import.meta.url);
}

function getRelativeUrl(path: string) {
  return new URL(path, pathToFileURL(process.cwd() + "/"));
}

type Replacer = (input: string) => string;

async function writeFile(source: URL, destination: URL, overwrite: boolean, replacer?: Replacer) {
  if ((await exists(destination)) && !overwrite) return;
  let text = await Bun.file(source).text();
  if (replacer) text = replacer(text);
  await Bun.file(destination).write(text);
}

function getFileWriter(path: string) {
  const write = async (
    source: string,
    destination: string,
    overwrite: boolean,
    replacer?: Replacer,
  ) => {
    await writeFile(
      getPackageUrl(source),
      getRelativeUrl(`${path}/${destination}`),
      overwrite,
      replacer,
    );
  };
  return { write };
}

export async function createPackage(path?: string) {
  if (!path) throw new Error("Path is required");
  const workspace = await readPackage(".");
  const namespace = workspace.name.slice(0, workspace.name.indexOf("/"));
  workspace.workspaces = workspace.workspaces ?? [];
  if (!workspace.workspaces.includes(path)) {
    workspace.workspaces.push(path);
    writePackage(".", workspace);
  }
  const name = `${namespace}/${path}`;
  await writePackage(path, { ...template, name });

  const target = getFileWriter(path);
  await target.write("res/src/index.ts", "src/index.ts", false);
  await target.write("res/src/index.test.ts", "src/index.test.ts", false, (input) =>
    input.replace("@io/lib", name),
  );
  await configurePackage(path);
}

export async function configurePackage(path?: string) {
  if (!path) throw new Error("Path is required");
  const target = getFileWriter(path);
  await target.write("res/vscode/settings.json", ".vscode/settings.json", true);
  await target.write("res/vscode/extensions.json", ".vscode/extensions.json", true);
  await target.write("res/git/ignore", ".gitignore", true);
  if (path !== ".") {
    await target.write("tsconfig.json", "tsconfig.json", false);
    await target.write("res/oxc/oxlint.json", ".oxlintrc.json", true);
    await target.write("res/oxc/oxfmt.json", ".oxfmtrc.json", true);
  }
}
