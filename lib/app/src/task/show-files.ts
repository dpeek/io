async function setExcludeFiles(exclude: boolean) {
  const file = Bun.file(".vscode/settings.json");
  const json = (await file.json()) as { "files.exclude": Record<string, boolean> };
  for (const key of Object.keys(json["files.exclude"])) {
    json["files.exclude"][key] = exclude;
  }
  await file.write(JSON.stringify(json, null, 2) + "\n");
}

export async function run() {
  await setExcludeFiles(false);
}
