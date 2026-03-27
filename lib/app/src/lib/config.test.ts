import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  defineProviderDescriptor,
  loadIoConfig,
  projectConfigDescriptorMetadata,
} from "./config.js";

test("loadIoConfig prefers io.ts and resolves env-backed values", async () => {
  const tempRoot = resolve(process.cwd(), "tmp");
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(resolve(tempRoot, "workspace-config-"));
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  await writeFile(
    resolve(root, "io.ts"),
    `import { defineIoConfig, env, linearTracker } from "@io/app/lib/config";

export default defineIoConfig({
  install: {
    brews: ["bat"],
  },
  tracker: linearTracker({
    apiKey: env.secret("LINEAR_API_KEY"),
    projectSlug: env.string("LINEAR_PROJECT_SLUG"),
  }),
  workspace: {
    root: "./workspace",
  },
});
`,
  );
  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
        brews: ["ripgrep"],
        tracker: {
          kind: "linear",
          projectSlug: "legacy-project",
        },
        workspace: {
          root: "./legacy-workspace",
        },
      },
      null,
      2,
    ),
  );

  try {
    const result = await loadIoConfig({ baseDir: root });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.sourceKind).toBe("ts");
    expect(result.value.sourcePath).toBe(resolve(root, "io.ts"));
    expect(result.value.config.install.brews).toEqual(["bat"]);
    expect(result.value.config.tracker.apiKey).toBe("linear-token");
    expect(result.value.config.tracker.projectSlug).toBe("project-slug");
    expect(result.value.config.workspace.root).toBe(resolve(root, "workspace"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadIoConfig falls back to io.json and normalizes legacy install config", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "io-config-"));

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
        brews: ["ripgrep", "bat"],
      },
      null,
      2,
    ),
  );

  try {
    const result = await loadIoConfig({ baseDir: root });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.sourceKind).toBe("json");
    expect(result.value.config.install.brews).toEqual(["ripgrep", "bat"]);
    expect(result.value.hasRuntimeConfig).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("projectConfigDescriptorMetadata flattens descriptor fields", () => {
  const descriptor = defineProviderDescriptor<{
    apiKey: string;
    baseUrl?: string;
    mode: string;
  }>({
    fields: {
      apiKey: { kind: "secret", title: "API Key" },
      baseUrl: { kind: "string", required: false },
      mode: { kind: { enum: ["cloud", "self-hosted"] } },
    },
    kind: "linear",
    title: "Linear",
  });

  expect(projectConfigDescriptorMetadata(descriptor)).toEqual({
    fields: [
      {
        key: "apiKey",
        kind: "secret",
        required: true,
        title: "API Key",
      },
      {
        key: "baseUrl",
        kind: "string",
        required: false,
      },
      {
        key: "mode",
        kind: "enum",
        options: ["cloud", "self-hosted"],
        required: true,
      },
    ],
    kind: "linear",
    scope: "provider",
    title: "Linear",
  });
});
