import "@dpeek/graphle-web-ui/global.css";
import "@dpeek/graphle-web-shell/shell.css";
import "./site-app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { GraphleSiteApp } from "./site-app.js";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Graphle site web root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <GraphleSiteApp />
  </StrictMode>,
);
