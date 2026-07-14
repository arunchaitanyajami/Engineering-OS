import { z } from "zod";

export const featureFlagsSchema = z.record(z.string(), z.boolean()).default({});

export const themePreferenceSchema = z.enum(["system", "light", "dark"]);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export interface ApplicationSettings {
  readonly theme: ThemePreference;
  readonly telemetryEnabled: boolean;
  readonly autoUpdateEnabled: boolean;
  readonly minimizeToTray: boolean;
  readonly launchOnStartup: boolean;
  readonly developerMode: boolean;
}

export interface PersistedApplicationConfig {
  readonly schemaVersion: number;
  readonly settings: ApplicationSettings;
}

export interface ConfigurationStorageAdapter {
  load(): Promise<string | null>;
  save(serializedConfig: string): Promise<void>;
}

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

const applicationSettingsSchema = z.object({
  theme: themePreferenceSchema.default("system"),
  telemetryEnabled: z.boolean().default(false),
  autoUpdateEnabled: z.boolean().default(false),
  minimizeToTray: z.boolean().default(false),
  launchOnStartup: z.boolean().default(false),
  developerMode: z.boolean().default(false)
});

const persistedApplicationConfigSchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
  settings: applicationSettingsSchema
});

export const applicationConfigSchemaVersion = 1;

export const defaultApplicationSettings: ApplicationSettings =
  applicationSettingsSchema.parse({});

export const defaultPersistedApplicationConfig: PersistedApplicationConfig =
  persistedApplicationConfigSchema.parse({
    schemaVersion: applicationConfigSchemaVersion,
    settings: defaultApplicationSettings
  });

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

const isLegacySettingsObject = (
  value: unknown
): value is Partial<ApplicationSettings> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return (
    "theme" in value ||
    "telemetryEnabled" in value ||
    "autoUpdateEnabled" in value ||
    "minimizeToTray" in value ||
    "launchOnStartup" in value ||
    "developerMode" in value
  );
};

export const migratePersistedApplicationConfig = (
  value: unknown
): PersistedApplicationConfig => {
  const parsed = persistedApplicationConfigSchema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  if (isLegacySettingsObject(value)) {
    return persistedApplicationConfigSchema.parse({
      schemaVersion: applicationConfigSchemaVersion,
      settings: {
        ...defaultApplicationSettings,
        ...value
      }
    });
  }

  return defaultPersistedApplicationConfig;
};

export const serializePersistedApplicationConfig = (
  config: PersistedApplicationConfig
): string => JSON.stringify(config, null, 2);

export const resolveThemeMode = (
  preference: ThemePreference,
  systemPrefersDark: boolean
): "light" | "dark" => {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return preference;
};

export class ApplicationConfigStore {
  constructor(private readonly storage: ConfigurationStorageAdapter) {}

  async load(): Promise<PersistedApplicationConfig> {
    const serializedConfig = await this.storage.load();

    if (!serializedConfig) {
      return defaultPersistedApplicationConfig;
    }

    try {
      return migratePersistedApplicationConfig(
        JSON.parse(serializedConfig) as unknown
      );
    } catch {
      return defaultPersistedApplicationConfig;
    }
  }

  async save(config: PersistedApplicationConfig): Promise<void> {
    await this.storage.save(serializePersistedApplicationConfig(config));
  }

  async updateSettings(
    partialSettings: Partial<ApplicationSettings>
  ): Promise<PersistedApplicationConfig> {
    const currentConfig = await this.load();
    const nextConfig = persistedApplicationConfigSchema.parse({
      schemaVersion: applicationConfigSchemaVersion,
      settings: {
        ...currentConfig.settings,
        ...partialSettings
      }
    });

    await this.save(nextConfig);

    return nextConfig;
  }
}
