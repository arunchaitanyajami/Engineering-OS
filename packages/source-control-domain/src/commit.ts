import { z } from "zod";

import {
  gitShaSchema,
  httpUrlSchema,
  isoTimestampSchema,
  nonNegativeIntSchema,
  sourceControlPathSchema,
  trimmedTextSchema
} from "./primitives.js";
import { sourceControlProviderSchema } from "./provider.js";

export const fileContentEncodings = ["utf-8", "base64"] as const;

export const fileContentEncodingSchema = z.enum(fileContentEncodings);

export type FileContentEncoding = z.infer<typeof fileContentEncodingSchema>;

export const fileContentSchema = z
  .object({
    path: sourceControlPathSchema,
    sha: gitShaSchema,
    size: nonNegativeIntSchema,
    encoding: fileContentEncodingSchema,
    content: z.string(),
    binary: z.boolean()
  })
  .strict();

export type FileContent = z.infer<typeof fileContentSchema>;

export const commitAuthorSchema = z
  .object({
    name: trimmedTextSchema(256),
    email: z.string().trim().min(1).max(320).optional(),
    date: isoTimestampSchema
  })
  .strict();

export type CommitAuthor = z.infer<typeof commitAuthorSchema>;

export const commitSchema = z
  .object({
    provider: sourceControlProviderSchema,
    sha: gitShaSchema,
    message: z.string().max(10_000),
    author: commitAuthorSchema,
    url: httpUrlSchema,
    parentShas: z.array(gitShaSchema)
  })
  .strict();

export type Commit = z.infer<typeof commitSchema>;
