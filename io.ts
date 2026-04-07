import { defineIoConfig, env, linearTracker } from "@op/cli/config";

const reviewPlanningEnabled = false;

export default defineIoConfig({
  agent: {
    maxConcurrentAgents: 4,
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
      "project.mcp": "./lib/cli/doc/graph-mcp.md",
      "project.overview": "./doc/index.md",
      "project.review": "./doc/agent/review.md",
      "project.workflow": "./lib/cli/doc/agent-workflow.md",
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
      allowedSharedPaths: ["./lib/cli/src"],
      docs: ["./lib/cli/doc/agent-runtime.md", "./lib/cli/doc/agent-workflow.md"],
      path: "./lib/cli/src/agent",
    },
    graph: {
      allowedSharedPaths: ["./lib/app/src"],
      docs: [
        "./lib/graph-kernel/doc/runtime-stack.md",
        "./lib/graph-kernel/doc/roadmap.md",
        "./lib/graph-client/doc/roadmap.md",
        "./lib/graph-surface/doc/roadmap.md",
        "./lib/graph-authority/doc/roadmap.md",
        "./lib/graph-module-core/doc/icons-and-svg.md",
      ],
      path: "./lib/app/src/graph",
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
