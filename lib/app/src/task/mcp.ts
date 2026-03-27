import { runMcpCli } from "../mcp/index.js";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function run(args: string[]) {
  try {
    await runMcpCli(args);
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}
