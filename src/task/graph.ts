import { app } from "@io/core/graph/schema/app";

import { createHttpGraphClient } from "../graph/index.js";

export async function run() {
  const client = await createHttpGraphClient(app);
  const topics = await client.graph.topic.query({
    select: {
      content: true,
      id: true,
      name: true,
    },
  });

  console.log(topics);
}
