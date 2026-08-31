import {
  changedFileSchema,
  commitSchema,
  fileContentSchema,
  pullRequestCommentSchema,
  pullRequestSchema,
  repositorySchema,
  type ChangedFile,
  type Commit,
  type FileContent,
  type PullRequest,
  type PullRequestComment,
  type Repository
} from "@engineering-os/source-control-domain";
import { z } from "zod";

import { githubPluginCapabilities } from "../permissions/github-permissions.js";
import { createToolGitHubClient } from "./create-client.js";
import type { AnyGitHubToolDefinition, GitHubToolDefinition } from "./tool.js";
import {
  connectionIdJsonProperty,
  getCommitToolInputSchema,
  getFileContentToolInputSchema,
  getPullRequestToolInputSchema,
  listPullRequestsToolInputSchema,
  listRepositoriesToolInputSchema,
  ownerJsonProperty,
  repositoryJsonProperty,
  type GetCommitToolInput,
  type GetFileContentToolInput,
  type GetPullRequestToolInput,
  type ListPullRequestsToolInput,
  type ListRepositoriesToolInput
} from "./tool-inputs.js";

const ownerRepositoryJsonProperties = {
  connectionId: connectionIdJsonProperty,
  owner: ownerJsonProperty,
  repository: repositoryJsonProperty
};

export const listRepositoriesTool: GitHubToolDefinition<
  ListRepositoriesToolInput,
  Repository[]
> = {
  name: "github.list_repositories",
  title: "List Repositories",
  description: "List GitHub repositories visible to a workspace connection.",
  capability: githubPluginCapabilities.repositoriesRead,
  inputSchema: listRepositoriesToolInputSchema,
  outputSchema: z.array(repositorySchema),
  jsonInputSchema: {
    type: "object",
    properties: {
      connectionId: connectionIdJsonProperty,
      visibility: {
        type: "string",
        enum: ["all", "public", "private"]
      },
      affiliation: {
        type: "string",
        minLength: 1,
        maxLength: 256
      }
    },
    required: ["connectionId"],
    additionalProperties: false
  },
  async execute(input, context) {
    const client = await createToolGitHubClient(context, input.connectionId);
    return client.listRepositories({
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(input.affiliation ? { affiliation: input.affiliation } : {})
    });
  }
};

export const listPullRequestsTool: GitHubToolDefinition<
  ListPullRequestsToolInput,
  PullRequest[]
> = {
  name: "github.list_pull_requests",
  title: "List Pull Requests",
  description: "List pull requests for a GitHub repository.",
  capability: githubPluginCapabilities.pullRequestsRead,
  inputSchema: listPullRequestsToolInputSchema,
  outputSchema: z.array(pullRequestSchema),
  jsonInputSchema: {
    type: "object",
    properties: {
      ...ownerRepositoryJsonProperties,
      state: {
        type: "string",
        enum: ["open", "closed", "all"]
      }
    },
    required: ["connectionId", "owner", "repository"],
    additionalProperties: false
  },
  async execute(input, context) {
    const client = await createToolGitHubClient(context, input.connectionId);
    return client.listPullRequests({
      owner: input.owner,
      repository: input.repository,
      ...(input.state ? { state: input.state } : {})
    });
  }
};

export const getPullRequestTool: GitHubToolDefinition<
  GetPullRequestToolInput,
  PullRequest
> = {
  name: "github.get_pull_request",
  title: "Get Pull Request",
  description: "Get metadata for a GitHub pull request.",
  capability: githubPluginCapabilities.pullRequestsRead,
  inputSchema: getPullRequestToolInputSchema,
  outputSchema: pullRequestSchema,
  jsonInputSchema: {
    type: "object",
    properties: {
      ...ownerRepositoryJsonProperties,
      pullRequestNumber: {
        type: "integer",
        exclusiveMinimum: 0
      }
    },
    required: ["connectionId", "owner", "repository", "pullRequestNumber"],
    additionalProperties: false
  },
  async execute(input, context) {
    const client = await createToolGitHubClient(context, input.connectionId);
    return client.getPullRequest({
      owner: input.owner,
      repository: input.repository,
      number: input.pullRequestNumber
    });
  }
};

