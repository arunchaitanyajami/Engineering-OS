import { randomUUID } from "node:crypto";

import type { SecretStore } from "@engineering-os/contracts/unstable-runtime";
import {
  ApplicationDatabase,
  readOptionalString
} from "@engineering-os/database";
import {
  createGitHubClient,
  githubAuthMethodSchema,
  githubPatSecretKey,
  githubPluginId,
  isGitHubPluginError,
  redactSecrets,
  type GitHubAuthMethod,
  type GitHubClientDependencies
} from "@engineering-os/github-plugin";
import type { AuditService } from "@engineering-os/permission-engine";
import type { PluginRegistryService } from "@engineering-os/plugin-registry";
import {
  pluginConnectionSchema,
  pluginConnectionStatusSchema,
  type PluginConnection,
  type PluginConnectionStatus
} from "@engineering-os/source-control-domain";
import { z } from "zod";

import { PluginConnectionError } from "./plugin-connection-error.js";
import { WorkspaceService } from "./workspace-service.js";

const readRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string") {
    throw new Error(`Expected '${fieldName}' to be a string.`);
  }

  return value;
};

export const createGitHubConnectionRequestSchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(100),
    token: z.string().trim().min(8).max(8_192)
  })
  .strict();

export const githubConnectionReferenceRequestSchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(128),
    connectionId: z.string().trim().min(1).max(128)
  })
  .strict();

export type CreateGitHubConnectionRequest = z.infer<
  typeof createGitHubConnectionRequestSchema
>;

export type GitHubConnectionReferenceRequest = z.infer<
  typeof githubConnectionReferenceRequestSchema
>;

export interface GitHubConnectionRecord extends PluginConnection {
  readonly accountLogin: string | null;
  readonly lastError: string | null;
  readonly authMethodType: GitHubAuthMethod["type"];
}

export interface GitHubConnectionServiceOptions {
  readonly database: ApplicationDatabase;
  readonly secretStore: Pick<SecretStore, "get" | "set" | "delete">;
  readonly pluginRegistry: Pick<PluginRegistryService, "getInstalledPlugin">;
  readonly auditService: Pick<AuditService, "record">;
  readonly workspaces: WorkspaceService;
  readonly githubClientDependencies?: GitHubClientDependencies;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

const mapHttpStatusForGitHubCode = (code: string): number => {
  switch (code) {
    case "AUTHENTICATION_FAILED":
      return 401;
    case "PERMISSION_DENIED":
      return 403;
    case "RATE_LIMITED":
      return 429;
    case "VALIDATION_ERROR":
      return 400;
    case "NETWORK_ERROR":
      return 502;
    default:
      return 500;
  }
};

const toPluginConnectionError = (error: unknown): PluginConnectionError => {
  if (error instanceof PluginConnectionError) {
    return error;
  }

  if (isGitHubPluginError(error)) {
    return new PluginConnectionError(
      error.code,
      error.message,
      mapHttpStatusForGitHubCode(error.code),
      { cause: error }
    );
  }

  return new PluginConnectionError(
    "GITHUB_CONNECTION_FAILED",
    "GitHub connection request failed.",
    500,
    { cause: error }
  );
};

const mapConnectionRow = (
  row: Record<string, unknown>
): GitHubConnectionRecord => {
  const authMethod = githubAuthMethodSchema.parse(
    JSON.parse(readRequiredString(row.auth_method_json, "auth_method_json"))
  );
  const connection = pluginConnectionSchema.parse({
    id: readRequiredString(row.id, "id"),
    workspaceId: readRequiredString(row.workspace_id, "workspace_id"),
    pluginId: readRequiredString(row.plugin_id, "plugin_id"),
    displayName: readRequiredString(row.display_name, "display_name"),
    credentialRef: readRequiredString(row.credential_ref, "credential_ref"),
    status: pluginConnectionStatusSchema.parse(row.status),
    createdAt: readRequiredString(row.created_at, "created_at"),
    updatedAt: readRequiredString(row.updated_at, "updated_at")
  });
  const lastError = readOptionalString(row.last_error, "last_error");

  return {
    ...connection,
    accountLogin: readOptionalString(row.account_login, "account_login"),
    lastError: lastError ? redactSecrets(lastError) : null,
    authMethodType: authMethod.type
  };
};

export class GitHubConnectionService {
  constructor(private readonly options: GitHubConnectionServiceOptions) {}

