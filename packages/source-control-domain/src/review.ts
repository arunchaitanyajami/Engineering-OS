import { z } from "zod";

import {
  gitShaSchema,
  isoTimestampSchema,
  nonNegativeIntSchema,
  sourceControlPathSchema,
  trimmedTextSchema
} from "./primitives.js";
import { pullRequestReferenceSchema } from "./pull-request.js";

export const reviewSeverities = [
  "critical",
  "high",
  "medium",
  "low",
  "info"
] as const;

export const reviewSeveritySchema = z.enum(reviewSeverities);

export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;

export const reviewConfidences = ["high", "medium", "low"] as const;

export const reviewConfidenceSchema = z.enum(reviewConfidences);

export type ReviewConfidence = z.infer<typeof reviewConfidenceSchema>;

export const reviewFindingCategories = [
  "correctness",
  "security",
  "performance",
  "maintainability",
  "testing"
] as const;

export const reviewFindingCategorySchema = z.enum(reviewFindingCategories);

export type ReviewFindingCategory = z.infer<typeof reviewFindingCategorySchema>;

export const reviewRecommendations = [
  "approve",
  "request_changes",
  "comment"
] as const;

export const reviewRecommendationSchema = z.enum(reviewRecommendations);

export type ReviewRecommendation = z.infer<typeof reviewRecommendationSchema>;

export const reviewRiskLevels = ["critical", "high", "medium", "low"] as const;

export const reviewRiskLevelSchema = z.enum(reviewRiskLevels);

export type ReviewRiskLevel = z.infer<typeof reviewRiskLevelSchema>;

export const findingEvidenceSchema = z
  .object({
    filePath: sourceControlPathSchema,
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    commitSha: gitShaSchema.optional(),
    snippet: z.string().max(8_192).optional()
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.startLine !== undefined &&
      evidence.endLine !== undefined &&
      evidence.endLine < evidence.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message: "Evidence endLine must be greater than or equal to startLine."
      });
    }
  });

export type FindingEvidence = z.infer<typeof findingEvidenceSchema>;

export const reviewFindingSchema = z
  .object({
    id: trimmedTextSchema(128),
    title: trimmedTextSchema(500),
    category: reviewFindingCategorySchema,
    severity: reviewSeveritySchema,
    confidence: reviewConfidenceSchema,
    description: trimmedTextSchema(10_000),
    impact: trimmedTextSchema(5_000),
    recommendation: trimmedTextSchema(5_000),
    evidence: findingEvidenceSchema
  })
  .strict();

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const reviewObservationSchema = z
  .object({
    title: trimmedTextSchema(500),
    description: trimmedTextSchema(10_000),
    filePath: sourceControlPathSchema.optional()
  })
  .strict();

export type ReviewObservation = z.infer<typeof reviewObservationSchema>;

export const suggestedTestSchema = z
  .object({
    description: trimmedTextSchema(2_000),
    filePath: sourceControlPathSchema.optional(),
    rationale: trimmedTextSchema(5_000).optional()
  })
  .strict();

export type SuggestedTest = z.infer<typeof suggestedTestSchema>;

export const tokenUsageSchema = z
  .object({
    inputTokens: nonNegativeIntSchema,
    outputTokens: nonNegativeIntSchema,
    totalTokens: nonNegativeIntSchema.optional()
  })
  .strict();

export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const pullRequestReviewSummarySchema = z
  .object({
    overview: trimmedTextSchema(10_000),
    recommendation: reviewRecommendationSchema,
    risk: reviewRiskLevelSchema
  })
  .strict();

export type PullRequestReviewSummary = z.infer<
  typeof pullRequestReviewSummarySchema
>;

export const pullRequestReviewTestingSchema = z
  .object({
    existingCoverageAssessment: trimmedTextSchema(5_000),
    suggestedTests: z.array(suggestedTestSchema)
  })
  .strict();

export type PullRequestReviewTesting = z.infer<
  typeof pullRequestReviewTestingSchema
>;

export const pullRequestReviewMetadataSchema = z
  .object({
    agentId: trimmedTextSchema(128),
    agentVersion: trimmedTextSchema(64),
    modelProvider: trimmedTextSchema(64),
    modelId: trimmedTextSchema(128),
    startedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema,
    filesAnalyzed: nonNegativeIntSchema,
    filesSkipped: nonNegativeIntSchema,
    tokenUsage: tokenUsageSchema.optional()
  })
  .strict();

export type PullRequestReviewMetadata = z.infer<
  typeof pullRequestReviewMetadataSchema
>;

export const pullRequestReviewSchema = z
  .object({
    id: trimmedTextSchema(128),
    pullRequest: pullRequestReferenceSchema,
    summary: pullRequestReviewSummarySchema,
    findings: z.array(reviewFindingSchema),
    positives: z.array(reviewObservationSchema),
    testing: pullRequestReviewTestingSchema,
    metadata: pullRequestReviewMetadataSchema
  })
  .strict();

export type PullRequestReview = z.infer<typeof pullRequestReviewSchema>;
