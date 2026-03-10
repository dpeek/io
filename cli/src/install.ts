import { loadIoConfig } from "@io/lib/config";
import { $ } from "bun";

async function getConfig() {
  const result = await loadIoConfig();
  if (!result.ok) {
    throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  }
  return result.value.config;
}

process.env.HOMEBREW_NO_AUTO_UPDATE = "1";
process.env.HOMEBREW_NO_ENV_HINTS = "1";

async function getInstalledBrews() {
  return new Set((await $`brew list`.text()).split("\n").filter(Boolean));
}

async function installBrews(brews: string[], dryRun = false) {
  const installed = await getInstalledBrews();

  for (const cmd of brews) {
    const full = cmd.split(" ").pop()!;
    const name = full.split("/").pop()!;
    const print = (icon: string) => {
      console.log(`${icon} brew install ${cmd}`);
    };
    if (installed.has(name)) {
      print("⊙");
    } else {
      if (dryRun) {
        print("⊹");
      } else {
        console.log(`brew install ${cmd}`);
        await $`brew install ${cmd}`;
        print("⊙");
      }
    }
  }
}

export async function install(args: string[]) {
  const config = await getConfig();
  await installBrews(config.install.brews, args.includes("--dry-run"));
}
