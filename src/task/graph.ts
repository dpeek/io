import { core, coreGraphBootstrapOptions } from "@io/core/graph/modules";
import { pkm } from "@io/core/graph/modules/pkm";
import { createHttpGraphClient } from "@io/graph-client";

export async function run() {
  const client = await createHttpGraphClient(pkm, {
    bootstrap: coreGraphBootstrapOptions,
    definitions: { ...core, ...pkm },
  });
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
