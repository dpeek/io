declare module "*.svg?raw" {
  const content: string;
  export default content;
}

declare module "*.css";

declare module "better-sqlite3" {
  export default class Database {
    constructor(path?: string, options?: Record<string, unknown>);
  }
}