  listConnections(workspaceId: string): readonly GitHubConnectionRecord[] {
    this.options.workspaces.getWorkspace(workspaceId);

    return this.options.database
      .queryAll(
        `
          SELECT
            id,
            workspace_id,
            plugin_id,
            display_name,
            credential_ref,
            status,
            auth_method_json,
            account_login,
            last_error,
            created_at,
            updated_at
          FROM plugin_connections
          WHERE workspace_id = ? AND plugin_id = ?
          ORDER BY updated_at DESC
        `,
        [workspaceId, githubPluginId]
      )
      .map(mapConnectionRow);
  }

  getConnection(
    request: GitHubConnectionReferenceRequest
  ): GitHubConnectionRecord {
    const parsed = githubConnectionReferenceRequestSchema.parse(request);
    this.options.workspaces.getWorkspace(parsed.workspaceId);

    const row = this.options.database.queryFirst(
      `
        SELECT
          id,
          workspace_id,
          plugin_id,
          display_name,
          credential_ref,
          status,
          auth_method_json,
          account_login,
          last_error,
          created_at,
          updated_at
        FROM plugin_connections
        WHERE id = ? AND workspace_id = ? AND plugin_id = ?
      `,
      [parsed.connectionId, parsed.workspaceId, githubPluginId]
    );

    if (!row) {
      throw new PluginConnectionError(
        "GITHUB_CONNECTION_NOT_FOUND",
        "GitHub connection was not found in the active workspace.",
        404
      );
    }

    return mapConnectionRow(row);
  }

