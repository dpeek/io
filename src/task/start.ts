import { $ } from "bun";

export async function run() {
  await $`portless io vite dev`;
}
