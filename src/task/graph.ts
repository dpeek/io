import { pkm } from "@io/core/graph/modules/pkm";

import { createHttpGraphClient } from "../graph/runtime/index.js";

export async function run() {
  const client = await createHttpGraphClient(pkm);
  const documents = await client.graph.document.query({
    select: {
      description: true,
      id: true,
      name: true,
      slug: true,
    },
  });

  console.log(documents);
}
