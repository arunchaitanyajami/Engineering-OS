import semver from "semver";

import type { Brand } from "@engineering-os/shared";
import { z } from "zod";

export type PluginId = Brand<string, "PluginId">;
export type PermissionScope = Brand<string, "PermissionScope">;

export const pluginId = (value: string): PluginId => value as PluginId;
export const permissionScope = (value: string): PermissionScope =>
  value as PermissionScope;

export const displayNameSchema = z.string().trim().min(1).max(100);
export const descriptionSchema = z.string().trim().min(1).max(2_000);
export const permissionReasonSchema = z.string().trim().min(10).max(500);
export const commandTextSchema = z.string().trim().min(1).max(512);
export const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const pluginIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+){2,}$/);
export const genericPathSchema = z.string().trim().min(1).max(2_048);
export const packageRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) => !isAbsolutePathLike(value),
    "Package-relative paths must not be absolute."
  )
  .refine(
    (value) => !hasTraversalSegments(value),
    "Package-relative paths must not contain '..' segments."
  );
export const hostPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !value.includes("://"),
    "Host patterns must not include a protocol."
  );
export const semanticVersionSchema = z
  .string()
  .trim()
  .refine(
    (value) => semver.valid(value) !== null,
    "Must be a valid semantic version."
  );
export const semanticVersionRangeSchema = z
  .string()
  .trim()
  .refine(
    (value) => semver.validRange(value) !== null,
    "Must be a valid semantic version range."
  );
export const isoTimestampSchema = z.string().datetime({ offset: true });
export const jsonObjectSchema = z.record(z.string(), z.unknown());

export const isAbsolutePathLike = (value: string): boolean =>
  value.startsWith("/") ||
  value.startsWith("\\\\") ||
  /^[a-zA-Z]:[\\/]/.test(value);
export const hasTraversalSegments = (value: string): boolean =>
  value.split(/[\\/]+/).includes("..");

export const knownPluginCapabilities = [
  "mcp-server",
  "settings",
  "background-worker",
  "resource-provider",
  "prompt-provider",
  "tool-provider"
] as const;

export const pluginCapabilitySchema = z.enum(knownPluginCapabilities);
export type PluginCapability = z.infer<typeof pluginCapabilitySchema>;

export const pluginPermissionScopes = [
  "filesystem.read",
  "filesystem.write",
  "filesystem.watch",
  "network.access",
  "process.spawn",
  "secrets.read",
  "secrets.write",
  "notifications.show",
  "clipboard.read",
  "clipboard.write",
  "external-url.open",
  "mcp.register-server",
  "tool.execute",
  "workflow.register",
  "agent.register",
  "ui.register-view"
] as const;

export const permissionScopeSchema = z.enum(pluginPermissionScopes);

export const pluginPublisherSchema = z
  .object({
    name: displayNameSchema,
    url: z.string().trim().url().optional()
  })
  .strict();

export type PluginPublisher = z.infer<typeof pluginPublisherSchema>;

export const pluginEntrypointsSchema = z
  .object({
    backend: packageRelativePathSchema
  })
  .strict();

export type PluginEntrypoints = z.infer<typeof pluginEntrypointsSchema>;

export const pluginConfigurationSchemaSchema = jsonObjectSchema;
export type PluginConfigurationSchema = z.infer<
  typeof pluginConfigurationSchemaSchema
>;

export const pluginSecretReferenceSchema = z
  .object({
    key: keySchema
  })
  .strict();

export type PluginSecretReference = z.infer<typeof pluginSecretReferenceSchema>;

const pluginEnvironmentValueSchema = z.union([
  commandTextSchema,
  pluginSecretReferenceSchema
]);

export const filesystemPathConstraintSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("workspace")
    })
    .strict(),
  z
    .object({
      type: z.literal("user-selected")
    })
    .strict(),
  z
    .object({
      type: z.literal("plugin-data")
    })
    .strict(),
  z
    .object({
      type: z.literal("explicit"),
      path: genericPathSchema.refine(
        (value) => isAbsolutePathLike(value),
        "Explicit filesystem paths must be absolute."
      )
    })
    .strict()
]);

