import { GitHubPluginError } from "../client/github-errors.js";
import { isAbortError, toAbortError } from "../client/http.js";
import { githubMcpTools } from "./catalog.js";
import type {
  AnyGitHubToolDefinition,
  GitHubToolExecutionContext
} from "./tool.js";

export const executeGitHubTool = async (
  name: string,
  rawInput: unknown,
  context: GitHubToolExecutionContext,
  tools: readonly AnyGitHubToolDefinition[] = githubMcpTools
): Promise<unknown> => {
  if (context.signal?.aborted) {
    throw toAbortError(context.signal);
  }

  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool) {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: `Unknown GitHub MCP tool '${name}'.`,
      retryable: false
    });
  }

  if (!context.grantedCapabilities.has(tool.capability)) {
    throw new GitHubPluginError({
      code: "PERMISSION_DENIED",
      message: `GitHub tool '${tool.name}' requires '${tool.capability}'.`,
      retryable: false
    });
  }

  const parsedInput = tool.inputSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: `Invalid input for GitHub tool '${tool.name}'.`,
      retryable: false
    });
  }

  try {
    const output = await tool.execute(parsedInput.data as never, context);

    if (context.signal?.aborted) {
      throw toAbortError(context.signal);
    }

    return tool.outputSchema.parse(output);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw error;
  }
};
