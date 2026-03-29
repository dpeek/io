import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@io/web/global.css";
import { router } from "./router";

const container = document.getElementById("app");

if (!container) {
  throw new Error("Missing #app root element.");
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
