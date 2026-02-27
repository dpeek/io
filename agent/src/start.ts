import { handleExit } from "@io/lib";

import { AgentService } from "./service.js";

const service = new AgentService();
await service.start();

handleExit(async () => {
  await service.stop();
});
