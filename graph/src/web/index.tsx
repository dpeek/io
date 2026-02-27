import React from "react";
import { createRoot } from "react-dom/client";

import { Explorer } from "./explorer.js";
import { Outliner } from "./outliner.js";

const explore = 1;
const app = explore ? <Explorer /> : <Outliner />;

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root mount element");
}

createRoot(root).render(<React.StrictMode>{app}</React.StrictMode>);
