export function toId(value: string) {
  return value
    .replaceAll(/[^\w/]+/g, " ")
    .trim()
    .replaceAll(/\s+/g, "-")
    .toLowerCase();
}
