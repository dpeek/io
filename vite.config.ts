import { resolve } from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindPlugin from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({
      persistState: {
        path: resolve("./out/wrangler"),
      },
    }),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/web/routes",
      generatedRouteTree: "./src/web/routeTree.gen.ts",
    }),
    react(),
    tailwindPlugin(),
  ],
  build: {
    outDir: resolve("./out/web"),
  },
  server: {
    watch: {
      // Agent worktrees live under tmp/workspace and should not trigger web
      // dev-server reloads for the main repo checkout.
      ignored: ["**/tmp/workspace/**"],
    },
  },
});
