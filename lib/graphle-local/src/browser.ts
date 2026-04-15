import { spawn } from "node:child_process";

export interface BrowserOpenCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface OpenBrowserDependencies {
  readonly platform?: NodeJS.Platform;
  readonly spawn?: typeof spawn;
}

export function resolveBrowserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): BrowserOpenCommand {
  if (platform === "darwin") {
    return {
      command: "open",
      args: [url],
    };
  }
  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", url],
    };
  }
  return {
    command: "xdg-open",
    args: [url],
  };
}

export function openBrowser(url: string, dependencies: OpenBrowserDependencies = {}): void {
  const openCommand = resolveBrowserOpenCommand(url, dependencies.platform);
  const spawnProcess = dependencies.spawn ?? spawn;
  const child = spawnProcess(openCommand.command, [...openCommand.args], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
