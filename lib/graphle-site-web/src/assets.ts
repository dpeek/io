import { fileURLToPath } from "node:url";

export const graphleSiteWebClientAssetsPath = fileURLToPath(new URL("./client/", import.meta.url));
