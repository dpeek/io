import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindPlugin from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    cloudflare({
      persistState: {
        path: fileURLToPath(new URL("./out/wrangler", import.meta.url)),
      },
    }),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: fileURLToPath(new URL("./src/web/routes", import.meta.url)),
      generatedRouteTree: fileURLToPath(new URL("./src/web/routeTree.gen.ts", import.meta.url)),
    }),
    react(),
    tailwindPlugin(),
  ],
  build: {
    outDir: fileURLToPath(new URL("./out/web", import.meta.url)),
  },
  root: appRoot,
});
