import { describe, expect, it } from "vitest";

import {
  changedFileSchema,
  fileDiffSchema,
  gitReferenceSchema,
  pluginConnectionSchema,
  pullRequestReviewSchema,
  pullRequestSchema,
  repositorySchema,
  reviewFindingSchema,
  sourceControlConnectionReferenceSchema,
  sourceControlProviderSchema
} from "@engineering-os/source-control-domain";

const gitSha = "a1b2c3d4e5f6789012345678901234567890abcd";

const createRepository = () => ({
  provider: "github" as const,
  owner: "acme",
  name: "payments",
  fullName: "acme/payments",
  defaultBranch: "main",
  private: true,
  url: "https://github.com/acme/payments",
  description: "Payment services"
});

const createPullRequest = () => ({
  provider: "github" as const,
  repository: {
    owner: "acme",
    name: "payments"
  },
  number: 123,
  title: "Harden checkout totals",
  description: "Fixes rounding on tax calculation.",
  state: "open" as const,
  author: {
    id: "42",
    username: "ada"
  },
  base: {
    ref: "refs/heads/main",
    sha: gitSha
  },
  head: {
    ref: "refs/heads/fix-tax",
    sha: "b2c3d4e5f6789012345678901234567890abcde1"
  },
  additions: 12,
  deletions: 4,
  changedFiles: 2,
  createdAt: "2026-08-31T08:00:00.000Z",
  updatedAt: "2026-08-31T09:00:00.000Z",
  url: "https://github.com/acme/payments/pull/123"
});

const createFinding = () => ({
  id: "finding-1",
  title: "Tax rounding can undercharge",
  category: "correctness" as const,
  severity: "high" as const,
  confidence: "medium" as const,
  description: "Integer division truncates cents before aggregation.",
  impact: "Checkout totals can be lower than the billed amount.",
  recommendation: "Round after aggregation, not per line item.",
  evidence: {
    filePath: "src/checkout/totals.ts",
    startLine: 40,
    endLine: 48,
    commitSha: gitSha,
    snippet: "const tax = Math.floor(amount * rate);"
  }
});

const createReview = () => ({
  id: "review-1",
  pullRequest: {
    provider: "github" as const,
    owner: "acme",
    name: "payments",
    number: 123,
    headSha: "b2c3d4e5f6789012345678901234567890abcde1"
  },
  summary: {
    overview:
      "The tax path has a rounding defect; the rest of the diff is sound.",
    recommendation: "request_changes" as const,
    risk: "high" as const
  },
  findings: [createFinding()],
  positives: [
    {
      title: "Explicit money type",
      description: "The new Money helper avoids floating-point arithmetic."
    }
  ],
  testing: {
    existingCoverageAssessment: "Unit tests cover happy-path totals only.",
    suggestedTests: [
      {
        description:
          "Add a fixture for mixed-rate line items that previously truncated."
      }
    ]
  },
  metadata: {
    agentId: "pr-reviewer",
    agentVersion: "0.1.0",
    modelProvider: "openai",
    modelId: "placeholder-model",
    startedAt: "2026-08-31T09:01:00.000Z",
    completedAt: "2026-08-31T09:02:00.000Z",
    filesAnalyzed: 2,
    filesSkipped: 1
  }
});

describe("source-control-domain providers", () => {
  it("accepts github as the first source-control provider", () => {
    expect(sourceControlProviderSchema.parse("github")).toBe("github");
  });

  it("rejects a provider that is not yet in the domain", () => {
    expect(sourceControlProviderSchema.safeParse("gitlab").success).toBe(false);
  });
});

describe("repositorySchema", () => {
  it("accepts a normalized repository", () => {
    expect(repositorySchema.parse(createRepository()).fullName).toBe(
      "acme/payments"
    );
  });

  it("rejects Octokit response fields leaking through", () => {
    const result = repositorySchema.safeParse({
      ...createRepository(),
      node_id: "R_kgDO",
      html_url: "https://github.com/acme/payments",
      stargazers_count: 12
    });

    expect(result.success).toBe(false);
  });

  it("allows a null description", () => {
    expect(
      repositorySchema.parse({
        ...createRepository(),
        description: null
      }).description
    ).toBeNull();
  });
});

describe("gitReferenceSchema", () => {
  it("rejects a non-hexadecimal SHA", () => {
    expect(
      gitReferenceSchema.safeParse({
        ref: "main",
        sha: "not-a-sha"
      }).success
    ).toBe(false);
  });
});

