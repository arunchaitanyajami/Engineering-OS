import { githubPatSecretKey } from "../auth/github-auth.js";
import { createGitHubClientFactory } from "../client/github-client-factory.js";
import {
  githubPluginCapabilities,
  githubPluginId,
  type GitHubPluginCapability
} from "../permissions/github-permissions.js";
import { createGitHubMcpRequestHandler } from "./handler.js";

const allReadCapabilities = new Set<GitHubPluginCapability>([
  githubPluginCapabilities.repositoriesRead,
  githubPluginCapabilities.contentsRead,
  githubPluginCapabilities.pullRequestsRead
]);

const readLine = async (): Promise<string | null> => {
  const chunks: Buffer[] = [];

  while (true) {
    const chunk = process.stdin.read() as Buffer | string | null;

    if (chunk === null) {
      await new Promise<void>((resolve) => {
        process.stdin.once("readable", () => resolve());
        process.stdin.once("end", () => resolve());
      });

      if (process.stdin.readableEnded && chunks.length === 0) {
        return null;
      }

      continue;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const newlineIndex = buffer.indexOf(0x0a);

    if (newlineIndex === -1) {
      chunks.push(buffer);
      continue;
    }

    chunks.push(buffer.subarray(0, newlineIndex));
    const leftover = buffer.subarray(newlineIndex + 1);

    if (leftover.length > 0) {
      process.stdin.unshift(leftover);
    }

    return Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
  }
};

const createEnvSecretStore = () => ({
  async get(key: string): Promise<string | null> {
    const envKey = `ENGINEERING_OS_SECRET_${key
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase()}`;
    const value = process.env[envKey] ?? process.env[key];
    return value && value.length > 0 ? value : null;
  }
});

const start = async () => {
  const workspaceId = process.env.ENGINEERING_OS_WORKSPACE_ID?.trim();

  if (!workspaceId) {
    process.stderr.write(
      "GitHub MCP server requires ENGINEERING_OS_WORKSPACE_ID.\n"
    );
    process.exitCode = 1;
    return;
  }

  const factory = createGitHubClientFactory({
    secrets: createEnvSecretStore(),
    connections: {
      async get(input) {
        if (input.workspaceId !== workspaceId) {
          return null;
        }

        return {
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          pluginId: githubPluginId,
          status: "connected",
          authMethod: {
            type: "personal-access-token",
            tokenRef: githubPatSecretKey({
              workspaceId: input.workspaceId,
              connectionId: input.connectionId
            })
          }
        };
      }
    }
  });

  const handleRequest = createGitHubMcpRequestHandler({
    workspaceId,
    githubClientFactory: factory,
    grantedCapabilities: allReadCapabilities
  });

  process.stdin.setEncoding("utf8");

  while (true) {
    const line = await readLine();

    if (line === null) {
      return;
    }

    if (line.trim().length === 0) {
      continue;
    }

    const parsed = JSON.parse(line) as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: unknown;
    };

    if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
      continue;
    }

    const response = await handleRequest({
      jsonrpc: "2.0",
      ...(parsed.id !== undefined ? { id: parsed.id } : {}),
      method: parsed.method,
      ...(parsed.params !== undefined ? { params: parsed.params } : {})
    });

    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
};

void start().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "GitHub MCP server failed."}\n`
  );
  process.exitCode = 1;
});
