import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "../components/placeholder-page";

function HomeRoute() {
  return (
    <PlaceholderPage
      eyebrow="Home"
      title="IO on Cloudflare Workers"
      description="This shell now runs as a client-only SPA with TanStack Router, Tailwind, and Worker-backed API endpoints."
    />
  );
}

export const Route = createFileRoute("/")({
  component: HomeRoute,
});