describe("pullRequestSchema", () => {
  it("accepts a normalized pull request", () => {
    expect(pullRequestSchema.parse(createPullRequest()).number).toBe(123);
  });

  it("rejects GitHub REST payload keys", () => {
    const result = pullRequestSchema.safeParse({
      ...createPullRequest(),
      mergeable_state: "clean",
      node_id: "PR_kwDO",
      user: { login: "ada" }
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing head SHA", () => {
    const pullRequest = createPullRequest();

    expect(
      pullRequestSchema.safeParse({
        ...pullRequest,
        head: {
          ref: pullRequest.head.ref
        }
      }).success
    ).toBe(false);
  });
});

describe("changedFileSchema and fileDiffSchema", () => {
  it("accepts a renamed text file with a patch", () => {
    const result = changedFileSchema.parse({
      path: "src/checkout/totals.ts",
      previousPath: "src/checkout/sum.ts",
      status: "renamed",
      additions: 8,
      deletions: 3,
      patch: "@@ -1,3 +1,4 @@\n",
      binary: false,
      language: "TypeScript"
    });

    expect(result.status).toBe("renamed");
  });

  it("accepts a parsed binary-file diff with no hunks", () => {
    const result = fileDiffSchema.parse({
      path: "docs/diagram.png",
      status: "added",
      binary: true,
      additions: 0,
      deletions: 0,
      hunks: []
    });

    expect(result.hunks).toEqual([]);
  });

  it("accepts hunks with 0-based empty-file starts", () => {
    const result = fileDiffSchema.parse({
      path: "src/new-file.ts",
      status: "added",
      binary: false,
      additions: 1,
      deletions: 0,
      hunks: [
        {
          oldStart: 0,
          oldLineCount: 0,
          newStart: 1,
          newLineCount: 1,
          lines: [
            {
              kind: "addition",
              content: "export const value = 1;",
              newLineNumber: 1
            }
          ]
        }
      ]
    });

    expect(result.hunks[0]?.oldStart).toBe(0);
  });
});

describe("connection reference contracts", () => {
  it("requires workspace, plugin, and connection identifiers together", () => {
    const reference = sourceControlConnectionReferenceSchema.parse({
      workspaceId: "workspace-company-a",
      pluginId: "com.engineering-os.github",
      connectionId: "connection-1"
    });

    expect(reference.workspaceId).toBe("workspace-company-a");
  });

  it("stores a credential reference instead of a secret value shape", () => {
    const connection = pluginConnectionSchema.parse({
      id: "connection-1",
      workspaceId: "workspace-company-a",
      pluginId: "com.engineering-os.github",
      displayName: "Company A GitHub",
      credentialRef: "github.credentials",
      status: "connected",
      createdAt: "2026-08-31T08:00:00.000Z",
      updatedAt: "2026-08-31T08:00:00.000Z"
    });

    expect(connection).not.toHaveProperty("accessToken");
    expect(connection).not.toHaveProperty("token");
    expect(connection.credentialRef).toBe("github.credentials");
  });

  it("rejects a connection without a workspace", () => {
    expect(
      pluginConnectionSchema.safeParse({
        id: "connection-1",
        pluginId: "com.engineering-os.github",
        displayName: "GitHub",
        credentialRef: "github.credentials",
        status: "connected",
        createdAt: "2026-08-31T08:00:00.000Z",
        updatedAt: "2026-08-31T08:00:00.000Z"
      }).success
    ).toBe(false);
  });
});

describe("reviewFindingSchema", () => {
  it("keeps severity and confidence independent", () => {
    const finding = reviewFindingSchema.parse({
      ...createFinding(),
      severity: "critical",
      confidence: "low"
    });

    expect(finding.severity).toBe("critical");
    expect(finding.confidence).toBe("low");
  });

  it("rejects inverted evidence line ranges", () => {
    expect(
      reviewFindingSchema.safeParse({
        ...createFinding(),
        evidence: {
          filePath: "src/checkout/totals.ts",
          startLine: 48,
          endLine: 40
        }
      }).success
    ).toBe(false);
  });
});

describe("pullRequestReviewSchema", () => {
  it("accepts structured review output", () => {
    const review = pullRequestReviewSchema.parse(createReview());

    expect(review.summary.recommendation).toBe("request_changes");
    expect(review.pullRequest.headSha).toHaveLength(40);
  });

  it("rejects markdown-only review payloads", () => {
    expect(
      pullRequestReviewSchema.safeParse({
        markdown: "## Review\nLooks good."
      }).success
    ).toBe(false);
  });

  it("rejects extra GitHub review API fields", () => {
    expect(
      pullRequestReviewSchema.safeParse({
        ...createReview(),
        html_url:
          "https://github.com/acme/payments/pull/123#pullrequestreview-1",
        node_id: "PRR_kwDO"
      }).success
    ).toBe(false);
  });
});
