import { z } from "zod";

export const sourceControlProviders = ["github"] as const;

export const sourceControlProviderSchema = z.enum(sourceControlProviders);

export type SourceControlProvider = z.infer<typeof sourceControlProviderSchema>;
