const vscodeSettings = {
  "editor.defaultFormatter": "oxc.oxc-vscode",
  "editor.formatOnSave": true,
  "editor.formatOnSaveMode": "file",
  "typescript.preferences.importModuleSpecifierEnding": "js",
  "typescript.reportStyleChecksAsWarnings": false,
  "typescript.updateImportsOnFileMove.enabled": "always",
  "typescript.experimental.useTsgo": true,
  "oxc.enable": true,
  "explorer.confirmDragAndDrop": false,
  "explorer.confirmDelete": false,
  "workbench.startupEditor": "none",
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "files.exclude": {
    "**/.vscode": true,
    "**/node_modules": true,
    "**/.oxlintrc.json": true,
    "**/.oxfmtrc.json": true,
    "**/bun.lock": true,
    "**/.gitignore": true,
    "**/tsconfig.json": true,
    "**/package.json": true,
    "**/bunfig.toml": true,
    "**/.env": true,
    "**/components.json": true,
    "**/tmp": true,
    "**/skills-lock.json": true,
    "**/.agents": true,
  },
};

const vscodeExtentions = {
  recommendations: ["oxc.oxc-vscode", "typescriptteam.native-preview"],
};

const oxfmtSettings = {
  ignorePatterns: [],
  experimentalSortImports: {},
  experimentalTailwindcss: {},
};

const oxlintSettings = {
  plugins: null,
  categories: {},
  rules: {},
  settings: {
    "jsx-a11y": {
      polymorphicPropName: null,
      components: {},
      attributes: {},
    },
    next: {
      rootDir: [],
    },
    react: {
      formComponents: [],
      linkComponents: [],
      version: null,
      componentWrapperFunctions: [],
    },
    jsdoc: {
      ignorePrivate: false,
      ignoreInternal: false,
      ignoreReplacesDocs: true,
      overrideReplacesDocs: true,
      augmentsExtendsReplacesDocs: false,
      implementsReplacesDocs: false,
      exemptDestructuredRootsFromChecks: false,
      tagNamePreference: {},
    },
    vitest: {
      typecheck: false,
    },
  },
  env: {
    builtin: true,
  },
  globals: {},
  ignorePatterns: [],
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
  await Bun.write(".oxfmtrc.json", JSON.stringify(oxfmtSettings, null, 2) + "\n");
  await Bun.write(".oxlintrc.json", JSON.stringify(oxlintSettings, null, 2) + "\n");
  await Bun.write(".gitignore", gitignore);
}
