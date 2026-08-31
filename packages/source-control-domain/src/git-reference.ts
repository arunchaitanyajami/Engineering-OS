import { z } from "zod";

import { gitShaSchema } from "./primitives.js";

export const gitReferenceSchema = z
  .object({
    ref: z.string().trim().min(1).max(255),
    sha: gitShaSchema
  })
  .strict();

export type GitReference = z.infer<typeof gitReferenceSchema>;
