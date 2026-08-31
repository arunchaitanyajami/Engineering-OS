import { z } from "zod";

import { nonNegativeIntSchema, sourceControlPathSchema } from "./primitives.js";

export const changedFileStatuses = [
  "added",
  "modified",
  "deleted",
  "renamed"
] as const;

export const changedFileStatusSchema = z.enum(changedFileStatuses);

export type ChangedFileStatus = z.infer<typeof changedFileStatusSchema>;

export const changedFileSchema = z
  .object({
    path: sourceControlPathSchema,
    previousPath: sourceControlPathSchema.optional(),
    status: changedFileStatusSchema,
    additions: nonNegativeIntSchema,
    deletions: nonNegativeIntSchema,
    patch: z.string().max(5_000_000).optional(),
    binary: z.boolean(),
    language: z.string().trim().min(1).max(64).optional()
  })
  .strict();

export type ChangedFile = z.infer<typeof changedFileSchema>;