  async createConnection(
    request: CreateGitHubConnectionRequest,
    signal?: AbortSignal
  ): Promise<GitHubConnectionRecord> {
    const parsed = createGitHubConnectionRequestSchema.parse(request);
    this.options.workspaces.getWorkspace(parsed.workspaceId);
    this.assertGitHubPluginInstalled();

    const connectionId = (this.options.createId ?? randomUUID)();
    const credentialRef = githubPatSecretKey({
      workspaceId: parsed.workspaceId,
      connectionId
    });
    const authMethod: GitHubAuthMethod = {
      type: "personal-access-token",
      tokenRef: credentialRef
    };

    await this.options.secretStore.set(
      githubPluginId,
      credentialRef,
      parsed.token
    );

    try {
      const account = await this.verifyToken(parsed.token, signal);
      const timestamp = this.timestamp();
      this.options.database.execute(
        `
          INSERT INTO plugin_connections (
            id,
            workspace_id,
            plugin_id,
            display_name,
            credential_ref,
            status,
            auth_method_json,
            account_login,
            last_error,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          connectionId,
          parsed.workspaceId,
          githubPluginId,
          parsed.displayName,
          credentialRef,
          "connected",
          JSON.stringify(authMethod),
          account.login,
          null,
          timestamp,
          timestamp
        ]
      );

      this.options.auditService.record({
        actorType: "user",
        action: "github.connection.create",
        resourceType: "plugin-connection",
        resourceId: connectionId,
        outcome: "success",
        correlationId: parsed.workspaceId,
        metadata: {
          workspaceId: parsed.workspaceId,
          pluginId: githubPluginId,
          accountLogin: account.login
        }
      });

      return this.getConnection({
        workspaceId: parsed.workspaceId,
        connectionId
      });
    } catch (error) {
      await this.options.secretStore.delete(githubPluginId, credentialRef);
      const mapped = toPluginConnectionError(error);

      this.options.auditService.record({
        actorType: "user",
        action: "github.connection.create",
        resourceType: "plugin-connection",
        resourceId: connectionId,
        outcome: "failure",
        correlationId: parsed.workspaceId,
        metadata: {
          workspaceId: parsed.workspaceId,
          pluginId: githubPluginId,
          code: mapped.code
        }
      });

      throw mapped;
    }
  }

  async disconnect(
    request: GitHubConnectionReferenceRequest
  ): Promise<GitHubConnectionRecord> {
    const connection = this.getConnection(request);

    await this.options.secretStore.delete(
      githubPluginId,
      connection.credentialRef
    );
    this.updateConnection(connection.id, connection.workspaceId, {
      status: "disconnected",
      accountLogin: null,
      lastError: null
    });

    this.options.auditService.record({
      actorType: "user",
      action: "github.connection.disconnect",
      resourceType: "plugin-connection",
      resourceId: connection.id,
      outcome: "success",
      correlationId: connection.workspaceId,
      metadata: {
        workspaceId: connection.workspaceId,
        pluginId: githubPluginId
      }
    });

    return this.getConnection({
      workspaceId: connection.workspaceId,
      connectionId: connection.id
    });
  }

  async verifyConnection(
    request: GitHubConnectionReferenceRequest,
    signal?: AbortSignal
  ): Promise<GitHubConnectionRecord> {
    const connection = this.getConnection(request);

    try {
      const token = await this.options.secretStore.get(
        githubPluginId,
        connection.credentialRef
      );

      if (!token) {
        throw new PluginConnectionError(
          "AUTHENTICATION_FAILED",
          "GitHub credential reference could not be resolved.",
          401
        );
      }

      const account = await this.verifyToken(token, signal);
      this.updateConnection(connection.id, connection.workspaceId, {
        status: "connected",
        accountLogin: account.login,
        lastError: null
      });
    } catch (error) {
      const mapped = toPluginConnectionError(error);
      const nextStatus: PluginConnectionStatus =
        mapped.code === "AUTHENTICATION_FAILED" &&
        connection.status === "connected"
          ? "expired"
          : "error";

      this.updateConnection(connection.id, connection.workspaceId, {
        status: nextStatus,
        accountLogin: connection.accountLogin,
        lastError: mapped.message
      });

      throw mapped;
    }

    return this.getConnection({
      workspaceId: connection.workspaceId,
      connectionId: connection.id
    });
  }

  private assertGitHubPluginInstalled(): void {
    const plugin =
      this.options.pluginRegistry.getInstalledPlugin(githubPluginId);

    if (!plugin) {
      throw new PluginConnectionError(
        "GITHUB_PLUGIN_NOT_INSTALLED",
        "Install the GitHub plugin before creating a connection.",
        409
      );
    }
  }

  private async verifyToken(token: string, signal?: AbortSignal) {
    try {
      return await createGitHubClient({
        token,
        ...(this.options.githubClientDependencies
          ? { dependencies: this.options.githubClientDependencies }
          : {}),
        ...(signal ? { signal } : {})
      }).verifyAuthentication();
    } catch (error) {
      throw toPluginConnectionError(error);
    }
  }

  private updateConnection(
    connectionId: string,
    workspaceId: string,
    input: {
      readonly status: PluginConnectionStatus;
      readonly accountLogin: string | null;
      readonly lastError: string | null;
    }
  ): void {
    const timestamp = this.timestamp();

    this.options.database.execute(
      `
        UPDATE plugin_connections
        SET
          status = ?,
          account_login = ?,
          last_error = ?,
          updated_at = ?
        WHERE id = ? AND workspace_id = ? AND plugin_id = ?
      `,
      [
        input.status,
        input.accountLogin,
        input.lastError ? redactSecrets(input.lastError) : null,
        timestamp,
        connectionId,
        workspaceId,
        githubPluginId
      ]
    );
  }

  private timestamp(): string {
    const now = this.options.now ?? (() => new Date());
    return now().toISOString();
  }
}