export type FilesystemPathConstraint = z.infer<
  typeof filesystemPathConstraintSchema
>;

const filesystemPermissionScopeSchema = z.enum([
  "filesystem.read",
  "filesystem.write",
  "filesystem.watch"
] as const);
const simplePermissionScopeSchema = z.enum([
  "process.spawn",
  "secrets.read",
  "secrets.write",
  "notifications.show",
  "clipboard.read",
  "clipboard.write",
  "external-url.open",
  "mcp.register-server",
  "tool.execute",
  "workflow.register",
  "agent.register",
  "ui.register-view"
] as const);

const filesystemPermissionRequestSchema = z
  .object({
    scope: filesystemPermissionScopeSchema,
    reason: permissionReasonSchema,
    paths: z.array(filesystemPathConstraintSchema).min(1)
  })
  .strict();

const networkPermissionRequestSchema = z
  .object({
    scope: z.literal("network.access"),
    reason: permissionReasonSchema,
    hosts: z.array(hostPatternSchema).min(1)
  })
  .strict();

const simplePermissionRequestSchema = z
  .object({
    scope: simplePermissionScopeSchema,
    reason: permissionReasonSchema
  })
  .strict();

export const pluginPermissionRequestSchema = z.union([
  filesystemPermissionRequestSchema,
  networkPermissionRequestSchema,
  simplePermissionRequestSchema
]);

export type PluginPermissionRequest = z.infer<
  typeof pluginPermissionRequestSchema
>;

export const mcpServerDefinitionSchema = z
  .object({
    id: identifierSchema,
    name: displayNameSchema.optional(),
    transport: z.literal("stdio"),
    command: commandTextSchema,
    args: z.array(commandTextSchema).default([]),
    cwd: packageRelativePathSchema.optional(),
    env: z.record(z.string(), pluginEnvironmentValueSchema).optional(),
    timeoutMs: z.number().int().positive().max(300_000).optional()
  })
  .strict();

export type McpServerDefinition = z.infer<typeof mcpServerDefinitionSchema>;

export const pluginManifestSchema = z
  .object({
    schemaVersion: z.literal("1"),
    id: pluginIdSchema,
    name: displayNameSchema,
    version: semanticVersionSchema,
    description: descriptionSchema,
    publisher: pluginPublisherSchema,
    engines: z
      .object({
        engineeringOs: semanticVersionRangeSchema
      })
      .strict(),
    entrypoints: pluginEntrypointsSchema,
    capabilities: z.array(pluginCapabilitySchema).default([]),
    permissions: z.array(pluginPermissionRequestSchema).default([]),
    configuration: pluginConfigurationSchemaSchema.optional(),
    mcp: z.array(mcpServerDefinitionSchema).default([])
  })
  .strict()
  .superRefine((manifest, context) => {
    const addDuplicateIssues = (
      values: readonly string[],
      path: (string | number)[],
      label: string
    ) => {
      const seen = new Set<string>();

      for (const value of values) {
        if (seen.has(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `${label} must not contain duplicate values.`
          });
          return;
        }

        seen.add(value);
      }
    };

    addDuplicateIssues(manifest.capabilities, ["capabilities"], "Capabilities");
    addDuplicateIssues(
      manifest.permissions.map((permission) => permission.scope),
      ["permissions"],
      "Permissions"
    );
    addDuplicateIssues(
      manifest.mcp.map((server) => server.id),
      ["mcp"],
      "MCP server declarations"
    );

    if (manifest.mcp.length === 0) {
      return;
    }

    const permissionScopes = new Set(
      manifest.permissions.map((permission) => permission.scope)
    );

    if (!manifest.capabilities.includes("mcp-server")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities"],
        message: "Plugins declaring MCP servers require mcp-server capability."
      });
    }

    if (!permissionScopes.has("process.spawn")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions"],
        message: "Bundled stdio MCP servers require process.spawn."
      });
    }

    if (!permissionScopes.has("mcp.register-server")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions"],
        message: "MCP server declarations require mcp.register-server."
      });
    }
  });

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
