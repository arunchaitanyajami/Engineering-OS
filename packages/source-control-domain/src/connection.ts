import { z } from "zod";

import {
  isoTimestampSchema,
  nonEmptyIdSchema,
  trimmedTextSchema
} from "./primitives.js";

export const pluginConnectionStatusSchema = z.enum([
  "connected",
  "disconnected",
  "expired",
  "error"
]);

export type PluginConnectionStatus = z.infer<
  typeof pluginConnectionStatusSchema
>;

export const sourceControlConnectionReferenceSchema = z
  .object({
    workspaceId: nonEmptyIdSchema,
    pluginId: nonEmptyIdSchema,
    connectionId: nonEmptyIdSchema
  })
  .strict();

export type SourceControlConnectionReference = z.infer<
  typeof sourceControlConnectionReferenceSchema
>;

export const pluginConnectionSchema = z
  .object({
    id: nonEmptyIdSchema,
    workspaceId: nonEmptyIdSchema,
    pluginId: nonEmptyIdSchema,
    displayName: trimmedTextSchema(100),
    credentialRef: trimmedTextSchema(256),
    status: pluginConnectionStatusSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema
  })
  .strict();

export type PluginConnection = z.infer<typeof pluginConnectionSchema>;
