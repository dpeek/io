const vscodeSettings = {
  "editor.defaultFormatter": "oxc.oxc-vscode",
  "oxc.fmt.configPath": "./.oxfmtrc.json",
  "editor.formatOnSave": true,
  "editor.formatOnSaveMode": "file",
  "editor.codeActionsOnSave": {
    "source.fixAll.oxc": "explicit",
  },
  "typescript.preferences.importModuleSpecifierEnding": "js",
  "typescript.reportStyleChecksAsWarnings": false,
  "typescript.updateImportsOnFileMove.enabled": "always",
  "typescript.experimental.useTsgo": true,
  "explorer.confirmDragAndDrop": false,
  "explorer.confirmDelete": false,
  "workbench.startupEditor": "none",
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "files.exclude": {
    "**/.vscode": false,
    "**/node_modules": false,
    "**/bun.lock": false,
    "**/.gitignore": false,
    "**/tsconfig.json": false,
    "**/package.json": false,
    "**/bunfig.toml": false,
    "**/.env": false,
    "**/tmp": false,
  },
};

const vscodeExtentions = {
  recommendations: ["typescriptteam.native-preview", "VoidZero.vite-plus-extension-pack"],
};

const gitignore = `out
.DS_Store
node_modules
.env
out
tmp
dist
.wrangler
.tanstack
.gitnexus
.claude
`;

export async function run() {
  await Bun.write(".vscode/settings.json", JSON.stringify(vscodeSettings, null, 2) + "\n");
  await Bun.write(".vscode/extensions.json", JSON.stringify(vscodeExtentions, null, 2) + "\n");
  await Bun.write(".gitignore", gitignore);
}
