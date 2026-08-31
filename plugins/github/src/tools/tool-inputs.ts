import { z } from "zod";

import { nonEmptyIdSchema } from "@engineering-os/source-control-domain";

export const githubToolConnectionIdField = {
  connectionId: nonEmptyIdSchema
};

const ownerRepositoryFields = {
  owner: z.string().trim().min(1).max(128),
  repository: z.string().trim().min(1).max(128)
};

export const listRepositoriesToolInputSchema = z
  .object({
    ...githubToolConnectionIdField,
    visibility: z.enum(["all", "public", "private"]).optional(),
    affiliation: z.string().trim().min(1).max(256).optional()
  })
  .strict();

export type ListRepositoriesToolInput = z.infer<
  typeof listRepositoriesToolInputSchema
>;

export const listPullRequestsToolInputSchema = z
  .object({
    ...githubToolConnectionIdField,
    ...ownerRepositoryFields,
    state: z.enum(["open", "closed", "all"]).optional()
  })
  .strict();

export type ListPullRequestsToolInput = z.infer<
  typeof listPullRequestsToolInputSchema
>;

export const getPullRequestToolInputSchema = z
  .object({
    ...githubToolConnectionIdField,
    ...ownerRepositoryFields,
    pullRequestNumber: z.number().int().positive()
  })
  .strict();

export type GetPullRequestToolInput = z.infer<
  typeof getPullRequestToolInputSchema
>;

export const getFileContentToolInputSchema = z
  .object({
    ...githubToolConnectionIdField,
    ...ownerRepositoryFields,
    path: z.string().trim().min(1).max(2_048),
    ref: z.string().trim().min(1).max(255).optional()
  })
  .strict();

export type GetFileContentToolInput = z.infer<
  typeof getFileContentToolInputSchema
>;

export const getCommitToolInputSchema = z
  .object({
    ...githubToolConnectionIdField,
    ...ownerRepositoryFields,
    ref: z.string().trim().min(1).max(255)
  })
  .strict();

export type GetCommitToolInput = z.infer<typeof getCommitToolInputSchema>;

export const connectionIdJsonProperty = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  description: "Workspace-scoped GitHub connection identifier."
};

export const ownerJsonProperty = {
  type: "string",
  minLength: 1,
  maxLength: 128
};

export const repositoryJsonProperty = {
  type: "string",
  minLength: 1,
  maxLength: 128
};
