import type {
  ChangedFile,
  Commit,
  FileContent,
  PullRequest,
  PullRequestComment,
  Repository
} from "@engineering-os/source-control-domain";
import { z } from "zod";

import type { GitHubRateLimit } from "./rate-limit.js";

export const listRepositoriesInputSchema = z
  .object({
    visibility: z.enum(["all", "public", "private"]).optional(),
    affiliation: z.string().trim().min(1).max(256).optional()
  })
  .strict();

export type ListRepositoriesInput = z.infer<typeof listRepositoriesInputSchema>;

export const listPullRequestsInputSchema = z
  .object({
    owner: z.string().trim().min(1).max(128),
    repository: z.string().trim().min(1).max(128),
    state: z.enum(["open", "closed", "all"]).optional()
  })
  .strict();

export type ListPullRequestsInput = z.infer<typeof listPullRequestsInputSchema>;

export const getPullRequestInputSchema = z
  .object({
    owner: z.string().trim().min(1).max(128),
    repository: z.string().trim().min(1).max(128),
    number: z.number().int().positive()
  })
  .strict();

export type GetPullRequestInput = z.infer<typeof getPullRequestInputSchema>;

export type GetPullRequestFilesInput = GetPullRequestInput;

export const getFileContentInputSchema = z
  .object({
    owner: z.string().trim().min(1).max(128),
    repository: z.string().trim().min(1).max(128),
    path: z.string().trim().min(1).max(2_048),
    ref: z.string().trim().min(1).max(255).optional()
  })
  .strict();

export type GetFileContentInput = z.infer<typeof getFileContentInputSchema>;

export const getCommitInputSchema = z
  .object({
    owner: z.string().trim().min(1).max(128),
    repository: z.string().trim().min(1).max(128),
    ref: z.string().trim().min(1).max(255)
  })
  .strict();

export type GetCommitInput = z.infer<typeof getCommitInputSchema>;

export type GetPullRequestCommentsInput = GetPullRequestInput;

export interface GitHubClient {
  listRepositories(input?: ListRepositoriesInput): Promise<Repository[]>;
  listPullRequests(input: ListPullRequestsInput): Promise<PullRequest[]>;
  getPullRequest(input: GetPullRequestInput): Promise<PullRequest>;
  getPullRequestFiles(input: GetPullRequestFilesInput): Promise<ChangedFile[]>;
  getFileContent(input: GetFileContentInput): Promise<FileContent>;
  getCommit(input: GetCommitInput): Promise<Commit>;
  getPullRequestComments(
    input: GetPullRequestCommentsInput
  ): Promise<PullRequestComment[]>;
  getRateLimit(): GitHubRateLimit | null;
}
