import { handleExit } from "../lib/index.js";

import { AgentService } from "./service.js";

const service = new AgentService();
await service.start();

handleExit(async () => {
  await service.stop();
});
