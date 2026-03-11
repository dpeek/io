import { defineIoConfig, env, linearTracker } from "@io/lib/config";

export default defineIoConfig({
  agent: {
    maxConcurrentAgents: 3,
    maxTurns: 1,
  },
  codex: {
    approvalPolicy: "never",
    command: "codex app-server",
    threadSandbox: "workspace-write",
  },
  hooks: {
    afterCreate: "bun install",
  },
  context: {
    docs: {
      "project.architecture": "./io/topic/architecture.md",
      "project.overview": "./io/topic/project-overview.md",
      "project.workflow-migration": "./io/topic/workflow-migration.md",
    },
    profiles: {
      backlog: {
        include: [
          "builtin:io.agent.backlog.default",
          "builtin:io.context.discovery",
          "builtin:io.linear.status-updates",
          "builtin:io.core.git-safety",
          "project.overview",
          "project.architecture",
          "project.workflow-migration",
        ],
      },
      execute: {
        include: [
          "builtin:io.agent.execute.default",
          "builtin:io.context.discovery",
          "builtin:io.linear.status-updates",
          "builtin:io.core.validation",
          "builtin:io.core.git-safety",
          "project.overview",
          "project.architecture",
        ],
      },
    },
  },
  install: {
    brews: [
      "fzf",
      "ripgrep",
      "bat",
      "starship",
      "fd",
      "eza",
      "btop",
      "gh",
      "node",
      "pnpm",
      "tailscale",
      "dicklesworthstone/tap/cass",
      "--cask codex",
      "--cask codex-app",
      "--cask github",
      "--cask 1password",
      "--cask 1password-cli",
      "--cask tailscale-app",
      "--cask raycast",
      "--cask orbstack",
      "--cask cursor",
      "--cask google-chrome",
      "--cask ghostty",
      "--cask figma",
      "--cask slack",
      "--cask linear-linear",
      "--cask claude",
      "--cask claude-code",
    ],
  },
  issues: {
    defaultAgent: "execute",
    defaultProfile: "execute",
    routing: [
      {
        if: {
          labelsAny: ["backlog", "planning"],
        },
        agent: "backlog",
        profile: "backlog",
      },
    ],
  },
  tracker: linearTracker({
    activeStates: ["Todo", "In Progress"],
    apiKey: env.secret("LINEAR_API_KEY"),
    projectSlug: env.string("LINEAR_PROJECT_SLUG"),
  }),
  workspace: {
    root: ".io",
  },
});
