import type { z } from "zod";

import type { GitHubClientFactory } from "../client/github-client-factory.js";
import type { GitHubPluginCapability } from "../permissions/github-permissions.js";

export interface GitHubToolExecutionContext {
  readonly workspaceId: string;
  readonly githubClientFactory: GitHubClientFactory;
  readonly grantedCapabilities: ReadonlySet<GitHubPluginCapability>;
  readonly signal?: AbortSignal;
}

export interface GitHubToolDefinition<TInput = never, TOutput = unknown> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly capability: GitHubPluginCapability;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly jsonInputSchema: Record<string, unknown>;
  readonly execute: (
    input: TInput,
    context: GitHubToolExecutionContext
  ) => Promise<TOutput>;
}

export type AnyGitHubToolDefinition = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly capability: GitHubPluginCapability;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  readonly jsonInputSchema: Record<string, unknown>;
  readonly execute: (
    input: never,
    context: GitHubToolExecutionContext
  ) => Promise<unknown>;
};
