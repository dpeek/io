import React from "react";
import { createRoot } from "react-dom/client";

import { CompanyQueryProofPage } from "./company-query-proof.js";
import { CompanyProofPage } from "./company-proof.js";
import { Explorer } from "./explorer.js";
import { Outliner } from "./outliner.js";
import { RelationshipProofPage } from "./relationship-proof.js";

function resolveSurface() {
  const params = new URLSearchParams(window.location.search);
  const surface = params.get("surface");

  if (surface === "company") return <CompanyProofPage />;
  if (surface === "explorer") return <Explorer />;
  if (surface === "outliner") return <Outliner />;
  if (surface === "query") return <CompanyQueryProofPage />;
  if (surface === "relationships") return <RelationshipProofPage />;
  return <CompanyProofPage />;
}

const app = resolveSurface();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root mount element");
}

createRoot(root).render(<React.StrictMode>{app}</React.StrictMode>);
