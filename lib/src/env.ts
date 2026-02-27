import z from "zod/v4";

export function env<T extends z.ZodType>(key: string, schema: T) {
  const global = globalThis as any;
  let value: z.infer<T> | undefined;
  return {
    get value() {
      if (value !== undefined) {
        return value;
      }
      const raw = global.process?.env?.[key];
      try {
        value = schema.parse(raw);
        return value;
      } catch {
        if (raw === undefined) {
          throw new Error(`Environment variable ${key} is not set`);
        }
        throw new Error(`Environment variable ${key} is invalid (${raw})`);
      }
    },
  };
}

export class EnvError extends Error {
  constructor(key: string, description: string) {
    super(`Missing environment variable: ${key} (${description})`);
    this.name = "MissingConfigError";
  }
}

export function getEnvOrThrow(key: string, description: string) {
  const value = process.env[key];
  if (!value) {
    throw new EnvError(key, description);
  }
  return value;
}
