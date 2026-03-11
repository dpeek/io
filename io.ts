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
    entrypoint: "./io.md",
    docs: {
      "project.architecture": "./io/topic/architecture.md",
      "project.focus": "./io/topic/focus.md",
      "project.managed-stream-comments": "./io/topic/managed-stream-comments.md",
      "project.managed-stream-backlog": "./io/topic/managed-stream-backlog.md",
      "project.managed-stream-goals": "./io/topic/goals.md",
      "project.module-stream-workflow-plan": "./io/topic/module-stream-workflow-plan.md",
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
          "project.focus",
          "project.managed-stream-goals",
          "project.managed-stream-backlog",
          "project.managed-stream-comments",
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
  modules: {
    agent: {
      allowedSharedPaths: ["./io/topic", "./llm/topic"],
      docs: ["./io/topic/agent.md", "./agent/doc/stream-workflow.md"],
      path: "./agent",
    },
    app: {
      allowedSharedPaths: ["./graph/doc", "./io/topic", "./llm/topic"],
      docs: ["./io/topic/graph.md"],
      path: "./app",
    },
    cli: {
      allowedSharedPaths: ["./io/topic", "./llm/topic"],
      docs: ["./io/topic/io-ts-config.md"],
      path: "./cli",
    },
    config: {
      allowedSharedPaths: ["./io/topic", "./llm/topic"],
      docs: ["./io/topic/io-ts-config.md"],
      path: "./config",
    },
    graph: {
      allowedSharedPaths: ["./io/topic", "./llm/topic"],
      docs: ["./io/topic/graph.md", "./graph/doc/overview.md"],
      path: "./graph",
    },
    lib: {
      allowedSharedPaths: ["./io/topic", "./llm/topic"],
      docs: ["./io/topic/io-ts-config.md"],
      path: "./lib",
    },
    tui: {
      allowedSharedPaths: ["./agent/doc", "./io/topic", "./llm/topic"],
      docs: ["./io/topic/agent-opentui.md"],
      path: "./tui",
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
