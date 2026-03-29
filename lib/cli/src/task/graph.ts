import { createHttpGraphClient } from "@io/graph-client";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";

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