export const getPullRequestFilesTool: GitHubToolDefinition<
  GetPullRequestToolInput,
  ChangedFile[]
> = {
  name: "github.get_pull_request_files",
  title: "Get Pull Request Files",
  description: "Get the changed files for a GitHub pull request.",
  capability: githubPluginCapabilities.pullRequestsRead,
  inputSchema: getPullRequestToolInputSchema,
  outputSchema: z.array(changedFileSchema),
  jsonInputSchema: {
    type: "object",
    properties: {
      ...ownerRepositoryJsonProperties,
      pullRequestNumber: {
        type: "integer",
        exclusiveMinimum: 0
      }
    },
    required: ["connectionId", "owner", "repository", "pullRequestNumber"],
    additionalProperties: false
  },
  async execute(input, context) {
    const client = await createToolGitHubClient(context, input.connectionId);
    return client.getPullRequestFiles({
      owner: input.owner,
      repository: input.repository,
      number: input.pullRequestNumber
    });
  }
};

export const getFileContentTool: GitHubToolDefinition<
  GetFileContentToolInput,
  FileContent
> = {
  name: "github.get_file_content",
  title: "Get File Content",
  description: "Get a file from a GitHub repository at an optional git ref.",
  capability: githubPluginCapabilities.contentsRead,
  inputSchema: getFileContentToolInputSchema,
  outputSchema: fileContentSchema,
  jsonInputSchema: {
    type: "object",
    properties: {
      ...ownerRepositoryJsonProperties,
      path: {
        type: "string",
        minLength: 1,
        maxLength: 2048
      },
      ref: {
        type: "string",
        minLength: 1,
        maxLength: 255
      }
    },
    required: ["connectionId", "owner", "repository", "path"],
    additionalProperties: false
  },
  async execute(input, context) {
    const client = await createToolGitHubClient(context, input.connectionId);
    return client.getFileContent({
      owner: input.owner,
      repository: input.repository,
      path: input.path,
      ...(input.ref ? { ref: input.ref } : {})
    });
  }
};

export const getCommitTool: GitHubToolDefinition<GetCommitToolInput, Commit> = {
  name: "github.get_commit",
  title: "Get Commit",
  description: "Get a GitHub commit by SHA or ref.",
  capability: githubPluginCapabilities.contentsRead,
  inputSchema: getCommitToolInputSchema,
  outputSchema: commitSchema,
  jsonInputSchema: {
    type: "object",
    properties: {
      ...ownerRepositoryJsonProperties,
      ref: {
        type: "string",
        minLength: 1,
        maxLength: 255
      }
    },
    required: ["connectionId", "owner", "repository", "ref"],
    additionalProperties: false
  },
  async execute(input, context) {
    const client = await createToolGitHubClient(context, input.connectionId);
    return client.getCommit({
      owner: input.owner,
      repository: input.repository,
      ref: input.ref
    });
  }
};

export const getPullRequestCommentsTool: GitHubToolDefinition<
  GetPullRequestToolInput,
  PullRequestComment[]
> = {
  name: "github.get_pull_request_comments",
  title: "Get Pull Request Comments",
  description:
    "Get conversation and inline review comments for a GitHub pull request.",
  capability: githubPluginCapabilities.pullRequestsRead,
  inputSchema: getPullRequestToolInputSchema,
  outputSchema: z.array(pullRequestCommentSchema),
  jsonInputSchema: {
    type: "object",
    properties: {
      ...ownerRepositoryJsonProperties,
      pullRequestNumber: {
        type: "integer",
        exclusiveMinimum: 0
      }
    },
    required: ["connectionId", "owner", "repository", "pullRequestNumber"],
    additionalProperties: false
  },
  async execute(input, context) {
    const client = await createToolGitHubClient(context, input.connectionId);
    return client.getPullRequestComments({
      owner: input.owner,
      repository: input.repository,
      number: input.pullRequestNumber
    });
  }
};

export const githubMcpTools: readonly AnyGitHubToolDefinition[] = [
  listRepositoriesTool,
  listPullRequestsTool,
  getPullRequestTool,
  getPullRequestFilesTool,
  getFileContentTool,
  getCommitTool,
  getPullRequestCommentsTool
];
