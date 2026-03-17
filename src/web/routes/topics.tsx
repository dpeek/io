import { createFileRoute } from "@tanstack/react-router";

import { TopicBrowserPage } from "../components/topic-browser-page";

function TopicsRoute() {
  return <TopicBrowserPage />;
}

export const Route = createFileRoute("/topics")({
  component: TopicsRoute,
});
