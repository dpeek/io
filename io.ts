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
    entrypoint: "./io/overview.md",
    docs: {
      "project.backlog": "./io/backlog.md",
      "project.goals": "./io/goals.md",
      "project.module-stream-workflow-plan": "./agent/io/module-stream-workflow-plan.md",
      "project.overview": "./io/overview.md",
      "project.workflow": "./io/workflow.md",
    },
    profiles: {
      backlog: {
        include: [
          "builtin:io.agent.backlog.default",
          "builtin:io.context.discovery",
          "builtin:io.linear.status-updates",
          "builtin:io.core.git-safety",
          "project.overview",
          "project.workflow",
          "project.backlog",
          "project.goals",
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
          "project.workflow",
        ],
      },
    },
  },
  modules: {
    agent: {
      allowedSharedPaths: ["./io"],
      docs: ["./agent/io/overview.md", "./agent/io/module-stream-workflow-plan.md"],
      path: "./agent",
    },
    app: {
      allowedSharedPaths: ["./graph/io", "./io"],
      docs: ["./app/io/overview.md"],
      path: "./app",
    },
    cli: {
      allowedSharedPaths: ["./io"],
      docs: ["./cli/io/overview.md"],
      path: "./cli",
    },
    config: {
      allowedSharedPaths: ["./io"],
      docs: ["./config/io/overview.md"],
      path: "./config",
    },
    graph: {
      allowedSharedPaths: ["./io"],
      docs: ["./graph/io/overview.md", "./graph/io/architecture.md"],
      path: "./graph",
    },
    lib: {
      allowedSharedPaths: ["./io"],
      docs: ["./lib/io/overview.md"],
      path: "./lib",
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
