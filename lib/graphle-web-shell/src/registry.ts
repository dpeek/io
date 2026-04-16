import type { ComponentType, ReactNode } from "react";

export interface GraphleShellNavigationItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly order?: number;
  readonly status?: string;
}

export interface GraphleShellPageContribution {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly order?: number;
  render(): ReactNode;
}

export interface GraphleShellCommand {
  readonly id: string;
  readonly label: string;
  readonly icon?: ComponentType<{
    readonly "aria-hidden"?: boolean;
    readonly "data-icon"?: string;
  }>;
  readonly order?: number;
  run?(): void;
}

export interface GraphleShellFeature {
  readonly id: string;
  readonly label: string;
  readonly order?: number;
  readonly navigation?: readonly GraphleShellNavigationItem[];
  readonly pages?: readonly GraphleShellPageContribution[];
  readonly commands?: readonly GraphleShellCommand[];
}

export interface GraphleShellRegistry {
  readonly features: readonly GraphleShellFeature[];
  readonly navigation: readonly GraphleShellNavigationItem[];
  readonly pages: readonly GraphleShellPageContribution[];
  readonly commands: readonly GraphleShellCommand[];
}

function orderValue(value: number | undefined): number {
  return value ?? Number.MAX_SAFE_INTEGER;
}

function compareOrderedLabels(
  left: { readonly id: string; readonly label: string; readonly order?: number },
  right: { readonly id: string; readonly label: string; readonly order?: number },
): number {
  const orderDifference = orderValue(left.order) - orderValue(right.order);
  if (orderDifference !== 0) return orderDifference;

  const labelDifference = left.label.localeCompare(right.label);
  if (labelDifference !== 0) return labelDifference;

  return left.id.localeCompare(right.id);
}

export function createGraphleShellRegistry(
  features: readonly GraphleShellFeature[] = [],
): GraphleShellRegistry {
  const orderedFeatures = [...features].sort(compareOrderedLabels);

  return {
    features: orderedFeatures,
    navigation: orderedFeatures
      .flatMap((feature) => feature.navigation ?? [])
      .sort(compareOrderedLabels),
    pages: orderedFeatures.flatMap((feature) => feature.pages ?? []).sort(compareOrderedLabels),
    commands: orderedFeatures
      .flatMap((feature) => feature.commands ?? [])
      .sort(compareOrderedLabels),
  };
}

export function resolveGraphleShellPage(
  registry: GraphleShellRegistry,
  path: string,
): GraphleShellPageContribution | undefined {
  return registry.pages.find((page) => page.path === path) ?? registry.pages[0];
}
