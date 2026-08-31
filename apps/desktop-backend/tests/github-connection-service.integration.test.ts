import { afterEach, describe, expect, it } from "vitest";

import { ApplicationDatabase } from "@engineering-os/database";
import { githubPluginId } from "@engineering-os/github-plugin";
import type { InstalledPlugin } from "@engineering-os/plugin-registry";

import { GitHubConnectionService } from "../src/github-connection-service.js";
import { WorkspaceService } from "../src/workspace-service.js";

const testToken = "ghp_testtokenvalue1234567890";
const otherToken = "ghp_othertokenvalue1234567890";

const jsonResponse = (
  body: unknown,
  init: { status?: number } = {}
): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json"
    }
  });

class MemorySecretStore {
  private readonly values = new Map<string, string>();

  private id(namespace: string, key: string): string {
    return `${namespace}:${key}`;
  }

  async get(namespace: string, key: string): Promise<string | null> {
    return this.values.get(this.id(namespace, key)) ?? null;
  }

  async set(namespace: string, key: string, value: string): Promise<void> {
    this.values.set(this.id(namespace, key), value);
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.values.delete(this.id(namespace, key));
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.values.entries());
  }
}

const insertGitHubPlugin = (database: ApplicationDatabase) => {
  const timestamp = "2026-08-31T08:00:00.000Z";

  database.execute(
    `
      INSERT INTO installed_plugins (
        id,
        plugin_id,
        install_root_path,
        installation_mode,
        source_type,
        source_path,
        content_hash,
        manifest_json,
        state,
        enabled,
        installed_at,
        updated_at,
        last_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      "registration-github",
      githubPluginId,
      "/managed/plugins/github/0.1.0",
      "managed",
      "local-directory",
      "/source/plugins/github",
      "abc123",
      JSON.stringify({
        schemaVersion: "1",
        id: githubPluginId,
        name: "GitHub",
        version: "0.1.0",
        description: "GitHub connector",
        publisher: { name: "Engineering OS" },
        engines: { engineeringOs: ">=0.2.0" },
        entrypoints: { backend: "./dist/backend/index.js" },
        capabilities: ["mcp-server", "settings"],
        permissions: [],
        mcp: []
      }),
      "installed",
      1,
      timestamp,
      timestamp,
      null
    ]
  );
};

const createFetchMock = (handler: (url: URL) => Response): typeof fetch => {
  const fetchMock: typeof fetch = async (input) => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

    return handler(url);
  };

  return fetchMock;
};

describe("GitHub connection service", () => {
  const databases: ApplicationDatabase[] = [];

  afterEach(() => {
    databases.forEach((database) => database.close());
    databases.length = 0;
  });

  const createService = (options?: {
    readonly fetch?: typeof fetch;
    readonly pluginInstalled?: boolean;
  }) => {
    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);

    if (options?.pluginInstalled !== false) {
      insertGitHubPlugin(database);
    }

    const secrets = new MemorySecretStore();
    let workspaceCount = 0;
    const workspaces = new WorkspaceService(database, () => {
      workspaceCount += 1;
      return workspaceCount === 1 ? "workspace-a" : "workspace-b";
    });
    let connectionCount = 0;
    const service = new GitHubConnectionService({
      database,
      secretStore: secrets,
      pluginRegistry: {
        getInstalledPlugin: (pluginId) =>
          pluginId === githubPluginId && options?.pluginInstalled !== false
            ? ({ pluginId } as InstalledPlugin)
            : null
      },
      auditService: {
        record: (input) => input as never
      },
      workspaces,
      githubClientDependencies: {
        fetch:
          options?.fetch ??
          createFetchMock(() => jsonResponse({ login: "ada", id: 42 })),
        sleep: async () => undefined
      },
      createId: () => {
        connectionCount += 1;
        return `connection-${connectionCount}`;
      }
    });

    return { database, secrets, service, workspaces };
  };

  it("lets a workspace own a GitHub connection without storing the token", async () => {
    const { secrets, service, workspaces } = createService();
    const workspace = workspaces.createWorkspace({ name: "Company A" });

    const connection = await service.createConnection({
      workspaceId: workspace.id,
      displayName: "Company A GitHub",
      token: testToken
    });

    expect(connection).toMatchObject({
      workspaceId: "workspace-a",
      pluginId: githubPluginId,
      displayName: "Company A GitHub",
      status: "connected",
      accountLogin: "ada",
      lastError: null
    });
    expect(JSON.stringify(connection)).not.toContain(testToken);
    expect(connection.credentialRef).toBe(
      "workspace.workspace-a.connection.connection-1.pat"
    );
    expect(await secrets.get(githubPluginId, connection.credentialRef)).toBe(
      testToken
    );
    expect(JSON.stringify(service.listConnections(workspace.id))).not.toContain(
      testToken
    );
  });

  it("keeps two workspaces isolated", async () => {
    const { secrets, service, workspaces } = createService({
      fetch: createFetchMock((url) => {
        expect(url.pathname).toBe("/user");
        return jsonResponse({ login: "ada", id: 42 });
      })
    });
    const company = workspaces.createWorkspace({ name: "Company A" });
    const personal = workspaces.createWorkspace({ name: "Personal" });

    const companyConnection = await service.createConnection({
      workspaceId: company.id,
      displayName: "Company A GitHub",
      token: testToken
    });
    const personalConnection = await service.createConnection({
      workspaceId: personal.id,
      displayName: "Personal GitHub",
      token: otherToken
    });

    expect(service.listConnections(company.id).map((item) => item.id)).toEqual([
      companyConnection.id
    ]);
    expect(service.listConnections(personal.id).map((item) => item.id)).toEqual(
      [personalConnection.id]
    );

    expect(() =>
      service.getConnection({
        workspaceId: personal.id,
        connectionId: companyConnection.id
      })
    ).toThrow(/not found in the active workspace/i);

    await expect(
      service.disconnect({
        workspaceId: personal.id,
        connectionId: companyConnection.id
      })
    ).rejects.toMatchObject({ code: "GITHUB_CONNECTION_NOT_FOUND" });

    expect(
      await secrets.get(githubPluginId, companyConnection.credentialRef)
    ).toBe(testToken);
    expect(
      await secrets.get(githubPluginId, personalConnection.credentialRef)
    ).toBe(otherToken);
  });

  it("does not persist a connection when authentication fails", async () => {
    const { secrets, service, workspaces } = createService({
      fetch: createFetchMock(() =>
        jsonResponse({ message: "Bad credentials" }, { status: 401 })
      )
    });
    const workspace = workspaces.createWorkspace({ name: "Company A" });

    await expect(
      service.createConnection({
        workspaceId: workspace.id,
        displayName: "Broken GitHub",
        token: testToken
      })
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      statusCode: 401
    });

    expect(service.listConnections(workspace.id)).toEqual([]);
    expect(secrets.snapshot()).toEqual({});
  });

  it("marks a previously connected credential as expired after authentication failure", async () => {
    let failNext = false;
    const { service, workspaces } = createService({
      fetch: createFetchMock(() => {
        if (failNext) {
          return jsonResponse({ message: "Bad credentials" }, { status: 401 });
        }

        return jsonResponse({ login: "ada", id: 42 });
      })
    });
    const workspace = workspaces.createWorkspace({ name: "Company A" });
    const connection = await service.createConnection({
      workspaceId: workspace.id,
      displayName: "Company A GitHub",
      token: testToken
    });

    failNext = true;

    await expect(
      service.verifyConnection({
        workspaceId: workspace.id,
        connectionId: connection.id
      })
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    const updated = service.getConnection({
      workspaceId: workspace.id,
      connectionId: connection.id
    });

    expect(updated.status).toBe("expired");
    expect(updated.lastError).toBe("GitHub authentication failed.");
    expect(JSON.stringify(updated)).not.toContain(testToken);
  });

  it("disconnects a connection and deletes the secret", async () => {
    const { secrets, service, workspaces } = createService();
    const workspace = workspaces.createWorkspace({ name: "Company A" });
    const connection = await service.createConnection({
      workspaceId: workspace.id,
      displayName: "Company A GitHub",
      token: testToken
    });

    const disconnected = await service.disconnect({
      workspaceId: workspace.id,
      connectionId: connection.id
    });

    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.accountLogin).toBeNull();
    expect(await secrets.get(githubPluginId, connection.credentialRef)).toBe(
      null
    );
  });
});
