import { z } from "zod";

import { sourceControlProviderSchema } from "./provider.js";
import {
  httpUrlSchema,
  ownerNameSchema,
  repositoryNameSchema,
  trimmedTextSchema
} from "./primitives.js";

export const repositoryIdentitySchema = z
  .object({
    owner: ownerNameSchema,
    name: repositoryNameSchema
  })
  .strict();

export type RepositoryIdentity = z.infer<typeof repositoryIdentitySchema>;

export const repositorySchema = z
  .object({
    provider: sourceControlProviderSchema,
    owner: ownerNameSchema,
    name: repositoryNameSchema,
    fullName: trimmedTextSchema(257),
    defaultBranch: trimmedTextSchema(255),
    private: z.boolean(),
    url: httpUrlSchema,
    description: trimmedTextSchema(2_000).nullable().optional()
  })
  .strict();

export type Repository = z.infer<typeof repositorySchema>;
