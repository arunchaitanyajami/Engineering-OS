import { z } from "zod";

import { changedFileStatusSchema } from "./changed-file.js";
import { nonNegativeIntSchema, sourceControlPathSchema } from "./primitives.js";

export const diffLineKinds = ["context", "addition", "deletion"] as const;

export const diffLineKindSchema = z.enum(diffLineKinds);

export type DiffLineKind = z.infer<typeof diffLineKindSchema>;

export const diffLineSchema = z
  .object({
    kind: diffLineKindSchema,
    content: z.string(),
    oldLineNumber: z.number().int().positive().optional(),
    newLineNumber: z.number().int().positive().optional(),
    noNewlineAtEnd: z.boolean().optional()
  })
  .strict();

export type DiffLine = z.infer<typeof diffLineSchema>;

export const diffHunkSchema = z
  .object({
    oldStart: nonNegativeIntSchema,
    oldLineCount: nonNegativeIntSchema,
    newStart: nonNegativeIntSchema,
    newLineCount: nonNegativeIntSchema,
    sectionHeading: z.string().trim().min(1).max(512).optional(),
    lines: z.array(diffLineSchema)
  })
  .strict();

export type DiffHunk = z.infer<typeof diffHunkSchema>;

export const fileDiffSchema = z
  .object({
    path: sourceControlPathSchema,
    previousPath: sourceControlPathSchema.optional(),
    oldFilePath: sourceControlPathSchema.optional(),
    newFilePath: sourceControlPathSchema.optional(),
    status: changedFileStatusSchema,
    binary: z.boolean(),
    additions: nonNegativeIntSchema,
    deletions: nonNegativeIntSchema,
    hunks: z.array(diffHunkSchema)
  })
  .strict();

export type FileDiff = z.infer<typeof fileDiffSchema>;

export type Diff = FileDiff;
