#! /usr/bin/env bun

const tsconfig = {
  compilerOptions: {
    allowJs: true,
    esModuleInterop: true,
    isolatedModules: true,
    jsx: "react-jsx",
    lib: ["ESNext", "DOM", "DOM.Iterable"],
    module: "preserve",
    moduleDetection: "force",
    moduleResolution: "bundler",
    noImplicitOverride: true,
    noUncheckedIndexedAccess: true,
    noUnusedLocals: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    target: "ESNext",
    verbatimModuleSyntax: true,
  },
};

await Bun.file("tsconfig.json").write(JSON.stringify(tsconfig, null, 2));
