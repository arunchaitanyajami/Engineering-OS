import { z } from "zod";

import { gitReferenceSchema } from "./git-reference.js";
import {
  gitShaSchema,
  httpUrlSchema,
  isoTimestampSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  trimmedTextSchema
} from "./primitives.js";
import { sourceControlProviderSchema } from "./provider.js";
import { repositoryIdentitySchema } from "./repository.js";

export const pullRequestStates = ["open", "closed", "merged"] as const;

export const pullRequestStateSchema = z.enum(pullRequestStates);

export type PullRequestState = z.infer<typeof pullRequestStateSchema>;

export const pullRequestAuthorSchema = z
  .object({
    id: trimmedTextSchema(128),
    username: trimmedTextSchema(128),
    avatarUrl: httpUrlSchema.optional()
  })
  .strict();

export type PullRequestAuthor = z.infer<typeof pullRequestAuthorSchema>;

export const pullRequestReferenceSchema = z
  .object({
    provider: sourceControlProviderSchema,
    owner: repositoryIdentitySchema.shape.owner,
    name: repositoryIdentitySchema.shape.name,
    number: positiveIntSchema,
    headSha: gitShaSchema
  })
  .strict();

export type PullRequestReference = z.infer<typeof pullRequestReferenceSchema>;

export const pullRequestSchema = z
  .object({
    provider: sourceControlProviderSchema,
    repository: repositoryIdentitySchema,
    number: positiveIntSchema,
    title: trimmedTextSchema(512),
    description: z.string().max(65_536).nullable(),
    state: pullRequestStateSchema,
    author: pullRequestAuthorSchema,
    base: gitReferenceSchema,
    head: gitReferenceSchema,
    additions: nonNegativeIntSchema,
    deletions: nonNegativeIntSchema,
    changedFiles: nonNegativeIntSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    url: httpUrlSchema
  })
  .strict();

export type PullRequest = z.infer<typeof pullRequestSchema>;
