import { z } from "zod";

export const featureFlagsSchema = z.record(z.string(), z.boolean()).default({});

export const appConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  appName: z.string().min(1).default("Engineering OS"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  databasePath: z.string().min(1).default("./data/engineering-os.sqlite"),
  lancedbPath: z.string().min(1).default("./data/lancedb"),
  featureFlags: featureFlagsSchema,
  desktop: z.object({
    enableDevtools: z.boolean().default(true)
  })
});

export type AppConfig = z.infer<typeof appConfigSchema>;

const parseBoolean = (
  value: string | undefined,
  fallback: boolean
): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return value === "true";
};

const parseFeatureFlags = (
  value: string | undefined
): Record<string, boolean> | undefined => {
  if (!value) {
    return undefined;
  }

  return featureFlagsSchema.parse(JSON.parse(value) as unknown);
};

export const loadAppConfig = (
  environment: NodeJS.ProcessEnv = process.env
): AppConfig =>
  appConfigSchema.parse({
    nodeEnv: environment.NODE_ENV,
    appName: environment.EOS_APP_NAME,
    logLevel: environment.EOS_LOG_LEVEL,
    databasePath: environment.EOS_DATABASE_PATH,
    lancedbPath: environment.EOS_LANCEDB_PATH,
    featureFlags: parseFeatureFlags(environment.EOS_FEATURE_FLAGS),
    desktop: {
      enableDevtools: parseBoolean(environment.EOS_ENABLE_DEVTOOLS, true)
    }
  });
