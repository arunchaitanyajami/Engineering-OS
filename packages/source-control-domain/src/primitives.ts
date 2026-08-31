import { z } from "zod";

export const isoTimestampSchema = z.string().datetime({ offset: true });

export const gitShaSchema = z
  .string()
  .trim()
  .regex(
    /^[a-fA-F0-9]{7,64}$/,
    "Git SHA must be a hexadecimal revision string."
  );

export const sourceControlPathSchema = z.string().trim().min(1).max(2_048);

export const nonEmptyIdSchema = z.string().trim().min(1).max(128);

export const ownerNameSchema = z.string().trim().min(1).max(128);

export const repositoryNameSchema = z.string().trim().min(1).max(128);

export const httpUrlSchema = z.string().trim().url().max(2_048);

export const nonNegativeIntSchema = z.number().int().nonnegative();

export const positiveIntSchema = z.number().int().positive();

export const trimmedTextSchema = (max: number) =>
  z.string().trim().min(1).max(max);
