import { defineIoConfig, env, linearTracker } from "@io/core/lib/config";

const reviewPlanningEnabled = false;

export default defineIoConfig({
  agent: {
    maxConcurrentAgents: 3,
    maxTurns: 1,
  },
  codex: {
    approvalPolicy: "never",
    command: "AGENT=1 codex app-server",
    threadSandbox: "workspace-write",
  },
  hooks: {
    afterCreate: "bun install",
  },
  context: {
    entrypoint: "./io.md",
    docs: {
      "project.backlog": "./doc/agent/backlog.md",
      "project.mcp": "./doc/graph/mcp.md",
      "project.overview": "./doc/index.md",
      "project.review": "./doc/agent/review.md",
      "project.workflow": "./doc/agent/workflow.md",
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
      review: {
        include: [
          "builtin:io.agent.review.default",
          "builtin:io.context.discovery",
          "builtin:io.linear.status-updates",
          "builtin:io.core.validation",
          "builtin:io.core.git-safety",
          "project.overview",
          "project.workflow",
          "project.review",
        ],
      },
    },
  },
  modules: {
    agent: {
      allowedSharedPaths: ["./src"],
      docs: ["./doc/agent/index.md", "./doc/agent/workflow.md"],
      path: "./src/agent",
    },
    graph: {
      allowedSharedPaths: ["./src"],
      docs: ["./doc/graph/index.md", "./doc/graph/icon.md", "./doc/graph/architecture.md"],
      path: "./src/graph",
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
      ...(reviewPlanningEnabled
        ? [
            {
              if: {
                hasChildren: false,
                hasParent: true,
                stateIn: ["In Review"],
              },
              agent: "review" as const,
              profile: "review",
            },
          ]
        : []),
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
    activeStates: ["Todo", "In Progress", ...(reviewPlanningEnabled ? ["In Review"] : [])],
    apiKey: env.secret("LINEAR_API_KEY"),
    projectSlug: env.string("LINEAR_PROJECT_SLUG"),
  }),
  workspace: {
    root: "./tmp/workspace",
  },
});
