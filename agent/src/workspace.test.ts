import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { HookConfig } from "./types.js";

import { WorkspaceManager } from "./workspace.js";

const hooks: HookConfig = { timeoutMs: 5_000 };

test("WorkspaceManager derives stable branch names", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const manager = new WorkspaceManager({ hooks, rootDir: root });
    const branch = manager.getBranchName({
      blockedBy: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      description: "",
      id: "1",
      identifier: "OS-42",
      labels: [],
      priority: 1,
      state: "Todo",
      title: "Add Native Agent Setup",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(branch).toBe("codex/os-42-add-native-agent-setup");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager runs afterCreate once for new workspaces", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const commands: string[][] = [];
  try {
    const manager = new WorkspaceManager({
      hooks: { ...hooks, afterCreate: "echo ready" },
      rootDir: root,
      runCommand: async (command) => {
        commands.push(command);
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    });
    const issue = {
      blockedBy: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      description: "",
      id: "1",
      identifier: "OS-1",
      labels: [],
      priority: 1,
      state: "Todo",
      title: "Example",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const first = await manager.prepare(issue);
    const second = await manager.prepare(issue);
    expect(first.createdNow).toBe(true);
    expect(second.createdNow).toBe(false);
    expect(commands).toEqual([["bash", "-lc", "echo ready"]]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager throws when a required hook fails", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const manager = new WorkspaceManager({
      hooks: { ...hooks, beforeRun: "false" },
      rootDir: root,
      runCommand: async (command) => {
        if (command[0] === "bash") {
          return { exitCode: 1, stderr: "boom", stdout: "" };
        }
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    });
    const workspace = await manager.prepare({
      blockedBy: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      description: "",
      id: "1",
      identifier: "OS-1",
      labels: [],
      priority: 1,
      state: "Todo",
      title: "Example",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    await expect(manager.runBeforeRunHook(workspace.path)).rejects.toThrow("boom");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
