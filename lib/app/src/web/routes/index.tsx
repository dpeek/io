import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "../components/home-page";

function HomeRoute() {
  return <HomePage />;
}

export const Route = createFileRoute("/")({
  component: HomeRoute,
});
