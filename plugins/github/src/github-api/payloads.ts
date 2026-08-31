import { z } from "zod";

export const githubUserPayloadSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    login: z.string().min(1),
    avatar_url: z.string().url().optional()
  })
  .passthrough();

export const githubRepositoryPayloadSchema = z
  .object({
    name: z.string().min(1),
    full_name: z.string().min(1),
    private: z.boolean(),
    html_url: z.string().url(),
    description: z.string().nullable().optional(),
    default_branch: z.string().min(1).optional(),
    owner: z
      .object({
        login: z.string().min(1)
      })
      .passthrough()
  })
  .passthrough();

export const githubGitRefPayloadSchema = z
  .object({
    ref: z.string().min(1),
    sha: z.string().min(1)
  })
  .passthrough();

export const githubPullRequestPayloadSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string().nullable().optional(),
    state: z.enum(["open", "closed"]),
    merged_at: z.string().nullable().optional(),
    html_url: z.string().url(),
    created_at: z.string(),
    updated_at: z.string(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
    changed_files: z.number().int().nonnegative().optional(),
    user: githubUserPayloadSchema.nullable().optional(),
    base: githubGitRefPayloadSchema,
    head: githubGitRefPayloadSchema
  })
  .passthrough();

export const githubPullRequestFilePayloadSchema = z
  .object({
    filename: z.string().min(1),
    previous_filename: z.string().min(1).optional(),
    status: z.string().min(1),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    patch: z.string().optional(),
    filename_encoding: z.string().optional()
  })
  .passthrough();

export const githubFileContentPayloadSchema = z
  .object({
    type: z.string().min(1),
    path: z.string().min(1),
    sha: z.string().min(1),
    size: z.number().int().nonnegative(),
    encoding: z.string().optional(),
    content: z.string().optional()
  })
  .passthrough();

export const githubCommitPayloadSchema = z
  .object({
    sha: z.string().min(1),
    html_url: z.string().url(),
    commit: z
      .object({
        message: z.string(),
        author: z
          .object({
            name: z.string().min(1),
            email: z.string().optional(),
            date: z.string().min(1)
          })
          .passthrough()
      })
      .passthrough(),
    parents: z
      .array(
        z
          .object({
            sha: z.string().min(1)
          })
          .passthrough()
      )
      .optional()
  })
  .passthrough();

export type GitHubRepositoryPayload = z.infer<
  typeof githubRepositoryPayloadSchema
>;
export type GitHubPullRequestPayload = z.infer<
  typeof githubPullRequestPayloadSchema
>;
export type GitHubPullRequestFilePayload = z.infer<
  typeof githubPullRequestFilePayloadSchema
>;
export type GitHubFileContentPayload = z.infer<
  typeof githubFileContentPayloadSchema
>;
export type GitHubCommitPayload = z.infer<typeof githubCommitPayloadSchema>;
