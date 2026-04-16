import { createContext, useContext, type ReactNode } from "react";
import { Badge } from "@dpeek/graphle-web-ui/badge";
import { Button } from "@dpeek/graphle-web-ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@dpeek/graphle-web-ui/empty";
import { AlertCircleIcon, CircleDashedIcon, LoaderCircleIcon } from "lucide-react";

import {
  createGraphleShellRegistry,
  resolveGraphleShellPage,
  type GraphleShellCommand,
  type GraphleShellFeature,
} from "./registry.js";

export type GraphleShellStatusState = "unknown" | "loading" | "ready" | "error" | "disabled";

export interface GraphleShellStatusSummary {
  readonly label: string;
  readonly state: GraphleShellStatusState;
  readonly detail?: string;
}

export interface GraphleShellHostStatus {
  readonly auth: GraphleShellStatusSummary;
  readonly graph: GraphleShellStatusSummary;
  readonly sync: GraphleShellStatusSummary;
  readonly deploy: GraphleShellStatusSummary;
  readonly runtime?: GraphleShellStatusSummary;
}

export interface GraphleShellHostContextValue {
  readonly status: GraphleShellHostStatus;
  readonly commands: readonly GraphleShellCommand[];
}

export interface GraphleShellProps {
  readonly features?: readonly GraphleShellFeature[];
  readonly path?: string;
  readonly title?: string;
  readonly status?: Partial<GraphleShellHostStatus>;
  readonly commands?: readonly GraphleShellCommand[];
  readonly children?: ReactNode;
}

export const defaultGraphleShellHostStatus: GraphleShellHostStatus = {
  auth: {
    label: "Auth unknown",
    state: "unknown",
  },
  graph: {
    label: "Graph unknown",
    state: "unknown",
  },
  sync: {
    label: "Sync idle",
    state: "disabled",
  },
  deploy: {
    label: "Deploy idle",
    state: "disabled",
  },
};

const GraphleShellHostContext = createContext<GraphleShellHostContextValue>({
  status: defaultGraphleShellHostStatus,
  commands: [],
});

export function GraphleShellProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: GraphleShellHostContextValue;
}) {
  return (
    <GraphleShellHostContext.Provider value={value}>{children}</GraphleShellHostContext.Provider>
  );
}

export function useGraphleShellHost(): GraphleShellHostContextValue {
  return useContext(GraphleShellHostContext);
}

function mergeStatus(status: Partial<GraphleShellHostStatus> | undefined): GraphleShellHostStatus {
  return {
    ...defaultGraphleShellHostStatus,
    ...status,
  };
}

function statusVariant(
  state: GraphleShellStatusState,
): "default" | "secondary" | "destructive" | "outline" {
  if (state === "ready") return "default";
  if (state === "loading") return "secondary";
  if (state === "error") return "destructive";
  return "outline";
}

function StatusBadge({ summary }: { readonly summary: GraphleShellStatusSummary }) {
  return (
    <Badge variant={statusVariant(summary.state)} title={summary.detail}>
      {summary.label}
    </Badge>
  );
}

function renderCommand(command: GraphleShellCommand) {
  const Icon = command.icon;

  return (
    <Button key={command.id} type="button" variant="outline" onClick={command.run}>
      {Icon ? <Icon aria-hidden={true} data-icon="inline-start" /> : null}
      {command.label}
    </Button>
  );
}

export function GraphleShellEmptyState({
  description = "Install a browser feature to add navigation and pages.",
}: {
  readonly description?: string;
}) {
  return (
    <Empty className="graphle-shell-state">
      <CircleDashedIcon aria-hidden="true" />
      <EmptyHeader>
        <EmptyTitle>No feature areas installed</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function GraphleShellLoadingState({ label = "Loading shell" }: { readonly label?: string }) {
  return (
    <Empty className="graphle-shell-state">
      <LoaderCircleIcon aria-hidden="true" className="graphle-shell-spin" />
      <EmptyHeader>
        <EmptyTitle>{label}</EmptyTitle>
        <EmptyDescription>Waiting for the browser host to report runtime status.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function GraphleShellErrorState({
  title = "Shell unavailable",
  description,
}: {
  readonly title?: string;
  readonly description: string;
}) {
  return (
    <Empty className="graphle-shell-state">
      <AlertCircleIcon aria-hidden="true" />
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function GraphleShell({
  features = [],
  path = "/",
  title = "Graphle",
  status,
  commands = [],
  children,
}: GraphleShellProps) {
  const registry = createGraphleShellRegistry(features);
  const activePage = resolveGraphleShellPage(registry, path);
  const hostStatus = mergeStatus(status);
  const hostCommands = [...registry.commands, ...commands];
  const content = children ?? activePage?.render() ?? <GraphleShellEmptyState />;

  return (
    <GraphleShellProvider
      value={{
        status: hostStatus,
        commands: hostCommands,
      }}
    >
      <div className="graphle-shell" data-shell-features={registry.features.length}>
        <aside className="graphle-shell-sidebar" aria-label="Graphle navigation">
          <div className="graphle-shell-brand">
            <span className="graphle-shell-brand-mark" aria-hidden="true">
              G
            </span>
            <span>{title}</span>
          </div>
          <nav className="graphle-shell-nav">
            {registry.navigation.length > 0 ? (
              registry.navigation.map((item) => (
                <a
                  key={item.id}
                  className="graphle-shell-nav-item"
                  data-active={item.href === path}
                  href={item.href}
                >
                  <span>{item.label}</span>
                  {item.status ? (
                    <span className="graphle-shell-nav-status">{item.status}</span>
                  ) : null}
                </a>
              ))
            ) : (
              <span className="graphle-shell-nav-empty">No navigation</span>
            )}
          </nav>
        </aside>
        <main className="graphle-shell-main">
          <header className="graphle-shell-header">
            <div>
              <span className="graphle-shell-eyebrow">Local browser shell</span>
              <h1>{activePage?.label ?? title}</h1>
            </div>
            <div className="graphle-shell-status" aria-label="Host status">
              <StatusBadge summary={hostStatus.auth} />
              <StatusBadge summary={hostStatus.graph} />
              <StatusBadge summary={hostStatus.sync} />
              <StatusBadge summary={hostStatus.deploy} />
              {hostStatus.runtime ? <StatusBadge summary={hostStatus.runtime} /> : null}
            </div>
          </header>
          {hostCommands.length > 0 ? (
            <div className="graphle-shell-command-bar" aria-label="Commands">
              {hostCommands.map(renderCommand)}
            </div>
          ) : null}
          <section className="graphle-shell-content">{content}</section>
        </main>
      </div>
    </GraphleShellProvider>
  );
}
