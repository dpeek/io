import { resolve } from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindPlugin from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  run: {
    cache: {
      scripts: true,
    },
  },
  plugins: [
    cloudflare({
      persistState: {
        path: resolve("./out/wrangler"),
      },
    }),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./lib/app/src/web/routes",
      generatedRouteTree: "./lib/app/src/web/routeTree.gen.ts",
    }),
    react(),
    tailwindPlugin(),
  ],
  build: {
    outDir: resolve("./out/web"),
  },
  fmt: {
    ignorePatterns: ["*.gen.ts", "**/out/**"],
  },
  lint: {
    ignorePatterns: ["*.gen.ts", "**/out/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "typescript/await-thenable": "off",
      "typescript/unbound-method": "off",
      "typescript/no-base-to-string": "off",
    },
  },
});
