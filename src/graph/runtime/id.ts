import { customAlphabet } from "nanoid";

const generateGraphId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export function createGraphId(): string {
  return generateGraphId();
}
