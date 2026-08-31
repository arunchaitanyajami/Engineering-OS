import {
  GitHubPluginError,
  isGitHubPluginError
} from "../client/github-errors.js";
import { isAbortError } from "../client/http.js";
import { githubMcpTools } from "../tools/catalog.js";
import { executeGitHubTool } from "../tools/execute-tool.js";
import type { GitHubToolExecutionContext } from "../tools/tool.js";

export interface GitHubMcpJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

export interface GitHubMcpJsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result: unknown;
}

export interface GitHubMcpJsonRpcError {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type GitHubMcpJsonRpcResponse =
  GitHubMcpJsonRpcSuccess | GitHubMcpJsonRpcError;

const protocolVersion = "2025-06-18";

export const listGitHubMcpToolDescriptors = () =>
  githubMcpTools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.jsonInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      title: tool.title
    }
  }));

export const createGitHubMcpRequestHandler = (
  context: GitHubToolExecutionContext
) => {
  return async (
    request: GitHubMcpJsonRpcRequest
  ): Promise<GitHubMcpJsonRpcResponse | undefined> => {
    if (request.method === "notifications/initialized") {
      return undefined;
    }

    const requestId = request.id ?? null;

    try {
      switch (request.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id: requestId,
            result: {
              protocolVersion,
              capabilities: {
                tools: {}
              },
              serverInfo: {
                name: "engineering-os-github",
                version: "0.1.0"
              }
            }
          };
        case "ping":
          return { jsonrpc: "2.0", id: requestId, result: {} };
        case "tools/list":
          return {
            jsonrpc: "2.0",
            id: requestId,
            result: {
              tools: listGitHubMcpToolDescriptors()
            }
          };
        case "tools/call": {
          const params = parseToolCallParams(request.params);
          const output = await executeGitHubTool(
            params.name,
            params.arguments,
            context
          );

          return {
            jsonrpc: "2.0",
            id: requestId,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(output)
                }
              ],
              structuredContent: output,
              isError: false
            }
          };
        }
        default:
          return {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`
            }
          };
      }
    } catch (error) {
      if (isAbortError(error)) {
        return {
          jsonrpc: "2.0",
          id: requestId,
          error: {
            code: -32800,
            message: "GitHub tool execution was cancelled."
          }
        };
      }

      if (isGitHubPluginError(error)) {
        return {
          jsonrpc: "2.0",
          id: requestId,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: error.code,
                  message: error.message,
                  retryable: error.retryable
                })
              }
            ],
            isError: true
          }
        };
      }

      return {
        jsonrpc: "2.0",
        id: requestId,
        error: {
          code: -32603,
          message:
            error instanceof Error
              ? error.message
              : "GitHub MCP request failed."
        }
      };
    }
  };
};

const parseToolCallParams = (
  params: unknown
): { name: string; arguments: unknown } => {
  if (
    typeof params !== "object" ||
    params === null ||
    !("name" in params) ||
    typeof params.name !== "string"
  ) {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: "GitHub MCP tool call is missing a tool name.",
      retryable: false
    });
  }

  return {
    name: params.name,
    arguments:
      "arguments" in params && params.arguments !== undefined
        ? params.arguments
        : {}
  };
};
