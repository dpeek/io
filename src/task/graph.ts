import { core, coreGraphBootstrapOptions } from "@io/core/graph/modules";
import { workflow } from "@io/core/graph/modules/workflow";
import { createHttpGraphClient } from "@io/graph-client";

export async function run() {
  const client = await createHttpGraphClient(workflow, {
    bootstrap: coreGraphBootstrapOptions,
    definitions: { ...core, ...workflow },
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
