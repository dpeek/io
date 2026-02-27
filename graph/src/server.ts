import page from "./web/index.html";

Bun.serve({
  routes: {
    "/*": page,
  },
});
